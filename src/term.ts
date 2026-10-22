import { backgroundFromRgb, parseOsc11 } from "./theme.ts";

export type KeyName =
	| "up"
	| "down"
	| "left"
	| "right"
	| "home"
	| "end"
	| "pageup"
	| "pagedown"
	| "insert"
	| "delete"
	| "backspace"
	| "tab"
	| "enter"
	| "escape"
	| "char"
	| "f1"
	| "f2"
	| "f3"
	| "f4"
	| "f5"
	| "f6"
	| "f7"
	| "f8"
	| "f9"
	| "f10"
	| "f11"
	| "f12";

export type KeyEvent = {
	type: "key";
	key: KeyName;
	ch: string;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
};

export type MouseAction = "press" | "release" | "drag" | "wheel";

export type MouseEvent = {
	type: "mouse";
	action: MouseAction;
	button: "left" | "middle" | "right" | null;
	x: number;
	y: number;
	dy: number;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
};

export type PasteEvent = { type: "paste"; text: string };

export type InputEvent = KeyEvent | MouseEvent | PasteEvent;

export function parseEvents(input: string): {
	events: InputEvent[];
	rest: string;
} {
	const events: InputEvent[] = [];
	let buf = input;

	while (buf.length) {
		const code = buf.charCodeAt(0);

		if (code === 0x1b) {
			const parsed = parseEscape(buf);
			if (parsed === "more") break;
			if (parsed === null) {
				buf = buf.slice(1);
				continue;
			}
			if (parsed.event) events.push(parsed.event);
			buf = buf.slice(parsed.size);
			continue;
		}

		if (code < 0x20 || code === 0x7f) {
			const event = controlEvent(code, false);
			if (event) events.push(event);
			buf = buf.slice(1);
			continue;
		}

		let i = 0;
		while (i < buf.length) {
			const c = buf.charCodeAt(i);
			if (c === 0x1b || c < 0x20 || c === 0x7f) break;
			i++;
		}
		events.push({
			type: "key",
			key: "char",
			ch: buf.slice(0, i),
			ctrl: false,
			alt: false,
			shift: false,
		});
		buf = buf.slice(i);
	}

	return { events, rest: buf };
}

type EscapeResult = { event: InputEvent | null; size: number } | "more" | null;

const CSI_KEY: Record<string, KeyName> = {A:"up",B:"down",C:"right",D:"left",F:"end",H:"home",P:"f1",Q:"f2",R:"f3",S:"f4"};
const CSI_NUMBER: Record<string, KeyName> = {1:"home",2:"insert",3:"delete",4:"end",5:"pageup",6:"pagedown",7:"home",8:"end",11:"f1",12:"f2",13:"f3",14:"f4",15:"f5",17:"f6",18:"f7",19:"f8",20:"f9",21:"f10",23:"f11",24:"f12"};

function modifiers(
	value: number,
): { shift: boolean; alt: boolean; ctrl: boolean } {
	const mod = Math.max(0, (value || 1) - 1);
	return {
		shift: (mod & 1) !== 0,
		alt: (mod & 2) !== 0,
		ctrl: (mod & 4) !== 0,
	};
}

function parseEscape(buf: string): EscapeResult {
	if (buf.length === 1) return "more";
	const next = buf.charCodeAt(1);

	if (next === 0x5d || next === 0x50 || next === 0x5f || next === 0x5e) {
		const bel = buf.indexOf("\x07", 2);
		const st = buf.indexOf("\x1b\\", 2);
		const end = bel >= 0 && (st < 0 || bel < st)
			? bel + 1
			: st >= 0
			? st + 2
			: -1;
		if (end < 0) return "more";
		return { event: null, size: end };
	}

	if (next === 0x4f) {
		if (buf.length < 3) return "more";
		const key = CSI_KEY[buf[2]];
		return {
			event: key
				? keyEvent(key, "", { shift: false, alt: false, ctrl: false })
				: null,
			size: 3,
		};
	}

	if (next !== 0x5b) {
    const event = controlEvent(next, true);
		if (event) return { event, size: 2 };
		const ch = Array.from(buf.slice(1))[0] ?? "";
		return {
			event: keyEvent("char", ch, {
				shift: false,
				alt: true,
				ctrl: false,
			}),
			size: 1 + ch.length,
		};
	}

	if (buf.startsWith("\x1b[200~")) {
		const end = buf.indexOf("\x1b[201~");
		if (end < 0) return "more";
		return {
			event: { type: "paste", text: buf.slice(6, end) },
			size: end + 6,
		};
	}

	if (buf[2] === "<") {
		const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(buf);
		if (match) {
			return {
				event: sgrMouse(
					Number(match[1]),
					Number(match[2]),
					Number(match[3]),
					match[4] === "m",
				),
				size: match[0].length,
			};
		}
		if (/^\x1b\[<[\d;]*$/.test(buf)) return "more";
		return null;
	}

	let i = 2;
	while (i < buf.length) {
		const c = buf.charCodeAt(i);
		if (c >= 0x30 && c <= 0x3f) {
			i++;
			continue;
		}
		break;
	}
	while (i < buf.length) {
		const c = buf.charCodeAt(i);
		if (c >= 0x20 && c <= 0x2f) {
      i++;
			continue;
		}
		break;
	}
	if (i >= buf.length) return "more";
	const final = buf[i];
	if (final < "@" || final > "~") return null;

	const params = buf.slice(2, i).split(";");
	const mods = modifiers(Number(params[1]));
	const size = i + 1;

	if (final === "Z") {
		return {
			event: keyEvent("tab", "", { shift: true, alt: false, ctrl: false }),
			size,
		};
	}
	if (final === "~") {
		const key = CSI_NUMBER[params[0]];
		if (!key) return { event: null, size };
		return { event: keyEvent(key, "", mods), size };
	}
	const key = CSI_KEY[final];
	if (!key) return { event: null, size };
	return { event: keyEvent(key, "", mods), size };
}

function keyEvent(
	key: KeyName,
	ch: string,
	mods: { shift: boolean; alt: boolean; ctrl: boolean },
): KeyEvent {
	return { type: "key", key, ch, ...mods };
}

function controlEvent(code: number, alt: boolean): KeyEvent | null {
	const mods = { shift: false, alt, ctrl: false };
	if (code === 0x1b) return keyEvent("escape", "", mods);
	if (code === 0x7f || code === 0x08) return keyEvent("backspace", "", mods);
	if (code === 0x09) return keyEvent("tab", "", mods);
	if (code === 0x0d) return keyEvent("enter", "", mods);
	if (code === 0x0a) {
		return keyEvent("enter", "", { ...mods, ctrl: true });
	}
	if (code === 0x00) {
		return keyEvent("char", " ", { ...mods, ctrl: true });
	}
	if (code >= 0x01 && code <= 0x1a) {
		return keyEvent("char", String.fromCharCode(code + 0x60), {
			...mods,
			ctrl: true,
		});
	}
	return null;
}

function sgrMouse(
	code: number,
	x: number,
	y: number,
	release: boolean,
): MouseEvent {
	const shift = (code & 4) !== 0;
	const alt = (code & 8) !== 0;
	const ctrl = (code & 16) !== 0;
	const wheel = (code & 64) !== 0;
	const drag = (code & 32) !== 0;
	const base: Omit<MouseEvent, "action" | "button" | "dy"> = {
		type: "mouse",
		x: Math.max(0, x - 1),
		y: Math.max(0, y - 1),
		ctrl,
		alt,
		shift,
	};
	if (wheel) {
		const down = (code & 1) === 1;
		return { ...base, action: "wheel", button: null, dy: down ? 1 : -1 };
	}
	const button = (code & 3) === 0
		? "left"
		: (code & 3) === 1
		? "middle"
		: (code & 3) === 2
		? "right"
		: null;
	if (release) return { ...base, action: "release", button, dy: 0 };
	return {
		...base,
		action: drag ? "drag" : "press",
		button,
		dy: 0,
	};
}

export interface Io {
	readonly cols: number;
	readonly rows: number;
	readonly isTTY: boolean;
	write(chunk: string): void;
	start(): Promise<void>;
	stop(): void;
	onEvent(handler: (event: InputEvent) => void): void;
	onResize(handler: () => void): void;
	queryBackground?(): Promise<"dark" | "light" | null>;
}

export type TerminalOptions = {
	mouse?: boolean;
	escTimeout?: number;
};

const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

export class Terminal implements Io {
	cols = 80;
	rows = 24;
	isTTY = false;

	private encoder = new TextEncoder();
	private decoder = new TextDecoder();
	private buffer = "";
	private handlers: ((event: InputEvent) => void)[] = [];
	private resizeHandlers: (() => void)[] = [];
	private escTimer: ReturnType<typeof setTimeout> | undefined;
	private running = false;
	private raw = false;
	private mouse: boolean;
	private escTimeout: number;
	private bgWaiters: ((value: "dark" | "light" | null) => void)[] = [];
	private bgResult: "dark" | "light" | null | undefined;
	private sizeTimer: ReturnType<typeof setInterval> | undefined;
	private signalCleanups: (() => void)[] = [];

	constructor(options: TerminalOptions = {}) {
		this.mouse = options.mouse ?? true;
		this.escTimeout = options.escTimeout ?? 40;
	}

	write(chunk: string): void {
		try {
			Deno.stdout.writeSync(this.encoder.encode(chunk));
		} catch {}
	}

	private measure(): void {
		try {
			const size = Deno.consoleSize();
			this.cols = Math.max(20, size.columns);
			this.rows = Math.max(6, size.rows);
		} catch {
			this.cols = 80;
			this.rows = 24;
		}
	}

	async start(): Promise<void> {
		try {
			this.isTTY = Deno.stdin.isTerminal() && Deno.stdout.isTerminal();
		} catch {
			this.isTTY = false;
		}
		this.measure();
		if (!this.isTTY) return;

		try {
			Deno.stdin.setRaw(true);
			this.raw = true;
		} catch {
			this.raw = false;
		}

		this.running = true;
		this.write(
			"\x1b[?1049h\x1b[0m\x1b[?25l" +
				"\x1b[?2004h" +
				(this.mouse ? MOUSE_ON : "") +
				"\x1b[2J\x1b[1;1H",
		);

		const onSignal = () => {
			this.stop();
			Deno.exit(0);
		};
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			try {
				Deno.addSignalListener(signal, onSignal);
				this.signalCleanups.push(() => {
					try {
						Deno.removeSignalListener(signal, onSignal);
					} catch {}
				});
			} catch {}
		}
		try {
			Deno.addSignalListener("SIGWINCH", () => this.handleResize());
		} catch {
			this.sizeTimer = setInterval(() => this.handleResize(), 1000);
		}

		const scope = globalThis as {
			addEventListener?: (type: string, handler: () => void) => void;
		};
		scope.addEventListener?.("unload", () => this.stop());

		void this.readLoop();
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		if (this.escTimer !== undefined) clearTimeout(this.escTimer);
		if (this.sizeTimer !== undefined) clearInterval(this.sizeTimer);
		for (const cleanup of this.signalCleanups.splice(0)) cleanup();
		this.write(
			(this.mouse ? MOUSE_OFF : "") +
				"\x1b[?2004l\x1b[0 q\x1b[?25h\x1b[0m\x1b[?1049l",
		);
		if (this.raw) {
			try {
				Deno.stdin.setRaw(false);
			} catch {}
			this.raw = false;
		}
	}

	onEvent(handler: (event: InputEvent) => void): void {
		this.handlers.push(handler);
	}

	onResize(handler: () => void): void {
		this.resizeHandlers.push(handler);
	}

	private handleResize(): void {
		const before = { cols: this.cols, rows: this.rows };
		this.measure();
		if (before.cols !== this.cols || before.rows !== this.rows) {
			for (const handler of this.resizeHandlers) handler();
		}
	}

	queryBackground(): Promise<"dark" | "light" | null> {
		if (this.bgResult !== undefined) return Promise.resolve(this.bgResult);
		if (!this.isTTY) return Promise.resolve(null);
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value: "dark" | "light" | null) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				const index = this.bgWaiters.indexOf(finish);
				if (index >= 0) this.bgWaiters.splice(index, 1);
				this.bgResult = value;
				resolve(value);
			};
			const timer = setTimeout(() => finish(null), 150);
			this.bgWaiters.push(finish);
			this.write("\x1b]11;?\x07");
		});
	}

	private emit(event: InputEvent): void {
		for (const handler of this.handlers.slice()) handler(event);
	}

	private async readLoop(): Promise<void> {
		const chunk = new Uint8Array(16384);
		while (this.running) {
			let read: number | null = null;
			try {
				read = await Deno.stdin.read(chunk);
			} catch {
				break;
			}
			if (read === null) {
				this.emit(keyEvent("char", "d", {
					shift: false,
					alt: false,
					ctrl: true,
				}));
				break;
			}
			if (read === 0) continue;
			this.feed(this.decoder.decode(chunk.subarray(0, read), { stream: true }));
		}
	}

	feed(text: string): void {
		const cleaned = this.takeOsc(text);
		this.buffer += cleaned;
		this.flushBuffer();
	}

	private takeOsc(text: string): string {
		if (!text.includes("\x1b]")) return text;
		let out = "";
		let rest = text;
		for (;;) {
			const start = rest.indexOf("\x1b]");
			if (start < 0) {
				out += rest;
				break;
			}
			out += rest.slice(0, start);
			const tail = rest.slice(start);
			const bel = tail.indexOf("\x07");
			const st = tail.indexOf("\x1b\\");
			const end = bel >= 0 && (st < 0 || bel < st)
				? bel + 1
				: st >= 0
				? st + 2
				: -1;
			if (end < 0) {
				this.buffer += tail;
				return out;
			}
			this.handleOsc(tail.slice(0, end));
			rest = tail.slice(end);
		}
		return out;
	}

	private handleOsc(sequence: string): void {
		if (!sequence.startsWith("\x1b]11;")) return;
		const rgb = parseOsc11(sequence);
		if (!rgb || !this.bgWaiters.length) return;
		const value = backgroundFromRgb(rgb[0], rgb[1], rgb[2]);
		for (const waiter of this.bgWaiters.splice(0)) waiter(value);
	}

	private flushBuffer(): void {
		if (!this.buffer) return;
		const { events, rest } = parseEvents(this.buffer);
		this.buffer = rest;
		for (const event of events) this.emit(event);

		if (this.escTimer !== undefined) {
			clearTimeout(this.escTimer);
			this.escTimer = undefined;
		}
		if (!this.buffer) return;
		if (this.buffer.charCodeAt(0) !== 0x1b) {
			this.buffer = "";
			return;
		}
		this.escTimer = setTimeout(() => {
			this.escTimer = undefined;
			if (this.buffer === "\x1b") {
				this.buffer = "";
				this.emit(keyEvent("escape", "", {
					shift: false,
					alt: false,
					ctrl: false,
				}));
			} else {
				this.buffer = "";
			}
		}, this.escTimeout);
	}
}
