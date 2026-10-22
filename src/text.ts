const graphemes = new Intl.Segmenter("ja", { granularity: "grapheme" });

const segmentCache = new Map<string, string[]>();
const SEGMENT_CACHE_MAX = 2048;
const SEGMENT_CACHE_MAX_LENGTH = 256;

export function chars(text: string): string[] {
	if (text.length > SEGMENT_CACHE_MAX_LENGTH) return split(text);
	const hit = segmentCache.get(text);
	if (hit) return hit;
	const parts = split(text);
	if (segmentCache.size >= SEGMENT_CACHE_MAX) segmentCache.clear();
	segmentCache.set(text, parts);
	return parts;
}

function split(text: string): string[] {
	return Array.from(graphemes.segment(text), (part) => part.segment);
}

function isWide(cp: number): boolean {
	return cp >= 0x1100 && (
		cp <= 0x115f ||
		cp === 0x2329 ||
		cp === 0x232a ||
		(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe10 && cp <= 0xfe19) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
		(cp >= 0x1f300 && cp <= 0x1f64f) ||
		(cp >= 0x1f680 && cp <= 0x1f6ff) ||
		(cp >= 0x1f900 && cp <= 0x1f9ff) ||
		(cp >= 0x20000 && cp <= 0x3fffd)
	);
}

export function graphemeWidth(ch: string): number {
	const cp = ch.codePointAt(0) ?? 0;
	if (cp === 0x200b || cp === 0x200d || cp === 0xfe0f) return 0;
	if (ch.includes("\u200d") || ch.includes("\ufe0f")) return 2;
	if (cp >= 0x0300 && cp <= 0x036f) return 0;
	if (cp < 0x20) return 0;
	return isWide(cp) ? 2 : 1;
}

export function cellWidth(text: string): number {
	let width = 0;
	for (const ch of chars(text)) width += graphemeWidth(ch);
	return width;
}

export function padEnd(text: string, width: number): string {
	const pad = width - cellWidth(text);
	return pad > 0 ? text + " ".repeat(pad) : text;
}

export function padStart(text: string, width: number): string {
	const pad = width - cellWidth(text);
	return pad > 0 ? " ".repeat(pad) + text : text;
}

export function truncate(text: string, max: number, tail = "…"): string {
	if (max <= 0) return "";
	if (cellWidth(text) <= max) return text;
	const tailW = cellWidth(tail);
	let out = "";
	let width = 0;
	for (const ch of chars(text)) {
		const w = graphemeWidth(ch);
		if (width + w > max - tailW) break;
		out += ch;
		width += w;
	}
	return out + tail;
}

export function truncateStart(text: string, max: number, head = "…"): string {
	if (max <= 0) return "";
	if (cellWidth(text) <= max) return text;
	const headW = cellWidth(head);
	const parts = chars(text);
	let out = "";
	let width = 0;
	for (let i = parts.length - 1; i >= 0; i--) {
		const w = graphemeWidth(parts[i]);
		if (width + w > max - headW) break;
		out = parts[i] + out;
		width += w;
	}
	return head + out;
}

export function sliceWidth(text: string, max: number): string {
	if (max <= 0) return "";
	let out = "";
	let width = 0;
	for (const ch of chars(text)) {
		const w = graphemeWidth(ch);
		if (width + w > max) break;
		out += ch;
		width += w;
	}
	return out;
}

export function wrapText(text: string, width: number): string[] {
	const max = Math.max(1, width);
	const lines: string[] = [];
	for (const paragraph of sanitize(text).split("\n")) {
		if (!paragraph) {
			lines.push("");
			continue;
		}
		let line = "";
		let used = 0;
		for (const ch of chars(paragraph)) {
			const w = graphemeWidth(ch);
			if (used + w > max) {
				if (!line) {
					lines.push(ch);
					continue;
				}
				lines.push(line);
				line = "";
				used = 0;
			}
			line += ch;
			used += w;
		}
		if (line) lines.push(line);
	}
	while (lines.length > 1 && lines.at(-1) === "") lines.pop();
	return lines.length ? lines : [""];
}

const ANSI_RE = /\x1b\[[0-9;:?]*[ -/]*[@-~]/g;

export const stripAnsi = (text: string) => text.replace(ANSI_RE, "");

export function sanitize(text: string): string {
	return text
		.replace(/\t/g, "    ")
		.replace(
			/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
			"",
		);
}

export function singleLine(text: string): string {
	return sanitize(text).replace(/\s+/g, " ").trim();
}

const ANSI_STICKY = /^\x1b\[[0-9;:?]*[ -/]*[@-~]/y;

export function clipAnsi(text: string, max: number): string {
	if (max <= 0) return "";
	let out = "";
	let width = 0;
	let i = 0;
	let styled = false;
	while (i < text.length) {
		if (text.charCodeAt(i) === 0x1b) {
			const re = new RegExp(ANSI_STICKY.source, "y");
			const hit = re.exec(text.slice(i));
			if (!hit) break;
      out += hit[0];
			styled = true;
			i += hit[0].length;
			continue;
		}
		const cp = text.codePointAt(i) ?? 0x20;
		const ch = String.fromCodePoint(cp);
		const w = graphemeWidth(ch);
		if (width + w > max) break;
		out += ch;
		width += w;
		i += ch.length;
	}
	return styled ? `${out}\x1b[0m` : out;
}

export function clock(ts: number): string {
	const date = new Date(ts);
	return `${String(date.getHours()).padStart(2, "0")}:${
		String(date.getMinutes()).padStart(2, "0")
	}`;
}

function sameDay(a: Date, b: number): boolean {
	const date = new Date(b);
	return a.getFullYear() === date.getFullYear() &&
		a.getMonth() === date.getMonth() && a.getDate() === date.getDate();
}

export function formatRelative(ts: number, now = Date.now()): string {
	if (!Number.isFinite(ts) || ts <= 0) return "";
	const date = new Date(ts);
	if (sameDay(date, now)) return clock(ts);
	const yesterday = now - 86400000;
	if (sameDay(date, yesterday)) return "昨日";
	const md = `${date.getMonth() + 1}/${date.getDate()}`;
	return date.getFullYear() === new Date(now).getFullYear()
		? md
		: `${String(date.getFullYear()).slice(-2)}/${md}`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function formatDateLabel(ts: number, now = Date.now()): string {
	if (!Number.isFinite(ts) || ts <= 0) return "";
	const date = new Date(ts);
	if (sameDay(date, now)) return "今日";
	if (sameDay(date, now - 86400000)) return "昨日";
	const label = `${date.getMonth() + 1}月${date.getDate()}日(${
		WEEKDAYS[date.getDay()]
	})`;
	return date.getFullYear() === new Date(now).getFullYear()
		? label
		: `${date.getFullYear()}年${label}`;
}

export function shortMid(mid: string): string {
	return mid.length > 8 ? `…${mid.slice(-6)}` : mid;
}

export function hashCode(text: string): number {
	let hash = 0;
	for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) | 0;
	return Math.abs(hash);
}

export function initialOf(name: string): string {
	const text = singleLine(name) || "?";
	return chars(text)[0] ?? "?";
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerFrame(tick: number): string {
	return SPINNER[((tick % SPINNER.length) + SPINNER.length) % SPINNER.length];
}

export function formatAgo(ts: number, now = Date.now()): string {
	const diff = Math.max(0, now - ts);
	if (diff < 60_000) return "たった今";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分前`;
	if (sameDay(new Date(ts), now)) return `${clock(ts)}`;
	return formatRelative(ts, now);
}
