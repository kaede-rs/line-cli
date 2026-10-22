import { clipAnsi } from "./text.ts";

export type CursorShape = "bar" | "block" | "underline";

export type CursorState = {
	row: number;
	col: number;
	visible: boolean;
	shape?: CursorShape;
} | null;

const SHAPE_CODE: Record<CursorShape, string> = {
	block: "2",
	underline: "4",
	bar: "6",
};

export class Screen {
	cols = 80;
	rows = 24;
	private prev: string[] = [];
	private prevCursor = "";
	private write: (chunk: string) => void;

	constructor(write: (chunk: string) => void) {
		this.write = write;
	}

	setSize(cols: number, rows: number): boolean {
		const next = { cols: Math.max(1, cols), rows: Math.max(1, rows) };
		if (next.cols === this.cols && next.rows === this.rows) return false;
		this.cols = next.cols;
		this.rows = next.rows;
		this.invalidate();
		return true;
	}

	invalidate(): void {
		this.prev = [];
		this.prevCursor = "";
	}

	draw(lines: string[], cursor: CursorState = null): void {
		const rows = this.rows;
		const force = this.prev.length !== rows;
		const frame: string[] = new Array(rows);
		for (let r = 0; r < rows; r++) {
			frame[r] = clipAnsi(lines[r] ?? "", this.cols);
		}

		let out = "";
		for (let r = 0; r < rows; r++) {
			if (!force && this.prev[r] === frame[r]) continue;
			out += `\x1b[${r + 1};1H\x1b[2K${frame[r]}`;
		}

		const cursorSeq = cursor && cursor.visible
			? `\x1b[${SHAPE_CODE[cursor.shape ?? "bar"]} q` +
				`\x1b[${clamp(cursor.row, 0, rows - 1) + 1};${
					clamp(cursor.col, 0, this.cols - 1) + 1
				}H\x1b[?25h`
			: "\x1b[?25l";
		if (cursorSeq !== this.prevCursor) {
			out += cursorSeq;
			this.prevCursor = cursorSeq;
		}

		this.prev = frame;
		if (out) this.write(out);
	}

	clearScreen(): void {
		this.write("\x1b[2J\x1b[1;1H");
		this.invalidate();
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
