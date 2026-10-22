import type {
	Backend,
	BackendEvent,
	ChatItem,
	MessageItem,
	NoticeKind,
} from "./backend.ts";
import { Screen } from "./screen.ts";
import { cellWidth, chars, singleLine } from "./text.ts";
import {
	type ColorMode,
	createTheme,
	detectColorMode,
	type Theme,
	type ThemeName,
} from "./theme.ts";
import type { InputEvent, Io, KeyEvent, MouseEvent } from "./term.ts";
import {
	type AppView,
	clamp,
	countMessageRows,
	type Hint,
	hitTest,
	type Hotspot,
	type Layout,
	type MenuItem,
	type OverlayView,
	type PaletteItem,
	renderFrame,
	wrapInput,
} from "./ui.ts";

export type AppOptions = {
	backend: Backend;
	io: Io;
	theme?: ThemeName | "auto";
	scrollStep?: number;
};

type Toast = {
	id: number;
	kind: NoticeKind;
	text: string;
	until: number;
};

type Command = {
	name: string;
	aliases: string[];
	description: string;
	arg?: string;
	run: (arg: string) => void | Promise<void>;
};

const TOAST_MS = 3600;
const MAX_TOASTS = 3;
const HISTORY_LIMIT = 50;
const PAGE_SIZE = 20;
const NONE = Number.MAX_SAFE_INTEGER;

export class App {
	private io: Io;
	private backend: Backend;
	private screen: Screen;
	private theme: Theme;
	private themeName: ThemeName;
	private colorMode: ColorMode;
	private layout: Layout | null = null;
	private hotspots: Hotspot[] = [];
	private scrollStep: number;

	private chats: ChatItem[] = [];
	private chatsVersion = 0;
	private visibleCache: { key: string; list: ChatItem[] } | null = null;
	private messages = new Map<string, MessageItem[]>();
	private hasMore = new Map<string, boolean>();
	private oldestId = new Map<string, string>();
	private unreadFrom = new Map<string, number>();
	private sentIds = new Set<string>();

	private focus: AppView["focus"] = "list";
	private selectedIndex = 0;
	private listScroll = 0;
	private openMid: string | null = null;
	private msgScroll = 0;

	private input = "";
	private inputCursor = 0;
	private inputScroll = 0;
	private history: string[] = [];
	private historyIndex = -1;
	private historyDraft = "";

	private filter = "";
	private filterCursor = 0;
	private busy: string | null = null;
	private toasts: Toast[] = [];
	private overlay: OverlayView = null;
	private paletteSelected = 0;
	private tick = 0;
	private connected = false;
	private statusText = "";
	private draggingScroll = false;

	private timer: ReturnType<typeof setInterval> | undefined;
	private renderTimer: ReturnType<typeof setTimeout> | undefined;
	private pendingRender = false;
	private lastMinute = Math.floor(Date.now() / 60000);
	private toastSeq = 0;
	private localSeq = 0;
	private running = false;
	private exitResolve: ((code: number) => void) | null = null;
	private readonly exited: Promise<number>;
	private unsubscribe: (() => void) | null = null;

	constructor(options: AppOptions) {
		this.io = options.io;
		this.backend = options.backend;
		this.scrollStep = options.scrollStep ?? 3;
		this.screen = new Screen((chunk) => this.io.write(chunk));
		this.colorMode = this.detectColorMode();
		const requested = options.theme ?? "auto";
		this.wantAutoTheme = requested === "auto";
		this.themeName = requested === "auto" ? "dark" : requested;
		this.theme = createTheme(this.themeName, this.colorMode);
		this.exited = new Promise<number>((resolve) => {
			this.exitResolve = resolve;
		});
	}

	private readonly wantAutoTheme: boolean;

	private detectColorMode() {
		try {
			const env: Record<string, string | undefined> = {};
			for (
				const key of [
					"NO_COLOR",
					"TERM",
					"COLORTERM",
					"TERM_PROGRAM",
				]
			) {
				env[key] = Deno.env.get(key);
			}
			return detectColorMode(env, this.io.isTTY);
		} catch {
			return detectColorMode({}, this.io.isTTY);
		}
	}

	async run(): Promise<number> {
		await this.io.start();
		this.screen.setSize(this.io.cols, this.io.rows);

		if (this.wantAutoTheme && this.io.queryBackground) {
			const background = await this.io.queryBackground().catch(() => null);
			if (background) {
				this.themeName = background === "light" ? "light" : "dark";
				this.theme = createTheme(this.themeName, this.colorMode);
			}
		}
		this.statusText = this.io.isTTY ? "" : "非対話モード";

		this.io.onEvent((event) => this.onInput(event));
		this.io.onResize(() => this.onResize());
		this.unsubscribe = this.backend.subscribe((event) =>
			this.onBackendEvent(event)
		);

		this.running = true;
		this.timer = setInterval(() => this.onTick(), 120);
		this.render();

		try {
			await this.reloadChats("チャットを読み込み中");
			const me = this.backend.me;
			if (me) this.toast(`${me.name} でログイン中`, "success");
		} catch (error) {
			this.toast(`読み込みに失敗: ${message(error)}`, "error");
		}
		this.render();

		return await this.exited;
	}

	quit(code = 0): void {
		if (!this.running) return;
		this.running = false;
		if (this.timer !== undefined) clearInterval(this.timer);
		if (this.renderTimer !== undefined) clearTimeout(this.renderTimer);
		this.unsubscribe?.();
		this.io.stop();
		const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2000));
		Promise.race([this.backend.close().catch(() => {}), timeout]).finally(
			() => {
				this.exitResolve?.(code);
			},
		);
	}

	private onTick(): void {
		this.tick++;
		const now = Date.now();
		const minute = Math.floor(now / 60000);
		let dirty = false;
		if (minute !== this.lastMinute) {
			this.lastMinute = minute;
			dirty = true;
		}
		if (this.toasts.length) {
			const alive = this.toasts.filter((toast) => toast.until > now);
			if (alive.length !== this.toasts.length) {
				this.toasts = alive;
				dirty = true;
			}
		}
		if (this.busy || dirty) this.scheduleRender();
	}

	private onResize(): void {
		this.screen.setSize(this.io.cols, this.io.rows);
		this.screen.invalidate();
		this.adjustScroll();
		this.render();
	}

	private scheduleRender(): void {
		if (this.pendingRender) return;
		this.pendingRender = true;
		this.renderTimer = setTimeout(() => {
			this.pendingRender = false;
			if (this.running) this.render();
		}, 8);
	}

	snapshot(): AppView {
		return this.view();
	}

	get currentTheme(): Theme {
		return this.theme;
	}

	private render(): void {
		const frame = renderFrame(this.view(), this.theme);
		this.layout = frame.layout;
		this.hotspots = frame.hotspots;
		this.screen.setSize(this.io.cols, this.io.rows);
		this.screen.draw(frame.lines, frame.cursor);
	}

	private view(): AppView {
		const chats = this.visibleChats();
		this.selectedIndex = clamp(
			this.selectedIndex,
			chats.length ? 0 : -1,
			Math.max(-1, chats.length - 1),
		);
		const open = this.openChat();
		const messages = this.openMid ? this.messages.get(this.openMid) ?? [] : [];
		return {
			cols: this.io.cols,
			rows: this.io.rows,
			themeName: this.themeName,
			me: this.backend.me,
			connected: this.connected,
			statusText: this.statusText,
			chats,
			totalCount: this.chats.length,
			totalUnread: this.chats.reduce((sum, chat) => sum + chat.unread, 0),
			filter: this.filter,
			focus: this.focus,
			selectedIndex: this.selectedIndex,
			listScroll: this.listScroll,
			openChat: open,
			messages,
			unreadFrom: this.openMid
				? this.unreadFrom.get(this.openMid) ?? messages.length
				: messages.length,
			msgScroll: this.msgScroll,
			hasMore: this.openMid ? this.hasMore.get(this.openMid) ?? false : false,
			input: this.input,
			inputCursor: this.inputCursor,
			inputScroll: this.inputScroll,
			busy: this.busy,
			toasts: this.toasts.slice(-MAX_TOASTS).map((toast) => ({
				id: toast.id,
				kind: toast.kind,
				text: toast.text,
			})),
			overlay: this.overlay,
			hints: this.hints(),
			palette: this.palette(),
			now: Date.now(),
			tick: this.tick,
		};
	}

	private hints(): Hint[] {
		if (this.overlay) {
			if (this.overlay.kind === "menu") {
				return [
					{ id: "overlay-up", key: "↑↓", label: "選択" },
					{ id: "overlay-ok", key: "Enter", label: "決定" },
					{ id: "overlay-close", key: "Esc", label: "閉じる" },
				];
			}
			return [
				{ id: "overlay-scroll", key: "PgUp/Dn", label: "スクロール" },
				{ id: "overlay-close", key: "Esc", label: "閉じる" },
				{ id: "overlay-ok", key: "Enter", label: "閉じる" },
			];
		}
		if (this.focus === "filter") {
			return [
				{ id: "filter-open", key: "Enter", label: "開く" },
				{ id: "filter-clear", key: "Esc", label: "解除" },
				{ id: "filter-list", key: "Tab", label: "一覧へ" },
				{ id: "help", key: "?", label: "ヘルプ" },
			];
		}
		if (this.focus === "input") {
			if (this.palette()) {
				return [
					{ id: "palette-run", key: "Enter", label: "実行" },
					{ id: "palette-next", key: "Tab", label: "補完" },
					{ id: "palette-close", key: "Esc", label: "閉じる" },
					{ id: "quit", key: "Ctrl+C", label: "終了" },
				];
			}
			return [
				{ id: "send", key: "Enter", label: "送信" },
				{ id: "newline", key: "Ctrl+J", label: "改行" },
				{ id: "history", key: "↑", label: "履歴" },
				{ id: "command", key: "/", label: "コマンド" },
				{ id: "focus-list", key: "Tab", label: "一覧" },
				{ id: "back", key: "Esc", label: "戻る" },
				{ id: "quit", key: "Ctrl+C", label: "終了" },
			];
		}
		return [
			{ id: "open", key: "Enter", label: "開く" },
			{ id: "select", key: "↑↓", label: "選択" },
			{ id: "search", key: "/", label: "検索" },
			{ id: "reload", key: "r", label: "更新" },
			{ id: "info", key: "i", label: "情報" },
			{ id: "theme", key: "t", label: "テーマ" },
			{ id: "help", key: "?", label: "ヘルプ" },
			{ id: "focus-input", key: "Tab", label: "入力欄" },
			{ id: "quit", key: "Ctrl+C", label: "終了" },
		];
	}

	private palette(): { items: PaletteItem[]; selected: number } | null {
		if (this.focus !== "input") return null;
		if (!this.input.startsWith("/") || this.input.startsWith("//")) return null;
		const items = this.commandCandidates();
		if (!items.length) return null;
		return { items, selected: this.paletteSelected };
	}

	private visibleChats(): ChatItem[] {
		const key = `${this.filter}\u0000${this.chatsVersion}`;
		if (this.visibleCache?.key === key) return this.visibleCache.list;
		const query = singleLine(this.filter).toLowerCase();
		const list = query
			? this.chats.filter((chat) =>
				`${chat.name} ${chat.preview ?? ""} ${chat.previewWho ?? ""}`
					.toLowerCase()
					.includes(query)
			)
			: this.chats.slice();
		this.visibleCache = { key, list };
		return list;
	}

	private touchChats(): void {
		this.chatsVersion++;
	}

	private select(index: number): void {
		const chats = this.visibleChats();
		if (!chats.length) {
			this.selectedIndex = -1;
			return;
		}
		this.selectedIndex = clamp(index, 0, chats.length - 1);
		this.ensureSelectedVisible();
	}

	private move(delta: number): void {
		const chats = this.visibleChats();
		if (!chats.length) return;
		const base = this.selectedIndex < 0
			? (delta > 0 ? -1 : 0)
			: this.selectedIndex;
		this.select(base + delta);
	}

	private ensureSelectedVisible(): void {
		const chats = this.visibleChats();
		const info = this.layout?.list;
		const area = this.layout?.sidebar;
		if (!info || !area) return;
		const visibleCount = Math.max(
			1,
			Math.floor((area.row + area.height - info.top) / info.itemHeight),
		);
		const maxScroll = Math.max(0, chats.length - visibleCount);
		if (this.selectedIndex < this.listScroll) {
			this.listScroll = this.selectedIndex;
		} else if (this.selectedIndex >= this.listScroll + visibleCount) {
			this.listScroll = this.selectedIndex - visibleCount + 1;
		}
		this.listScroll = clamp(this.listScroll, 0, maxScroll);
	}

	private adjustScroll(): void {
		this.ensureSelectedVisible();
		const open = this.openChat();
		if (open) {
			const area = this.layout?.messages;
			const rows = this.messageRows(open.mid);
			this.msgScroll = clamp(
				this.msgScroll,
				0,
				Math.max(0, rows - (area?.height ?? 0)),
			);
		}
		this.keepCaretVisible();
	}

	private messageRows(mid: string): number {
		const chat = this.chats.find((item) => item.mid === mid);
		return countMessageRows(
			this.messages.get(mid) ?? [],
			this.messageWidth(),
			this.unreadFrom.get(mid) ?? NONE,
			Date.now(),
			chat?.kind !== "user",
		);
	}

	private messageWidth(): number {
		return Math.max(8, (this.layout?.messages?.width ?? this.io.cols - 40) - 1);
	}

	private inputWidth(): number {
		return Math.max(8, this.layout?.input?.innerWidth ?? this.io.cols - 46);
	}

	private openChat(): ChatItem | null {
		if (!this.openMid) return null;
		return this.chats.find((chat) => chat.mid === this.openMid) ?? null;
	}

	private onInput(event: InputEvent): void {
		try {
			if (event.type === "key") this.onKey(event);
			else if (event.type === "paste") this.onPaste(event.text);
			else this.onMouse(event);
		} catch (error) {
			this.toast(`操作エラー: ${message(error)}`, "error");
		}
		if (this.running) this.render();
	}

	private onKey(event: KeyEvent): void {
		const { key, ctrl, ch } = event;
		if (ctrl && key === "char" && ch === "c") {
			if (this.overlay) return this.closeOverlay();
			if (this.input) return this.setInput("");
			return this.askQuit();
		}
		if (ctrl && key === "char" && ch === "d") return this.quit(0);
		if (ctrl && key === "char" && ch === "l") {
			this.screen.invalidate();
			return;
		}
		if (this.overlay) return this.onOverlayKey(event);
		if (key === "escape") return this.onEscape();
		if (key === "tab") return this.cycleFocus(event.shift);
		if (
			key === "f1" ||
			(ch === "?" && this.focus === "list")
		) {
			return this.showHelp();
		}
		if (key === "pageup" || key === "pagedown") {
			return this.scrollMessages(key === "pageup" ? 1 : -1, "page");
		}
		if (key === "up" && event.shift) return this.scrollMessages(1, "rows");
		if (key === "down" && event.shift) return this.scrollMessages(-1, "rows");
		if (this.focus === "filter") return this.onFilterKey(event);
		if (this.focus === "input") return this.onInputKey(event);
		return this.onListKey(event);
	}

	private onOverlayKey(event: KeyEvent): void {
		const overlay = this.overlay;
		if (!overlay) return;
		const { key, ctrl, ch } = event;
		if (key === "escape" || (ctrl && ch === "c")) return this.closeOverlay();
		if (overlay.kind === "menu") {
			const count = overlay.items.length || 1;
			if (key === "up" || (ch === "k" && !ctrl)) {
				overlay.selected = (overlay.selected - 1 + count) % count;
				return;
			}
			if (key === "down" || (ch === "j" && !ctrl)) {
				overlay.selected = (overlay.selected + 1) % count;
				return;
			}
			if (key === "enter") {
				const item = overlay.items[overlay.selected];
				this.closeOverlay();
				if (item) this.spawn(this.runOverlayAction(item.id), "操作");
			}
			return;
		}
		if (overlay.kind === "confirm") {
			if (key === "enter" || ch === "y") return this.quit(0);
			if (ch === "n") return this.closeOverlay();
			return;
		}
		if (key === "pageup" || (ctrl && ch === "u")) return this.scrollOverlay(-1);
		if (key === "pagedown" || (ctrl && ch === "d")) {
			return this.scrollOverlay(1);
		}
		if (key === "up") return this.scrollOverlay(-1, 1);
		if (key === "down") return this.scrollOverlay(1, 1);
		if (key === "enter") return this.closeOverlay();
	}

	private scrollOverlay(direction: number, lines = 8): void {
		const overlay = this.overlay;
		if (!overlay || overlay.kind === "menu" || overlay.kind === "confirm") {
			return;
		}
		overlay.scroll = Math.max(0, overlay.scroll + direction * lines);
	}

	private closeOverlay(): void {
		this.overlay = null;
	}

	private onEscape(): void {
		if (this.focus === "filter") {
			if (this.filter) {
				this.filter = "";
				this.filterCursor = 0;
				this.select(0);
				return;
			}
			this.focus = "list";
			return;
		}
		if (this.focus === "input") {
			this.paletteSelected = 0;
			this.focus = "list";
			return;
		}
		if (this.openMid) return this.closeChat();
		return this.askQuit();
	}

	private cycleFocus(backward = false): void {
		const order: AppView["focus"][] = this.openMid
			? ["list", "input"]
			: ["list", "filter"];
		const index = Math.max(0, order.indexOf(this.focus));
		const next = backward
			? (index - 1 + order.length) % order.length
			: (index + 1) % order.length;
		this.focus = order[next];
	}

	private onListKey(event: KeyEvent): void {
		const { key, ctrl, alt, ch } = event;
		const typing = this.filter.length > 0;
		if (!typing) {
			if (key === "up" || (ch === "k" && !ctrl && !alt)) return this.move(-1);
			if (key === "down" || (ch === "j" && !ctrl && !alt)) return this.move(1);
			if (key === "home") return this.select(0);
			if (key === "end") return this.select(this.visibleChats().length - 1);
			if ((ch === "r" && !ctrl && !alt) || (ctrl && ch === "r")) {
				return this.spawn(this.reloadChats("再読み込み中"), "再読み込み");
			}
			if (ch === "i" && !ctrl && !alt) {
				return this.spawn(this.showInfo(this.selectedChat()), "情報");
			}
			if (ch === "t" && !ctrl && !alt) return this.cycleTheme();
		} else {
			if (key === "up") return this.move(-1);
			if (key === "down") return this.move(1);
		}
		if (key === "enter" || key === "right") {
			return this.spawn(this.openSelected(), "チャットを開く");
		}
		if (key === "left") {
			if (this.openMid) this.closeChat();
			return;
		}
		if ((ch === "/" && !ctrl && !alt) || (ctrl && ch === "f")) {
			this.focus = "filter";
			return;
		}
		if (key === "backspace") {
			if (this.filter) {
				const parts = chars(this.filter).slice();
				parts.pop();
				this.filter = parts.join("");
				this.filterCursor = parts.length;
				this.select(0);
			}
			return;
		}
		if (event.key === "char" && ch && !ctrl && !alt) {
			const clean = singleLine(ch);
			if (!clean) return;
			this.filter = typing ? this.filter + clean : clean;
			this.filterCursor = chars(this.filter).length;
			this.focus = "filter";
			this.select(0);
		}
	}

	private onFilterKey(event: KeyEvent): void {
		const { key, ctrl, ch } = event;
		if (key === "enter") {
			if (this.visibleChats().length) {
				this.select(0);
				this.spawn(this.openSelected(), "チャットを開く");
			} else {
				this.toast("見つかりませんでした", "warn");
			}
			return;
		}
		if (key === "tab") {
			this.focus = "list";
			return;
		}
		if (key === "up") return this.move(-1);
		if (key === "down") return this.move(1);
		if (key === "backspace") {
			const parts = chars(this.filter).slice();
			if (this.filterCursor === 0) return;
			parts.splice(this.filterCursor - 1, 1);
			this.filterCursor--;
			this.filter = parts.join("");
			this.select(0);
			return;
		}
		if (key === "delete") {
			const parts = chars(this.filter).slice();
			if (this.filterCursor >= parts.length) return;
			parts.splice(this.filterCursor, 1);
			this.filter = parts.join("");
			this.select(0);
			return;
		}
		if (key === "left") {
			this.filterCursor = Math.max(0, this.filterCursor - (ctrl ? 5 : 1));
			return;
		}
		if (key === "right") {
			this.filterCursor = Math.min(
				chars(this.filter).length,
				this.filterCursor + (ctrl ? 5 : 1),
			);
			return;
		}
		if (key === "home" || (ctrl && ch === "a")) {
			this.filterCursor = 0;
			return;
		}
		if (key === "end" || (ctrl && ch === "e")) {
			this.filterCursor = chars(this.filter).length;
			return;
		}
		if (ctrl && ch === "u") {
			this.filter = "";
			this.filterCursor = 0;
			this.select(0);
			return;
		}
		if (event.key === "char" && ch && !ctrl && !event.alt) {
			const clean = singleLine(ch);
			const parts = chars(this.filter).slice();
			parts.splice(this.filterCursor, 0, ...chars(clean));
			this.filter = parts.join("");
			this.filterCursor += chars(clean).length;
			this.select(0);
		}
	}

	private onInputKey(event: KeyEvent): void {
		const { key, ctrl, alt, ch } = event;
		const palette = this.palette();

		if (key === "enter") {
			if (ctrl || alt) return this.newline();
			if (palette?.items.length) {
				const item = palette
					.items[clamp(this.paletteSelected, 0, palette.items.length - 1)];
				return this.spawn(this.runPalette(item?.label ?? ""), "コマンド");
			}
			return this.spawn(this.submit(), "送信");
		}
		if (key === "tab") {
			if (palette?.items.length) {
				const count = palette.items.length;
				this.paletteSelected = event.shift
					? (this.paletteSelected - 1 + count) % count
					: (this.paletteSelected + 1) % count;
				const item = palette.items[this.paletteSelected];
				if (item) this.setInput(item.label + " ");
				return;
			}
			this.focus = "list";
			return;
		}
		if (palette) {
			if (key === "up") {
				this.paletteSelected =
					(this.paletteSelected - 1 + palette.items.length) %
					palette.items.length;
				return;
			}
			if (key === "down") {
				this.paletteSelected = (this.paletteSelected + 1) %
					palette.items.length;
				return;
			}
		}
		if (key === "up") return this.recallHistory(-1);
		if (key === "down") return this.recallHistory(1);
		if (key === "backspace") {
			if (ctrl || alt) return this.deleteWordBackward();
			if (this.inputCursor === 0) return;
			const parts = chars(this.input).slice();
			parts.splice(this.inputCursor - 1, 1);
			return this.setInput(parts.join(""), this.inputCursor - 1);
		}
		if (key === "delete") {
			const parts = chars(this.input).slice();
			if (this.inputCursor >= parts.length) return;
			const count = ctrl
				? this.wordEnd(this.inputCursor) - this.inputCursor
				: 1;
			parts.splice(this.inputCursor, count);
			return this.setInput(parts.join(""), this.inputCursor);
		}
		if (key === "left") {
			return this.moveCursorTo(
				ctrl ? this.wordStart(this.inputCursor) : this.inputCursor - 1,
			);
		}
		if (key === "right") {
			return this.moveCursorTo(
				ctrl ? this.wordEnd(this.inputCursor) : this.inputCursor + 1,
			);
		}
		if (key === "home" || (ctrl && ch === "a")) {
			return this.moveCursorTo(0);
		}
		if (key === "end" || (ctrl && ch === "e")) {
			return this.moveCursorTo(chars(this.input).length);
		}
		if (ctrl && ch === "u") return this.setInput("");
		if (ctrl && ch === "w") return this.deleteWordBackward();
		if (ctrl && ch === "k") {
			const parts = chars(this.input).slice();
			return this.setInput(
				parts.slice(0, this.inputCursor).join(""),
				this.inputCursor,
			);
		}
		if (ctrl && ch === "r") {
			return this.spawn(this.reloadChats("再読み込み中"), "再読み込み");
		}
		if (event.key === "char" && ch && !ctrl) return this.insertText(ch);
	}

	private onPaste(text: string): void {
		const clean = text
			.replace(/\r\n?/g, "\n")
			.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
		if (!clean) return;
		if (this.focus === "filter") {
			const flat = singleLine(clean);
			const parts = chars(this.filter).slice();
			parts.splice(this.filterCursor, 0, ...chars(flat));
			this.filter = parts.join("");
			this.filterCursor += chars(flat).length;
			this.select(0);
			return;
		}
		if (this.focus !== "input" && this.openMid) this.focus = "input";
		this.insertText(clean);
	}

	private onMouse(event: MouseEvent): void {
		if (event.action === "wheel") {
			const sidebar = this.layout?.sidebar;
			if (sidebar && event.x < sidebar.col + sidebar.width) {
				this.listScroll = Math.max(
					0,
					this.listScroll + event.dy * this.scrollStep,
				);
				this.ensureSelectedVisible();
			} else if (this.layout?.messages) {
				this.scrollMessages(-event.dy * this.scrollStep, "rows");
			}
			return;
		}
		if (event.action === "release") {
			this.draggingScroll = false;
			return;
		}
		if (event.action === "drag") {
			if (this.draggingScroll) this.scrollToY(event.y);
			return;
		}

		const spot = hitTest(this.hotspots, event.x, event.y);
		if (event.button === "right") {
			if (spot?.action.type === "chat") this.select(spot.action.index);
			this.showChatMenu({ row: event.y, col: event.x });
			return;
		}
		if (event.button !== "left" || !spot) return;
		const action = spot.action;
		switch (action.type) {
			case "scroll":
				this.draggingScroll = true;
				this.scrollToY(event.y);
				return;
			case "chat": {
				this.select(action.index);
				const chat = this.visibleChats()[action.index];
				if (chat && this.openMid === chat.mid) {
					this.focus = "input";
					return;
				}
				this.spawn(this.openSelected(), "チャットを開く");
				return;
			}
			case "filter":
				this.focus = "filter";
				this.filterCursor = this.offsetAt(
					this.filter,
					event.x - (this.layout?.filter?.innerCol ?? 0),
				);
				return;
			case "input":
				this.focus = "input";
				this.placeCaretInInput(event.x, event.y);
				return;
			case "back":
				return this.closeChat();
			case "hint":
				return this.spawn(this.runHint(action.id), "操作");
			case "overlay":
				return this.spawn(this.runOverlayAction(action.id), "操作");
		}
	}

	private scrollToY(y: number): void {
		const bar = this.layout?.scrollbar;
		if (!bar || !this.openMid) return;
		const fraction = clamp((y - bar.top) / Math.max(1, bar.height), 0, 1);
		const maxScroll = Math.max(0, this.messageRows(this.openMid) - bar.height);
		this.msgScroll = Math.round((1 - fraction) * maxScroll);
	}

	private placeCaretInInput(x: number, y: number): void {
		const input = this.layout?.input;
		if (!input) return;
		const wrapped = wrapInput(this.input, input.innerWidth);
		const lineIndex = clamp(
			y - (input.box.row + 1) + input.scroll,
			0,
			wrapped.lines.length - 1,
		);
		const start = wrapped.starts[lineIndex] ?? 0;
		const line = wrapped.lines[lineIndex] ?? "";
		this.inputCursor = clamp(
			start + this.offsetAt(line, x - (input.innerCol + 1)),
			0,
			chars(this.input).length,
		);
		this.keepCaretVisible();
	}

	private offsetAt(text: string, col: number): number {
		let used = 0;
		let index = 0;
		for (const ch of chars(text)) {
			const width = cellWidth(ch);
			if (used + width / 2 > col) break;
			used += width;
			index++;
		}
		return index;
	}

	private setInput(text: string, cursor?: number): void {
		this.input = text;
		const length = chars(text).length;
		this.inputCursor = clamp(cursor ?? length, 0, length);
		this.paletteSelected = 0;
		this.keepCaretVisible();
	}

	private insertText(text: string): void {
		const clean = text
			.replace(/\r\n?/g, "\n")
			// deno-lint-ignore no-control-regex
			.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
		if (!clean) return;
		const parts = chars(this.input).slice();
		const add = chars(clean);
		parts.splice(this.inputCursor, 0, ...add);
		this.setInput(parts.join(""), this.inputCursor + add.length);
	}

	private moveCursorTo(index: number): void {
		this.inputCursor = clamp(index, 0, chars(this.input).length);
		this.keepCaretVisible();
	}

	private wordStart(index: number): number {
		const parts = chars(this.input).slice();
		let i = index;
		while (i > 0 && parts[i - 1].trim() === "") i--;
		while (i > 0 && parts[i - 1].trim() !== "") i--;
		return i;
	}

	private wordEnd(index: number): number {
		const parts = chars(this.input).slice();
		let i = index;
		while (i < parts.length && parts[i].trim() === "") i++;
		while (i < parts.length && parts[i].trim() !== "") i++;
		return i;
	}

	private deleteWordBackward(): void {
		const start = this.wordStart(this.inputCursor);
		const parts = chars(this.input).slice();
		parts.splice(start, this.inputCursor - start);
		this.setInput(parts.join(""), start);
	}

	private newline(): void {
		this.insertText("\n");
	}

	private keepCaretVisible(): void {
		const wrapped = wrapInput(this.input, this.inputWidth());
		let lineIndex = 0;
		for (let i = 0; i < wrapped.starts.length; i++) {
			if (wrapped.starts[i] <= this.inputCursor) lineIndex = i;
		}
		const rows = this.layout?.input
			? Math.max(1, this.layout.input.box.height - 2)
			: 1;
		if (lineIndex < this.inputScroll) this.inputScroll = lineIndex;
		else if (lineIndex >= this.inputScroll + rows) {
			this.inputScroll = lineIndex - rows + 1;
		}
		this.inputScroll = clamp(
			this.inputScroll,
			0,
			Math.max(0, wrapped.lines.length - rows),
		);
	}

	private recallHistory(direction: number): void {
		const wrapped = wrapInput(this.input, this.inputWidth());
		let lineIndex = 0;
		for (let i = 0; i < wrapped.starts.length; i++) {
			if (wrapped.starts[i] <= this.inputCursor) lineIndex = i;
		}
		// 複数行を編集中は履歴ではなく行移動にする
		if (wrapped.lines.length > 1) {
			const target = clamp(lineIndex + direction, 0, wrapped.lines.length - 1);
			if (target === lineIndex) return;
			const col = this.inputCursor - (wrapped.starts[lineIndex] ?? 0);
			const start = wrapped.starts[target] ?? 0;
			const length = chars(wrapped.lines[target] ?? "").length;
			this.moveCursorTo(start + clamp(col, 0, length));
			return;
		}
		if (!this.history.length) return;
		if (direction < 0) {
			if (this.historyIndex === -1) {
				this.historyDraft = this.input;
				this.historyIndex = this.history.length - 1;
			} else if (this.historyIndex > 0) {
				this.historyIndex--;
			}
			this.setInput(this.history[this.historyIndex] ?? "");
			return;
		}
		if (this.historyIndex === -1) return;
		if (this.historyIndex >= this.history.length - 1) {
			this.historyIndex = -1;
			this.setInput(this.historyDraft);
			return;
		}
		this.historyIndex++;
		this.setInput(this.history[this.historyIndex] ?? "");
	}

	private selectedChat(): ChatItem | null {
		return this.visibleChats()[this.selectedIndex] ?? null;
	}

	private async openSelected(): Promise<void> {
		const chat = this.selectedChat();
		if (!chat) {
			this.toast("チャットがありません", "warn");
			return;
		}
		await this.openChatByMid(chat.mid);
	}

	private async openChatByMid(mid: string): Promise<void> {
		const chat = this.chats.find((item) => item.mid === mid);
		if (!chat) return;
		this.openMid = mid;
		this.msgScroll = 0;
		this.inputScroll = 0;
		this.focus = "input";
		const cached = this.messages.get(mid);
		if (!cached?.length) {
			await this.withBusy("履歴を読み込み中", () => this.loadHistory(mid));
		} else {
			this.unreadFrom.set(mid, Math.max(0, cached.length - chat.unread));
			void this.markRead(mid);
		}
		this.render();
	}

	private closeChat(): void {
		this.openMid = null;
		this.msgScroll = 0;
		this.focus = "list";
		this.draggingScroll = false;
	}

	private async loadHistory(mid: string, older = false): Promise<void> {
		const chat = this.chats.find((item) => item.mid === mid);
		const before = older ? this.oldestId.get(mid) : undefined;
		const previous = this.messages.get(mid) ?? [];
		const width = this.messageWidth();
		const unreadBefore = this.unreadFrom.get(mid) ?? NONE;
		const beforeRows = older
			? countMessageRows(
				previous,
				width,
				unreadBefore,
				Date.now(),
				chat?.kind !== "user",
			)
			: 0;

		const result = await this.backend.history(mid, {
			before,
			limit: PAGE_SIZE,
		});
		let merged = older ? [...result.messages, ...previous] : result.messages;
		if (!older) {
			const newest = result.messages.at(-1);
			const extra = newest
				? previous.filter((item) => item.time > newest.time)
				: previous;
			if (extra.length) merged = [...merged, ...extra];
		}
		this.messages.set(mid, merged);
		this.hasMore.set(mid, result.hasMore);
		const first = merged[0];
		if (first) this.oldestId.set(mid, first.id);

		if (older) {
			const afterRows = countMessageRows(
				merged,
				width,
				unreadBefore + result.messages.length,
				Date.now(),
				chat?.kind !== "user",
			);
			this.unreadFrom.set(mid, unreadBefore + result.messages.length);
			this.msgScroll += Math.max(0, afterRows - beforeRows);
		} else {
			this.unreadFrom.set(
				mid,
				Math.max(0, merged.length - (chat?.unread ?? 0)),
			);
			this.msgScroll = 0;
			void this.markRead(mid);
		}
		this.adjustScroll();
	}

	private async markRead(mid: string): Promise<void> {
		const messages = this.messages.get(mid);
		const last = messages?.[messages.length - 1];
		if (!last) return;
		const chat = this.chats.find((item) => item.mid === mid);
		if (chat?.unread) {
			chat.unread = 0;
			this.touchChats();
		}
		try {
			await this.backend.markRead(mid, last.id);
		} catch {}
	}

	private scrollMessages(delta: number, unit: "rows" | "page"): void {
		const area = this.layout?.messages;
		if (!area || !this.openMid) return;
		const amount = unit === "page"
			? Math.sign(delta || 1) * Math.max(1, area.height - 2)
			: delta;
		const maxScroll = Math.max(0, this.messageRows(this.openMid) - area.height);
		const wasAtTop = this.msgScroll >= maxScroll;
		const next = clamp(this.msgScroll + amount, 0, maxScroll);
		this.msgScroll = next;
		if (
			delta > 0 && wasAtTop && next === maxScroll &&
			this.hasMore.get(this.openMid) && !this.busy
		) {
			const mid = this.openMid;
			this.spawn(
				this.withBusy(
					"古いメッセージを読み込み中",
					() => this.loadHistory(mid, true),
				),
				"履歴の読み込み",
			);
		}
	}

	private async submit(): Promise<void> {
		const text = this.input.trim();
		if (!text) {
			if (!this.openMid) this.toast("先にチャットを開いてください", "warn");
			return;
		}
		if (text.startsWith("/")) {
			if (text.startsWith("//")) {
				return void await this.sendMessage(text.slice(1));
			}
			return void await this.runCommand(text);
		}
		await this.sendMessage(text);
	}

	private async sendMessage(text: string): Promise<void> {
		const chat = this.openChat();
		if (!chat) {
			this.toast("先にチャットを開いてください", "warn");
			this.focus = "list";
			return;
		}
		const tempId = `local:${Date.now()}:${this.localSeq++}`;
		const optimistic: MessageItem = {
			id: tempId,
			time: Date.now(),
			who: "自分",
			body: text,
			mine: true,
			status: "sending",
		};
		this.messages.set(chat.mid, [
			...(this.messages.get(chat.mid) ?? []),
			optimistic,
		]);
		this.sentIds.add(tempId);
		this.pushHistory(text);
		this.setInput("");
		this.msgScroll = 0;
		chat.time = optimistic.time;
		chat.preview = singleLine(text);
		chat.previewWho = undefined;
		chat.unread = 0;
		this.sortChats();
		this.render();
		try {
			const id = await this.backend.send(chat.mid, text);
			this.sentIds.add(id);
			this.patchMessage(chat.mid, tempId, { id, status: "sent" });
		} catch (error) {
			this.patchMessage(chat.mid, tempId, { status: "failed" });
			this.toast(`送信に失敗: ${message(error)}`, "error");
		}
		this.scheduleRender();
	}

	private patchMessage(
		mid: string,
		id: string,
		patch: Partial<MessageItem>,
	): void {
		const list = this.messages.get(mid);
		if (!list) return;
		this.messages.set(
			mid,
			list.map((item) => item.id === id ? { ...item, ...patch } : item),
		);
	}

	private pushHistory(text: string): void {
		if (this.history.at(-1) === text) return;
		this.history.push(text);
		if (this.history.length > HISTORY_LIMIT) this.history.shift();
		this.historyIndex = -1;
		this.historyDraft = "";
	}

	private async reloadChats(label = "読み込み中"): Promise<void> {
		const keepMid = this.selectedChat()?.mid ?? this.openMid ?? undefined;
		await this.withBusy(label, async () => {
			this.chats = await this.backend.listChats();
			this.touchChats();
		});
		this.connected = true;
		this.sortChats();
		if (keepMid) {
			const index = this.visibleChats().findIndex((chat) =>
				chat.mid === keepMid
			);
			if (index >= 0) this.select(index);
			else this.select(0);
		} else {
			this.select(clamp(this.selectedIndex, 0, this.visibleChats().length - 1));
		}
		const open = this.openChat();
		if (open) {
			const cached = this.messages.get(open.mid);
			if (cached) {
				this.unreadFrom.set(open.mid, cached.length);
				open.unread = 0;
			}
		}
	}

	private sortChats(): void {
		this.chats.sort((a, b) => b.time - a.time);
		this.touchChats();
	}

	private async withBusy<T>(label: string, task: () => Promise<T>): Promise<T> {
		const previous = this.busy;
		this.busy = label;
		this.scheduleRender();
		try {
			return await task();
		} finally {
			this.busy = previous;
			this.scheduleRender();
		}
	}

	private spawn(task: Promise<unknown>, label: string): void {
		task.catch((error) => {
			this.busy = null;
			this.toast(`${label}に失敗: ${message(error)}`, "error");
			this.scheduleRender();
		});
	}

	private toast(text: string, kind: NoticeKind = "info"): void {
		this.toasts = [
			...this.toasts.slice(-(MAX_TOASTS - 1)),
			{
				id: ++this.toastSeq,
				kind,
				text: singleLine(text),
				until: Date.now() + TOAST_MS,
			},
		];
		this.scheduleRender();
	}

	private cycleTheme(): void {
		const order: ThemeName[] = ["dark", "light", "mono"];
		const index = Math.max(0, order.indexOf(this.themeName));
		this.themeName = order[(index + 1) % order.length];
		this.theme = createTheme(this.themeName, this.colorMode);
		this.screen.invalidate();
		this.toast(`テーマ: ${this.themeName}`, "info");
	}

	private askQuit(): void {
		this.overlay = {
			kind: "confirm",
			title: "終了",
			message: "LINE CLI を終了しますか？",
			action: "終了する",
		};
	}

	private showHelp(): void {
		this.overlay = { kind: "help", scroll: 0 };
	}

	private async showInfo(chat: ChatItem | null): Promise<void> {
		const target = chat ?? this.openChat();
		if (!target) {
			this.toast("チャットを選んでください", "warn");
			return;
		}
		this.overlay = {
			kind: "info",
			title: singleLine(target.name),
			rows: [["読み込み中…", ""]],
			scroll: 0,
		};
		this.render();
		try {
			const info = await this.backend.chatInfo(target.mid);
			if (this.overlay?.kind === "info") this.overlay.rows = info.rows;
		} catch (error) {
			if (this.overlay?.kind === "info") {
				this.overlay.rows = [["エラー", message(error)]];
			}
		}
		this.scheduleRender();
	}

	private showChatMenu(at?: { row: number; col: number }): void {
		const chat = this.selectedChat();
		const items: MenuItem[] = [
			...(chat
				? [
					{ id: "menu-open", label: "開く", hint: "Enter" },
					{ id: "menu-info", label: "チャット情報", hint: "i" },
				]
				: []),
			{ id: "menu-reload", label: "一覧を更新", hint: "r" },
			{ id: "menu-theme", label: "テーマ切替", hint: "t" },
			{ id: "menu-help", label: "ヘルプ", hint: "?" },
			{ id: "menu-quit", label: "終了", hint: "Ctrl+C" },
		];
		this.overlay = at
			? { kind: "menu", items, selected: 0, at }
			: { kind: "menu", items, selected: 0 };
	}

	private async runOverlayAction(id: string): Promise<void> {
		if (id === "close") return this.closeOverlay();
		if (id.startsWith("palette:")) {
			const index = Number(id.slice("palette:".length));
			const item = this.commandCandidates()[index];
			if (item) await this.runPalette(item.label);
			return;
		}
		switch (id) {
			case "menu-open":
				return void await this.openSelected();
			case "menu-info":
				return void await this.showInfo(this.selectedChat());
			case "menu-reload":
				return void await this.reloadChats("再読み込み中");
			case "menu-theme":
				return this.cycleTheme();
			case "menu-help":
				return this.showHelp();
			case "menu-quit":
				return this.askQuit();
			default:
				return void await this.runHint(id);
		}
	}

	private async runHint(id: string): Promise<void> {
		switch (id) {
			case "send":
				return void await this.submit();
			case "open":
				return void await this.openSelected();
			case "back":
				if (this.openMid) return this.closeChat();
				this.focus = "list";
				return;
			case "search":
				this.focus = "filter";
				return;
			case "focus-list":
				this.focus = "list";
				return;
			case "focus-input":
				this.focus = this.openMid ? "input" : "filter";
				return;
			case "reload":
				return void await this.reloadChats("再読み込み中");
			case "info":
				return void await this.showInfo(this.selectedChat());
			case "theme":
				return this.cycleTheme();
			case "help":
				return this.showHelp();
			case "quit":
				return this.askQuit();
			case "history":
				return this.recallHistory(-1);
			case "newline":
				return this.newline();
			case "command":
				this.focus = "input";
				if (!this.input) this.setInput("/");
				return;
			case "select":
				return this.move(1);
			case "filter-open": {
				if (this.visibleChats().length) {
					this.select(0);
					return void await this.openSelected();
				}
				return this.toast("見つかりませんでした", "warn");
			}
			case "filter-clear":
				this.filter = "";
				this.filterCursor = 0;
				this.focus = "list";
				this.select(0);
				return;
			case "filter-list":
				this.focus = "list";
				return;
			case "overlay-close":
				return this.closeOverlay();
			case "overlay-up":
				return this.scrollOverlay(-1);
			case "overlay-scroll":
				return this.scrollOverlay(-1);
			case "overlay-ok":
				if (this.overlay?.kind === "confirm") return this.quit(0);
				return this.closeOverlay();
			case "palette-next":
			case "palette-run": {
				const items = this.commandCandidates();
				const item = items[clamp(this.paletteSelected, 0, items.length - 1)];
				if (!item) return;
				if (id === "palette-next") {
					this.paletteSelected = (this.paletteSelected + 1) % items.length;
					this.setInput(item.label + " ");
					return;
				}
				return void await this.runPalette(item.label);
			}
			default:
				return;
		}
	}

	private commands(): Command[] {
		return [
			{
				name: "/help",
				aliases: ["/?"],
				description: "操作一覧を表示",
				run: () => this.showHelp(),
			},
			{
				name: "/open",
				aliases: ["/o"],
				description: "チャットを開く",
				arg: "<番号|名前>",
				run: async (arg) => {
					const chat = this.findChat(arg);
					if (!chat) {
						if (arg) this.toast(`見つかりません: ${singleLine(arg)}`, "warn");
						return;
					}
					const index = this.visibleChats().findIndex((item) =>
						item.mid === chat.mid
					);
					if (index >= 0) this.select(index);
					await this.openChatByMid(chat.mid);
				},
			},
			{
				name: "/close",
				aliases: ["/back"],
				description: "チャットを閉じる",
				run: () => this.closeChat(),
			},
			{
				name: "/send",
				aliases: [],
				description: "「/」で始まる文を送る",
				arg: "<本文>",
				run: async (arg) => {
					if (!arg) return this.toast("使い方: /send <本文>", "warn");
					await this.sendMessage(arg);
				},
			},
			{
				name: "/search",
				aliases: ["/find"],
				description: "チャットを検索",
				arg: "<語>",
				run: (arg) => {
					this.filter = singleLine(arg);
					this.filterCursor = chars(this.filter).length;
					this.focus = "filter";
					this.select(0);
				},
			},
			{
				name: "/reload",
				aliases: ["/chats", "/list", "/r"],
				description: "チャット一覧を再読み込み",
				run: async () => {
					await this.reloadChats("再読み込み中");
					this.toast("一覧を更新しました", "success");
				},
			},
			{
				name: "/info",
				aliases: [],
				description: "チャット情報",
				run: async () => {
					await this.showInfo(this.openChat() ?? this.selectedChat());
				},
			},
			{
				name: "/me",
				aliases: [],
				description: "自分のプロフィール",
				run: () => {
					const me = this.backend.me;
					if (!me) return this.toast("未取得", "warn");
					this.overlay = {
						kind: "info",
						title: "あなた",
						rows: [
							["名前", me.name],
							["mid", me.mid],
							["状態", me.status ?? "-"],
						],
						scroll: 0,
					};
				},
			},
			{
				name: "/theme",
				aliases: [],
				description: "テーマ (dark|light|mono)",
				arg: "<名前>",
				run: (arg) => {
					const name = arg.trim().toLowerCase();
					if (name === "dark" || name === "light" || name === "mono") {
						this.themeName = name;
						this.theme = createTheme(name, this.colorMode);
						this.screen.invalidate();
						this.toast(`テーマ: ${name}`, "success");
						return;
					}
					this.cycleTheme();
				},
			},
			{
				name: "/clear",
				aliases: [],
				description: "入力欄を空にする",
				run: () => this.setInput(""),
			},
			{
				name: "/redraw",
				aliases: [],
				description: "画面を描き直す",
				run: () => this.screen.invalidate(),
			},
			{
				name: "/quit",
				aliases: ["/exit", "/q"],
				description: "終了",
				run: () => this.askQuit(),
			},
		];
	}

	private commandCandidates(): PaletteItem[] {
		const name = (this.input.trim().split(/\s+/)[0] ?? "").toLowerCase();
		const hits = this.commands().filter((command) =>
			command.name.startsWith(name) ||
			command.aliases.some((alias) => alias.startsWith(name))
		);
		const list = hits.map((command) => ({
			label: command.name + (command.arg ? ` ${command.arg}` : ""),
			description: command.description,
		}));
		this.paletteSelected = clamp(
			this.paletteSelected,
			0,
			Math.max(0, list.length - 1),
		);
		return list;
	}

	private async runPalette(label: string): Promise<void> {
		const name = label.split(" ")[0] ?? label;
		const trimmed = this.input.trim();
		const head = trimmed.split(/\s+/)[0] ?? "";
		const rest = trimmed.slice(head.length).trim();
		this.setInput("");
		await this.runCommand(rest ? `${name} ${rest}` : name);
	}

	private async runCommand(text: string): Promise<void> {
		const trimmed = text.trim();
		const [head = ""] = trimmed.split(/\s+/);
		const name = head.toLowerCase();
		const arg = trimmed.slice(head.length).trim();
		const command = this.commands().find((item) =>
			item.name === name || item.aliases.includes(name)
		);
		if (!command) {
			this.toast(`不明なコマンド: ${name}  ( /help )`, "error");
			return;
		}
		this.setInput("");
		try {
			await command.run(arg);
		} catch (error) {
			this.toast(`${name} に失敗: ${message(error)}`, "error");
		}
	}

	private findChat(query: string): ChatItem | null {
		const text = singleLine(query);
		if (!text) return null;
		if (/^[1-9]\d*$/.test(text)) {
			return this.visibleChats()[Number(text) - 1] ?? null;
		}
		const exact = this.chats.find((chat) =>
			chat.mid === text || singleLine(chat.name) === text
		);
		if (exact) return exact;
		const lower = text.toLowerCase();
		const hits = this.chats.filter((chat) =>
			singleLine(chat.name).toLowerCase().includes(lower)
		);
		if (hits.length === 1) return hits[0];
		if (hits.length > 1) {
			this.filter = text;
			this.filterCursor = chars(text).length;
			this.focus = "filter";
			this.select(0);
			this.toast(`候補 ${hits.length} 件に絞り込みました`, "info");
		}
		return null;
	}

	private onBackendEvent(event: BackendEvent): void {
		switch (event.type) {
			case "notice":
				return this.toast(event.text, event.kind);
			case "state":
				this.connected = event.connected;
				if (event.text !== undefined) this.statusText = event.text;
				return this.scheduleRender();
			case "message":
				return this.onIncoming(event.chat, event.message);
		}
	}

	private onIncoming(chat: ChatItem, incoming: MessageItem): void {
		const index = this.chats.findIndex((item) => item.mid === chat.mid);
		if (index >= 0) {
			const prev = this.chats[index];
			this.chats[index] = {
				...prev,
				...chat,
				unread: Math.max(prev.unread, chat.unread),
			};
		} else this.chats.push(chat);
		this.sortChats();

		const isOpen = this.openMid === chat.mid;
		if (this.sentIds.has(incoming.id)) return;
		const list = this.messages.get(chat.mid) ?? [];
		if (list.some((item) => item.id === incoming.id)) return;

		if (isOpen) {
			const width = this.messageWidth();
			const unread = this.unreadFrom.get(chat.mid) ?? NONE;
			const grouped = chat.kind !== "user";
			const before = this.msgScroll > 0
				? countMessageRows(list, width, unread, Date.now(), grouped)
				: 0;
			const next = [...list, incoming];
			this.messages.set(chat.mid, next);
			if (this.msgScroll > 0) {
				const after = countMessageRows(
					next,
					width,
					unread,
					Date.now(),
					grouped,
				);
				this.msgScroll += Math.max(0, after - before);
			}
			const entry = this.chats.find((item) => item.mid === chat.mid);
			if (entry) entry.unread = 0;
			this.unreadFrom.set(chat.mid, next.length);
			void this.markRead(chat.mid);
		} else {
			this.messages.set(chat.mid, [...list, incoming]);
			const entry = this.chats.find((item) => item.mid === chat.mid);
			if (entry && !incoming.mine) entry.unread++;
		}
		this.touchChats();
		this.ensureSelectedVisible();
		this.adjustScroll();
		this.scheduleRender();
	}
}

function message(error: unknown): string {
	return singleLine(error instanceof Error ? error.message : String(error));
}
