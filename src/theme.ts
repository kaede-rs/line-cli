export type Color = number;
export const DEFAULT: Color = -1;

export type ColorMode = "truecolor" | "256" | "16" | "none";

export type Style = {
	fg?: Color;
	bg?: Color;
	bold?: boolean;
	dim?: boolean;
	italic?: boolean;
	underline?: boolean;
	reverse?: boolean;
};

export type ThemeName = "dark" | "light" | "mono";

export type Palette = {
	appBg: Color;
	panelBg: Color;
	panelAltBg: Color;
	barBg: Color;
	border: Color;
	borderStrong: Color;
	text: Color;
	textDim: Color;
	textFaint: Color;
	onAccent: Color;
	accent: Color;
	accentSoft: Color;
	badgeBg: Color;
	badgeFg: Color;
	bubbleMineBg: Color;
	bubbleMineFg: Color;
	bubbleOtherBg: Color;
	bubbleOtherFg: Color;
	selectedBg: Color;
	selectedFg: Color;
	inputBg: Color;
	ok: Color;
	warn: Color;
	err: Color;
	info: Color;
	avatar: Color[];
	sender: Color[];
};

const hex = (value: string): Color => parseInt(value, 16);

const DARK: Palette = {appBg:hex("14161a"),panelBg:hex("1b1e24"),panelAltBg:hex("22262e"),barBg:hex("0f1115"),border:hex("343a45"),borderStrong:hex("4b5361"),text:hex("eceff4"),textDim:hex("9aa3b2"),textFaint:hex("6b7280"),onAccent:hex("ffffff"),accent:hex("06c755"),accentSoft:hex("0a8f42"),badgeBg:hex("06c755"),badgeFg:hex("04240f"),bubbleMineBg:hex("06c755"),bubbleMineFg:hex("05250f"),bubbleOtherBg:hex("2a2f38"),bubbleOtherFg:hex("eceff4"),selectedBg:hex("2b3947"),selectedFg:hex("ffffff"),inputBg:hex("1f232a"),ok:hex("3ddc84"),warn:hex("f5b942"),err:hex("ff6b6b"),info:hex("5aa2ff"),avatar:[hex("e0567a"),hex("f0883e"),hex("c9a227"),hex("3ddc84"),hex("2bb3c0"),hex("5a8dee"),hex("9b6ef3"),hex("e06fae")],sender:[hex("5ad2e0"),hex("e58bd0"),hex("7fb2ff"),hex("f0c869")]};
const LIGHT: Palette = {appBg:hex("ffffff"),panelBg:hex("f2f3f5"),panelAltBg:hex("e7e9ec"),barBg:hex("eceef1"),border:hex("d3d7dd"),borderStrong:hex("b6bcc6"),text:hex("1f2328"),textDim:hex("5b6472"),textFaint:hex("8a919c"),onAccent:hex("ffffff"),accent:hex("06c755"),accentSoft:hex("0a8f42"),badgeBg:hex("06c755"),badgeFg:hex("ffffff"),bubbleMineBg:hex("06c755"),bubbleMineFg:hex("ffffff"),bubbleOtherBg:hex("f0f1f3"),bubbleOtherFg:hex("1f2328"),selectedBg:hex("dfe9e2"),selectedFg:hex("12261a"),inputBg:hex("f7f8f9"),ok:hex("0f9d58"),warn:hex("b26a00"),err:hex("d93025"),info:hex("1a73e8"),avatar:[hex("d64570"),hex("dd7a2c"),hex("a8860f"),hex("1f9d55"),hex("1c8f9c"),hex("3b74d8"),hex("7b52d6"),hex("c74f96")],sender:[hex("1c8f9c"),hex("b0448f"),hex("3b74d8"),hex("a06d00")]};
const MONO: Palette = {...DARK,appBg:DEFAULT,panelBg:DEFAULT,panelAltBg:DEFAULT,barBg:DEFAULT,border:DEFAULT,borderStrong:DEFAULT,text:DEFAULT,textDim:DEFAULT,textFaint:DEFAULT,onAccent:DEFAULT,accent:DEFAULT,accentSoft:DEFAULT,badgeBg:DEFAULT,badgeFg:DEFAULT,bubbleMineBg:DEFAULT,bubbleMineFg:DEFAULT,bubbleOtherBg:DEFAULT,bubbleOtherFg:DEFAULT,selectedBg:DEFAULT,selectedFg:DEFAULT,inputBg:DEFAULT,ok:DEFAULT,warn:DEFAULT,err:DEFAULT,info:DEFAULT,avatar:new Array(8).fill(DEFAULT),sender:new Array(4).fill(DEFAULT)};

export type Env = Record<string, string | undefined>;

export function detectColorMode(env: Env = {}, isTerminal = true): ColorMode {
	if (!isTerminal || env.NO_COLOR !== undefined && env.NO_COLOR !== "0") {
		return "none";
	}
	const term = env.TERM ?? "";
	const colorterm = env.COLORTERM ?? "";
	const program = env.TERM_PROGRAM ?? "";
	if (term === "dumb") return "none";
	if (
		colorterm === "truecolor" || colorterm === "24bit" ||
		/24bit|direct|truecolor/i.test(term)
	) {
		return "truecolor";
	}
	if (
		/^(iTerm|WezTerm|kitty|Alacritty|Hyper|WarpTerminal|Tabby|rio|contour|ghostty)/i
			.test(program) ||
		/^([a-z]+-)?(kitty|alacritty|wezterm|ghostty)/i.test(term)
	) {
		return "truecolor";
	}
	if (/256/i.test(term) || /256/i.test(colorterm)) return "256";
	if (term && term !== "dumb") return "16";
	return "16";
}

const BASE16: [number, number, number][] = [[0,0,0],[205,49,49],[13,188,121],[229,229,16],[36,114,200],[188,63,188],[17,168,205],[229,229,229],[102,102,102],[241,76,76],[35,209,139],[245,245,67],[59,142,234],[214,112,214],[41,184,219],[255,255,255]];

const CUBE = [0, 95, 135, 175, 215, 255];

const dist = (a: [number, number, number], b: [number, number, number]) => {
	const dr = a[0] - b[0];
	const dg = a[1] - b[1];
	const db = a[2] - b[2];
	return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
};

const rgbOf = (color: Color): [number, number, number] => [
	(color >> 16) & 0xff,
	(color >> 8) & 0xff,
	color & 0xff,
];

export function rgbTo16(color: Color): number {
	const rgb = rgbOf(color);
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < 16; i++) {
		const d = dist(rgb, BASE16[i]);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

export function rgbTo256(color: Color): number {
	const [r, g, b] = rgbOf(color);
	let best = 0;
	let bestD = Infinity;
	for (let ri = 0; ri < 6; ri++) {
		for (let gi = 0; gi < 6; gi++) {
			for (let bi = 0; bi < 6; bi++) {
				const d = dist([r, g, b], [CUBE[ri], CUBE[gi], CUBE[bi]]);
				if (d < bestD) {
					bestD = d;
					best = 16 + 36 * ri + 6 * gi + bi;
				}
			}
		}
	}
	if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
		for (let i = 0; i < 24; i++) {
			const v = 8 + i * 10;
			const d = dist([r, g, b], [v, v, v]);
			if (d < bestD) {
				bestD = d;
				best = 232 + i;
			}
		}
	}
	const basic = rgbTo16(color);
	if (dist([r, g, b], BASE16[basic]) < bestD * 0.35) return basic;
	return best;
}

export type Theme = {
	name: ThemeName;
	mode: ColorMode;
	p: Palette;
	mono: boolean;
	sgr(style: Style): string;
	reset: string;
};

export function paletteFor(name: ThemeName): Palette {
	return name === "light" ? LIGHT : name === "mono" ? MONO : DARK;
}

function colorParams(
	color: Color,
	mode: ColorMode,
	foreground: boolean,
): string {
	if (color === DEFAULT || mode === "none") return "";
	const [r, g, b] = rgbOf(color);
	if (mode === "truecolor") {
		return `${foreground ? 38 : 48};2;${r};${g};${b}`;
	}
	if (mode === "256") {
		return `${foreground ? 38 : 48};5;${rgbTo256(color)}`;
	}
	const index = rgbTo16(color);
	const base = foreground ? 30 : 40;
	return String(index < 8 ? base + index : base + 60 + (index - 8));
}

export function createTheme(
	name: ThemeName = "dark",
	mode: ColorMode = "truecolor",
): Theme {
	const palette = paletteFor(name);
	const mono = name === "mono" || mode === "none";
	const cache = new Map<string, string>();

	const keyOf = (style: Style): string =>
		`${style.fg ?? ""};${style.bg ?? ""};${style.bold ? "b" : ""}${
			style.dim ? "d" : ""
		}${style.italic ? "i" : ""}${style.underline ? "u" : ""}${
			style.reverse ? "r" : ""
		}`;

	const build = (style: Style): string => {
		const params: string[] = [];
		if (style.bold) params.push("1");
		if (style.dim) params.push("2");
		if (style.italic) params.push("3");
		if (style.underline) params.push("4");
		if (style.reverse) params.push("7");
		if (style.fg !== undefined) {
			const fg = colorParams(style.fg, mode, true);
			if (fg) params.push(fg);
		}
		if (style.bg !== undefined) {
			const bg = colorParams(style.bg, mode, false);
			if (bg) params.push(bg);
		}
		return params.length ? `\x1b[${params.join(";")}m` : "";
	};

	return {
		name,
		mode,
		p: palette,
		mono,
		reset: mode === "none" && mono ? "" : "\x1b[0m",
		sgr(style: Style): string {
			const key = keyOf(style);
			const hit = cache.get(key);
			if (hit !== undefined) return hit;
			const value = build(style);
			cache.set(key, value);
			return value;
		},
	};
}

export function backgroundFromRgb(
	r: number,
	g: number,
  b: number,
): "dark" | "light" {
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	return luminance < 0.45 ? "dark" : "light";
}

export function parseOsc11(reply: string): [number, number, number] | null {
	const match = /rgb:([0-9a-fA-F]+)\/([0-9a-fA-F]+)\/([0-9a-fA-F]+)/.exec(
		reply,
	);
	if (!match) return null;
	const norm = (part: string) => {
		const raw = parseInt(part, 16);
		if (!Number.isFinite(raw)) return 0;
		const bits = Math.max(1, part.length * 4);
		return Math.round(raw / ((1 << bits) - 1) * 255);
	};
	return [norm(match[1]), norm(match[2]), norm(match[3])];
}

export function backgroundFromColorfgbg(
	value: string | undefined,
): "dark" | "light" | null {
	if (!value) return null;
	const parts = value.split(";");
	const last = Number(parts.at(-1));
	if (!Number.isFinite(last)) return null;
	if (last >= 8 && last <= 15) return "light";
	if (last >= 0 && last <= 7) return "dark";
	return null;
}
