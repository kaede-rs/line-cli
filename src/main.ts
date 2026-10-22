import { BaseClient, type Device } from "@evex/linejs/base";
import { Client, TalkMessage } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import { App } from "./app.ts";
import {
	type Backend,
	type BackendEvent,
	type ChatItem,
	type ChatKind,
	formatBody,
	type HistoryResult,
	type MessageItem,
} from "./backend.ts";
import { encodeQr, renderQrAnsi } from "./qr.ts";
import { Terminal } from "./term.ts";
import { createTheme, detectColorMode, type ThemeName } from "./theme.ts";
import { singleLine } from "./text.ts";

const TOKEN_KEY = "authToken";
const HISTORY_LIMIT = 30;
const SESSION_DIR_NAME = "line-cli";

function argValue(name: string): string | undefined {
	const index = Deno.args.indexOf(`--${name}`);
	return index < 0 ? undefined : Deno.args[index + 1];
}

function hasFlag(name: string): boolean {
	return Deno.args.includes(`--${name}`);
}

function themeArg(): ThemeName | "auto" {
	const value = (argValue("theme") ?? "auto").toLowerCase();
	return value === "dark" || value === "light" || value === "mono"
		? value
		: "auto";
}

const loginTheme = createTheme(
	"dark",
	detectColorMode(
		{
			NO_COLOR: Deno.env.get("NO_COLOR"),
			TERM: Deno.env.get("TERM"),
			COLORTERM: Deno.env.get("COLORTERM"),
			TERM_PROGRAM: Deno.env.get("TERM_PROGRAM"),
		},
		true,
	),
);

const say = (text: string, style: Parameters<typeof loginTheme.sgr>[0] = {}) =>
	`${loginTheme.sgr(style)}${text}${loginTheme.reset}`;

const accent = (text: string) =>
	say(text, { fg: loginTheme.p.accent, bold: true });
const dim = (text: string) => say(text, { fg: loginTheme.p.textDim });
const warn = (text: string) => say(text, { fg: loginTheme.p.warn });

function printQr(url: string): void {
	console.log();
	console.log(`  ${accent("LINE にログイン")}`);
	console.log(
		`  ${dim("スマホの LINE → ホーム → 友だち追加 → QR で読み取ってください")}`,
	);
	console.log();
	try {
		const matrix = encodeQr(url, "M");
		const qr = renderQrAnsi(matrix)
			.split("\n")
			.map((line) => `  ${line}`)
			.join("\n");
		Deno.stdout.writeSync(new TextEncoder().encode(`${qr}\n`));
	} catch {
		console.log(
			warn("  QR を描画できませんでした。下の URL を使ってください。"),
		);
	}
	console.log(`  ${dim("URL:")} ${singleLine(url)}`);
	console.log();
}

function errorText(error: unknown): string {
	return singleLine(error instanceof Error ? error.message : String(error));
}

async function sessionPath(): Promise<string> {
	const dataHome = Deno.env.get("XDG_DATA_HOME") ??
		`${Deno.env.get("HOME") ?? "."}/.local/share`;
	const dir = `${dataHome}/${SESSION_DIR_NAME}`;
	await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
	try {
		await Deno.chmod(dir, 0o700);
	} catch {}
	const path = `${dir}/session.json`;
	try {
		await Deno.chmod(path, 0o600);
	} catch {}
	return path;
}

type Created = {
	client: Client;
	base: BaseClient;
	flush: () => Promise<void>;
};

async function createClient(
	onNotice: (text: string) => void,
): Promise<Created> {
	const storage = new FileStorage(await sessionPath());
	const device = (argValue("device") ?? "DESKTOPWIN") as Device;
	const base = new BaseClient({ device, storage });

	let pendingSave = Promise.resolve();
	const saveToken = (token: string) => {
		base.authToken = token;
		pendingSave = pendingSave
			.then(() => storage.set(TOKEN_KEY, token))
			.catch((error) => console.error(`トークン保存失敗: ${errorText(error)}`));
	};
	base.on("update:authtoken", saveToken);
	base.on("qrcall", (url) => printQr(url));
	base.on("pincall", (pin) => {
		console.log();
		console.log(
			`  ${dim("スマホの LINE に入力してください")}  ${
				say(pin, { bold: true, fg: loginTheme.p.warn })
			}`,
		);
		console.log();
	});
	base.on("log", ({ type, data }) => {
		if (/error/i.test(type)) onNotice(`${type}: ${errorText(data)}`);
	});

	const email = argValue("email") ?? Deno.env.get("LINE_EMAIL");
	const password = argValue("password") ?? Deno.env.get("LINE_PASSWORD");
	const forceLogin = Boolean(email || password);

	const saved = await storage.get(TOKEN_KEY);
	if (!forceLogin && typeof saved === "string" && saved) {
		base.authToken = saved;
		try {
			await base.loginProcess.ready();
			return { client: new Client(base), base, flush: () => pendingSave };
		} catch (error) {
			console.error(
				warn(`保存済みログインを使えませんでした: ${errorText(error)}`),
			);
			console.error(dim("再ログインします。"));
			base.authToken = undefined;
		}
	}

	if (email && password) {
		console.log(dim(`メールアドレスでログイン: ${singleLine(email)}`));
		await base.loginProcess.withPassword({ email, password });
	} else {
		if (forceLogin) {
			throw new Error("--email と --password は両方指定してください。");
		}
		await base.loginProcess.withQrCode({});
	}
	await base.loginProcess.ready();
	await pendingSave;

	if (base.profile) {
		console.log(
			`${dim("ログイン:")} ${accent(singleLine(base.profile.displayName))}`,
		);
	}
	return { client: new Client(base), base, flush: () => pendingSave };
}

function kindOf(value: unknown): ChatKind {
	switch (String(value).toUpperCase()) {
		case "USER":
		case "PEER":
		case "0":
		case "2":
			return "user";
		case "ROOM":
		case "1":
			return "room";
		default:
			return "group";
	}
}

class LineBackend implements Backend {
	me: { name: string; mid: string; status?: string } | null = null;

	private userNames = new Map<string, string>();
	private chatMeta = new Map<
		string,
		{ name: string; kind: ChatKind; members?: number }
	>();
	private rawTimes = new Map<string, number>();
	private sentIds = new Set<string>();
	private handlers = new Set<(event: BackendEvent) => void>();
	private abort = new AbortController();
	private client: Client;
	private flush: () => Promise<void>;
	private notices: string[] = [];

	constructor(created: Created, pendingNotices: string[] = []) {
		this.client = created.client;
		this.flush = created.flush;
		this.notices = pendingNotices;
		const profile = created.base.profile;
		if (profile) {
			this.me = {
				name: profile.displayName,
				mid: profile.mid,
				status: (profile.statusMessage as string | undefined) ?? undefined,
			};
		}
	}

	start(): void {
		this.client.on("message", (message) => {
			this.onMessage(message).catch((error) =>
				this.emit({
					type: "notice",
					kind: "error",
					text: `受信処理エラー: ${errorText(error)}`,
				})
			);
		});
		this.client.listen({
			talk: true,
			square: false,
			signal: this.abort.signal,
		});
		this.emit({ type: "state", connected: true, text: "" });
		for (const text of this.notices.splice(0)) {
			this.emit({ type: "notice", kind: "warn", text });
		}
	}

	notice(text: string): void {
		if (this.handlers.size) this.emit({ type: "notice", kind: "warn", text });
		else this.notices.push(text);
	}

	private emit(event: BackendEvent): void {
		for (const handler of [...this.handlers]) handler(event);
	}

	subscribe(handler: (event: BackendEvent) => void): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	async listChats(): Promise<ChatItem[]> {
		const talk = this.client.base.talk;
		const { messageBoxes } = await talk.getMessageBoxes({
			messageBoxListRequest: {
				withUnreadCount: true,
				lastMessagesPerMessageBoxCount: 1,
			},
		});
		const boxes = messageBoxes.filter((box) =>
			Number(box.lastDeliveredMessageId?.deliveredTime ?? 0) > 0
		);

		await this.resolveUsers(
			boxes.filter((box) => kindOf(box.midType) === "user").map((box) =>
				box.id
			),
		);
		await this.resolveChats(
			boxes.filter((box) => kindOf(box.midType) !== "user").map((box) =>
				box.id
			),
		);
		await this.resolveUsers(
			boxes
				.map((box) => box.lastMessages?.[0]?.from)
				.filter((mid): mid is string => Boolean(mid)),
		);

		const chats: ChatItem[] = [];
		for (const box of boxes) {
			const kind = kindOf(box.midType);
			const meta = this.chatMeta.get(box.id);
			const name = kind === "user" ? this.userNames.get(box.id) : meta?.name;
			const last = box.lastMessages?.[0];
			let preview: string | undefined;
			let previewWho: string | undefined;
			if (last) {
				const body = this.bodyOf(last);
				preview = body;
				if (kind !== "user" && last.from && last.from !== this.me?.mid) {
					previewWho = this.userNames.get(last.from);
				}
			}
			chats.push({
				mid: box.id,
				name: name ?? shortId(box.id),
				kind,
				unread: Number(box.unreadCount ?? 0),
				time: Number(box.lastDeliveredMessageId?.deliveredTime ?? 0),
				preview,
				previewWho,
				members: meta?.members,
			});
		}
		return chats.sort((a, b) => b.time - a.time);
	}

	async history(
		mid: string,
		options?: { before?: string; limit?: number },
	): Promise<HistoryResult> {
		const talk = this.client.base.talk;
		const count = options?.limit ?? HISTORY_LIMIT;
		let endMessageId: { messageId: Int64; deliveredTime: number };
		if (options?.before) {
			endMessageId = {
				messageId: toInt64(options.before),
				deliveredTime: this.rawTimes.get(options.before) ?? 0,
			};
		} else {
			const { messageBoxes } = await talk.getMessageBoxes({
				messageBoxListRequest: {},
			});
			const box = messageBoxes.find((item) => item.id === mid);
			const last = box?.lastDeliveredMessageId;
			if (!last?.messageId) return { messages: [], hasMore: false };
			endMessageId = {
				messageId: last.messageId,
				deliveredTime: Number(last.deliveredTime ?? 0),
			};
		}

		const raws = await talk.getPreviousMessagesV2WithRequest({
			request: { messageBoxId: mid, endMessageId, messagesCount: count },
		});
		const plain = [];
		for (const raw of raws) {
			plain.push(
				await this.client.base.e2ee.decryptE2EEMessage(raw).catch(() => raw),
			);
		}
		await this.resolveUsers(
			plain
				.map((raw) => raw.from)
				.filter((from): from is string => Boolean(from)),
		);

		const messages: MessageItem[] = plain
			.slice()
			.reverse()
			.map((raw) => this.toMessage(raw));
		return { messages, hasMore: plain.length >= count };
	}

	async send(mid: string, text: string): Promise<string> {
		const sent = await this.client.base.talk.sendMessage({
			to: mid,
			text,
			e2ee: true,
		});
		this.sentIds.add(sent.id);
		return sent.id;
	}

	async markRead(mid: string, messageId: string): Promise<void> {
		await this.client.base.talk.sendChatChecked({
			chatMid: mid,
			lastMessageId: messageId,
			seq: await this.client.base.getReqseq(),
		});
	}

	async chatInfo(
		mid: string,
	): Promise<{ title: string; rows: [string, string][] }> {
		const meta = this.chatMeta.get(mid);
		const kind = meta?.kind ?? (this.userNames.has(mid) ? "user" : "group");
		if (kind === "user") {
			await this.resolveUsers([mid], true);
			const contact = this.contacts.get(mid);
			return {
				title: this.userNames.get(mid) ?? shortId(mid),
				rows: [
					["種類", "1:1 チャット"],
					["表示名", contact?.displayName ?? "-"],
					["mid", mid],
					["状態", singleLine(contact?.statusMessage ?? "") || "-"],
				],
			};
		}
		await this.resolveChats([mid], true);
		const fresh = this.chatMeta.get(mid);
		return {
			title: fresh?.name ?? shortId(mid),
			rows: [
				["種類", kind === "room" ? "ルーム" : "グループ"],
				["メンバー", fresh?.members ? `${fresh.members} 人` : "-"],
				["mid", mid],
			],
		};
	}

	async close(): Promise<void> {
		this.abort.abort();
		await this.flush().catch(() => {});
	}

	/* ---------------- 内部 ---------------- */

	private contacts = new Map<
		string,
		{ displayName?: string; statusMessage?: string }
	>();

	private bodyOf(raw: { text?: string; contentType?: unknown }): string {
		return formatBody(raw.text, String(raw.contentType ?? ""));
	}

	private shortName(mid: string | undefined): string {
		if (!mid) return "システム";
		if (mid === this.me?.mid) return "自分";
		return this.userNames.get(mid) ?? shortId(mid);
	}

	private toMessage(raw: {
		id: string;
		from?: string;
		to?: string;
		text?: string;
		contentType?: unknown;
		createdTime?: unknown;
	}): MessageItem {
		const mine = raw.from === this.me?.mid;
		const time = Number(raw.createdTime ?? Date.now());
		this.rawTimes.set(raw.id, time);
		return {
			id: raw.id,
			time,
			who: mine ? "自分" : this.shortName(raw.from),
			body: this.bodyOf(raw),
			mine,
			status: "sent",
		};
	}

	private async resolveUsers(mids: (string | undefined)[], force = false) {
		const unknown = [
			...new Set(mids.filter((mid): mid is string => Boolean(mid))),
		]
			.filter((mid) =>
				mid !== this.me?.mid && (force || !this.userNames.has(mid))
			);
		if (!unknown.length) return;
		try {
			const { contacts } = await this.client.base.talk.getContactsV2({
				mids: unknown,
			});
			for (const mid of unknown) {
				const contact = contacts[mid]?.contact;
				this.userNames.set(mid, contact?.displayName || shortId(mid));
				this.contacts.set(mid, {
					displayName: contact?.displayName,
					statusMessage: contact?.statusMessage as string | undefined,
				});
			}
		} catch {
			for (const mid of unknown) this.userNames.set(mid, shortId(mid));
		}
	}

	private async resolveChats(mids: string[], force = false) {
		const unknown = [...new Set(mids)].filter((mid) =>
			force || !this.chatMeta.has(mid)
		);
		if (!unknown.length) return;
		try {
			const { chats } = await this.client.base.talk.getChats({
				chatMids: unknown,
			});
			for (const chat of chats) {
				// memberMids は Record<mid, Int64> の形
				const memberMids = (chat as {
					extra?: { groupExtra?: { memberMids?: Record<string, unknown> } };
				}).extra?.groupExtra?.memberMids;
				this.chatMeta.set(chat.chatMid, {
					name: chat.chatName || shortId(chat.chatMid),
					kind: kindOf(chat.type),
					members: memberMids ? Object.keys(memberMids).length : undefined,
				});
			}
		} catch {}
	}

	private async onMessage(message: TalkMessage): Promise<void> {
		if (this.sentIds.delete(message.raw.id)) return;

		const to = message.to as { type?: unknown; id?: string } | undefined;
		const toType = kindOf(to?.type);
		const toId = String(to?.id ?? "");
		const isGroup = toType !== "user";
		const chatMid = isGroup
			? toId
			: (message.isMyMessage ? toId : message.raw.from);
		if (!chatMid) return;

		if (isGroup) await this.resolveChats([chatMid]);
		await this.resolveUsers([message.raw.from, isGroup ? undefined : chatMid]);

		const meta = this.chatMeta.get(chatMid);
		const kind: ChatKind = isGroup ? (meta?.kind ?? "group") : "user";
		const name = kind === "user"
			? this.userNames.get(chatMid) ?? shortId(chatMid)
			: meta?.name ?? shortId(chatMid);
		const body = formatBody(
			message.text,
			String(message.raw.contentType ?? ""),
		);
		const time = Number(message.raw.createdTime ?? Date.now());
		this.rawTimes.set(message.raw.id, time);
		const who = message.isMyMessage ? "自分" : this.shortName(message.raw.from);

		const chat: ChatItem = {
			mid: chatMid,
			name,
			kind,
			unread: 0,
			time,
			preview: body,
			previewWho: kind !== "user" && !message.isMyMessage ? who : undefined,
			members: meta?.members,
		};
		this.emit({
			type: "message",
			chat,
			message: {
				id: message.raw.id,
				time,
				who,
				body,
				mine: Boolean(message.isMyMessage),
				status: "sent",
			},
		});
	}
}

type Int64 = number | bigint;

function toInt64(value: string | number | bigint): Int64 {
	if (typeof value !== "string") return value;
	try {
		return BigInt(value);
	} catch {
		return Number(value);
	}
}

function shortId(mid: string): string {
	return mid.length > 8 ? `…${mid.slice(-6)}` : mid;
}

async function main(): Promise<number> {
	if (hasFlag("help")) {
		printUsage();
		return 0;
	}
	if (!Deno.stdin.isTerminal() || !Deno.stdout.isTerminal()) {
		console.error(
			"このアプリは端末が必要です（パイプやリダイレクトでは動きません）。",
		);
		console.error(dim("UI だけ見たい場合は  deno task demo  をどうぞ。"));
		return 1;
	}

	const pending: string[] = [];
	const created = await createClient((text) => pending.push(text));
	const backend = new LineBackend(created, pending);
	backend.start();

	const io = new Terminal({ mouse: !hasFlag("no-mouse") });
	const app = new App({ backend, io, theme: themeArg() });
	try {
		return await app.run();
	} finally {
		io.stop();
	}
}

function printUsage(): void {
	const rows: [string, string][] = [
		["--theme <名前>", "dark | light | mono | auto（既定: auto）"],
		["--email <addr>", "メールアドレスでログイン（--password とセット）"],
		["--password <pw>", "パスワード（LINE_PASSWORD でも可）"],
		["--device <名前>", "DESKTOPWIN など（既定: DESKTOPWIN）"],
		["--no-mouse", "マウス追跡を無効化"],
		["--help", "このヘルプ"],
	];
	const width = Math.max(...rows.map(([name]) => name.length));
	console.log(`LINE CLI — 端末の中で動く LINE Desktop 風のクライアント\n`);
	for (const [name, description] of rows) {
		console.log(`  ${name.padEnd(width)}  ${description}`);
	}
	console.log(
		`\n  起動後の操作はアプリ内で ? キー（または /help）\n`,
	);
}

if (import.meta.main) {
	try {
		Deno.exit(await main());
	} catch (error) {
		console.error(`致命的なエラー: ${errorText(error)}`);
		Deno.exit(1);
	}
}

export { createClient, LineBackend };
