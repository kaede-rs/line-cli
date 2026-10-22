import {
	cellWidth,
	chars,
	graphemeWidth,
	padEnd,
	padStart,
	singleLine,
	truncate,
} from "./text.ts";
import { DEFAULT, type Style, type Theme } from "./theme.ts";

type Cell = { ch: string; w: number; s: Style };

export type TextAlign = "left" | "right" | "center";

export type TextOptions = {
	max?: number;
	align?: TextAlign;
	ellipsis?: boolean;
};

const BLANK: Cell = { ch: " ", w: 1, s: {} };

export class Canvas {
	readonly cols: number;
	readonly rows: number;
	private cells: Cell[];
	private base: Style;
	private baseKey: string;

	constructor(cols: number, rows: number, base: Style = {}) {
		this.cols = Math.max(1, Math.floor(cols));
		this.rows = Math.max(1, Math.floor(rows));
		this.base = base;
		this.baseKey = styleKey(base);
		this.cells = new Array(this.cols * this.rows);
		this.clear();
	}

	clear(base?: Style): void {
		if (base) {
			this.base = base;
			this.baseKey = styleKey(base);
		}
		const cell: Cell = { ch: " ", w: 1, s: this.base };
		this.cells.fill(cell);
	}

	private at(row: number, col: number): number {
		return row * this.cols + col;
	}

	inBounds(row: number, col: number): boolean {
		return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
	}

	setCell(row: number, col: number, ch: string, style: Style = this.base) {
		if (!this.inBounds(row, col)) return;
		const width = Math.max(1, graphemeWidth(ch));
		const index = this.at(row, col);
		const cur = this.cells[index];
		if (cur && cur.w === 0 && col > 0) this.cells[index - 1] = BLANK;
		if (cur && cur.w === 2 && col + 1 < this.cols) {
			this.cells[index + 1] = BLANK;
		}
		this.cells[index] = { ch, w: width, s: style };
		if (width === 2) {
			if (col + 1 >= this.cols) {
				this.cells[index] = { ch: " ", w: 1, s: style };
				return;
			}
			this.cells[index + 1] = { ch: "", w: 0, s: style };
		}
	}

	text(
		row: number,
		col: number,
		input: string,
		style: Style = this.base,
		options: TextOptions = {},
	): number {
		if (!this.inBounds(row, col)) return 0;
		const limit = Math.min(
			options.max ?? Infinity,
			this.cols - col,
		);
		if (limit <= 0) return 0;
		let text = singleLine(input);
		if (!text) return 0;
		if (cellWidth(text) > limit) {
			text = options.ellipsis === false
				? cut(text, limit)
				: truncate(text, limit);
		}
		const width = cellWidth(text);
		let cursor = col;
		if (options.align === "right") cursor = col + Math.max(0, limit - width);
		else if (options.align === "center") {
			cursor = col + Math.floor(Math.max(0, limit - width) / 2);
		}
		for (const ch of chars(text)) {
			const w = graphemeWidth(ch);
			if (cursor + w > this.cols) break;
			this.setCell(row, cursor, ch, style);
			cursor += w;
		}
		return width;
	}

	row(
		rowIndex: number,
		col: number,
		width: number,
		text: string,
		style: Style = this.base,
		align: TextAlign = "left",
	): void {
		this.fillRect(rowIndex, col, width, 1, style);
		this.text(rowIndex, col, text, style, { max: width, align });
	}

	fillRect(
		row: number,
		col: number,
		width: number,
		height: number,
		style: Style = this.base,
	): void {
		for (let r = row; r < row + height; r++) {
			if (r < 0 || r >= this.rows) continue;
			for (let c = col; c < col + width; c++) {
				if (c < 0 || c >= this.cols) continue;
				this.setCell(r, c, " ", style);
			}
		}
	}

	hline(
		row: number,
		col: number,
		width: number,
		ch = "─",
		style: Style = this.base,
	): void {
		for (let c = col; c < col + width; c++) this.setCell(row, c, ch, style);
	}

	vline(
		row: number,
		col: number,
		height: number,
		ch = "│",
		style: Style = this.base,
	): void {
		for (let r = row; r < row + height; r++) this.setCell(r, col, ch, style);
	}

	outline(
		row: number,
		col: number,
		width: number,
		height: number,
		style: Style = this.base,
	): void {
		if (width < 2 || height < 2) return;
		this.hline(row, col + 1, width - 2, "─", style);
		this.hline(row + height - 1, col + 1, width - 2, "─", style);
		this.vline(row + 1, col, height - 2, "│", style);
		this.vline(row + 1, col + width - 1, height - 2, "│", style);
		this.setCell(row, col, "╭", style);
		this.setCell(row, col + width - 1, "╮", style);
		this.setCell(row + height - 1, col, "╰", style);
		this.setCell(row + height - 1, col + width - 1, "╯", style);
	}

	render(theme: Theme): string[] {
		// 背景を塗るテーマでは行末の空白も出力する必要がある
		const canTrim = this.base.bg === undefined || this.base.bg === DEFAULT;
		const out: string[] = [];
		for (let r = 0; r < this.rows; r++) {
			let line = "";
			let current: string | null = null;
			let last = this.cols - 1;
			if (canTrim) {
				while (last >= 0) {
					const cell = this.cells[this.at(r, last)];
					if (cell.w === 0) {
						last--;
						continue;
					}
					if (cell.ch !== " " || styleKey(cell.s) !== this.baseKey) break;
					last--;
				}
			}
			for (let c = 0; c <= last; c++) {
				const cell = this.cells[this.at(r, c)];
				if (cell.w === 0) continue;
				const sgr = theme.sgr(cell.s);
				if (sgr !== current) {
					line += (current === null ? "" : theme.reset) + sgr;
					current = sgr;
				}
				line += cell.ch;
			}
			if (current !== null && current !== "") line += theme.reset;
			out.push(line);
		}
		return out;
	}
}

function styleKey(style: Style): string {
	return [
		style.fg ?? "",
		style.bg ?? "",
		style.bold ? 1 : 0,
		style.dim ? 1 : 0,
		style.italic ? 1 : 0,
		style.underline ? 1 : 0,
		style.reverse ? 1 : 0,
	].join("|");
}

function cut(text: string, max: number): string {
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

export { padEnd, padStart };
