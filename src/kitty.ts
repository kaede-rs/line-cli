import { type CellPx } from "./media.ts";

export type Rect = { row: number; col: number; cols: number; rows: number };
export type MediaData = {
	mime: "image/png" | "image/jpeg";
	bytes: Uint8Array;
};

const LRU_MAX = 64;
const CHUNK = 4096;

function toBase64(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

export class KittyEngine {
	#write: (chunk: string) => void;
	#cell: CellPx | null = null;
	#enabled = false;
	#sig: string | null = null;
	#ids = new Map<string, number>();
	#nextId = 0;

	constructor(write: (chunk: string) => void) {
		this.#write = write;
	}

	get active(): boolean {
		return this.#enabled;
	}

	enable(cell: CellPx | null): void {
		this.#enabled = true;
		this.#cell = cell;
		this.#forget();
		this.#clearAll();
	}

	disable(): void {
		this.#enabled = false;
		this.#cell = null;
		this.#forget();
		this.#clearAll();
	}

	dirty(): void {
		this.#sig = null;
	}

	frame(items: { key: string; rect: Rect; media?: MediaData }[]): void {
		const sig = items
			.map((it) =>
				`${it.key}:${it.rect.row},${it.rect.col},${it.rect.cols},${it.rect.rows}`
			)
			.join("|");
		if (this.#sig === sig) return;
		this.#sig = sig;
		this.#clearAll();
		const placed: { id: number; rect: Rect }[] = [];
		for (const it of items) {
			const id = this.#ids.get(it.key);
			if (id === undefined) {
				if (!it.media) continue;
				placed.push({ id: this.#send(it.key, it.media), rect: it.rect });
			} else {
				this.#ids.delete(it.key);
				this.#ids.set(it.key, id);
				placed.push({ id, rect: it.rect });
			}
		}
		for (const p of placed) this.#place(p.id, p.rect);
	}

	#forget(): void {
		this.#ids.clear();
		this.#nextId = 0;
		this.#sig = null;
	}

	#clearAll(): void {
		this.#write("\x1b_Ga=d,d=A,q=1\x1b\\");
	}

	#send(key: string, media: MediaData): number {
		const id = ++this.#nextId;
		this.#ids.set(key, id);
		const f = media.mime === "image/png" ? 100 : 101;
		const b64 = toBase64(media.bytes);
		const n = Math.ceil(b64.length / CHUNK) || 1;
		for (let k = 0; k < n; k++) {
			const m = k < n - 1 ? 1 : 0;
			const chunk = b64.slice(k * CHUNK, (k + 1) * CHUNK);
			this.#write(`\x1b_Ga=t,f=${f},i=${id},m=${m},q=1;${chunk}\x1b\\`);
		}
		while (this.#ids.size > LRU_MAX) {
			const oldest = this.#ids.entries().next().value!;
			this.#ids.delete(oldest[0]);
			this.#write(`\x1b_Ga=d,d=i,i=${oldest[1]},q=1\x1b\\`);
		}
		return id;
	}

	#place(id: number, rect: Rect): void {
		const { row, col, cols, rows } = rect;
		this.#write(
			`\x1b[${row + 1};${
				col + 1
			}H\x1b_Ga=p,i=${id},c=${cols},r=${rows},q=1\x1b\\`,
		);
	}
}
