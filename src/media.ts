import { type Backend, type MediaInfo, type MessageItem } from "./backend.ts";
import { imageSize, sniffMime } from "./imageSize.ts";

export type CellPx = { w: number; h: number };

export function mediaCellSize(
	input: { pw: number; ph: number },
	maxCols: number,
	cell: CellPx | null,
	opts?: { maxRows?: number; minCols?: number },
): { cols: number; rows: number } {
	const maxRows = opts?.maxRows ?? 24;
	const minCols = opts?.minCols ?? 3;
	const yRatio = cell ? cell.w / cell.h : 0.5;
	const aspect = input.ph / input.pw;
	const rows = Math.round(maxCols * aspect * yRatio);
	if (rows <= maxRows) return { cols: maxCols, rows };
	const cols = Math.max(minCols, Math.floor(maxRows / (aspect * yRatio)));
	return { cols, rows: Math.max(1, Math.round(cols * aspect * yRatio)) };
}

export type LoadedMedia = {
	mime: "image/png" | "image/jpeg";
	bytes: Uint8Array;
	pw: number;
	ph: number;
};

type Staged = {
	mid: string;
	id: string;
	key: string;
	item: MessageItem;
	media: NonNullable<MessageItem["media"]>;
};

export type MediaPatch = NonNullable<MessageItem["media"]>;

export class MediaLoader {
	private backend: Backend;
	private cache = new Map<string, LoadedMedia>();
	private failed = new Set<string>();
	private inflight = new Set<string>();
	private queue: Staged[] = [];
	private active = 0;
	private onChange:
		| ((mid: string, id: string, patch: MediaInfo) => void)
		| null = null;

	constructor(backend: Backend) {
		this.backend = backend;
	}

	get(key: string): LoadedMedia | undefined {
		return this.cache.get(key);
	}

	pump(
		items: MessageItem[],
		onChange: (mid: string, id: string, patch: MediaInfo) => void,
	): void {
		this.onChange = onChange;
		for (const item of items) {
			const media = item.media;
			if (!media || media.pw !== undefined || media.error) continue;
			const key = media.kind === "sticker" ? media.url : item.id;
			if (
				this.cache.has(key) || this.failed.has(key) || this.inflight.has(key)
			) {
				const cached = this.cache.get(key);
				if (cached) {
					const patch: MediaPatch = {
						...media,
						pw: cached.pw,
						ph: cached.ph,
					};
					this.onChange?.(
						(item as MessageItem & { mid?: string }).mid ?? "",
						item.id,
						patch,
					);
				}
				continue;
			}
			this.inflight.add(key);
			this.queue.push({
				mid: (item as MessageItem & { mid?: string }).mid ?? "",
				id: item.id,
				key,
				item,
				media,
			});
		}
		this.drain();
	}

	private drain(): void {
		while (this.active < 3 && this.queue.length) {
			const job = this.queue.shift();
			this.active++;
			if (job) this.run(job);
		}
	}

	private async run(job: Staged): Promise<void> {
		const { key, item, media } = job;
		try {
			const bytes = await this.backend.getMedia(item);
			const mime = bytes ? sniffMime(bytes) : null;
			const size = bytes && mime ? imageSize(bytes) : null;
			if (!bytes || !mime || !size) throw new Error("unsupported media");
			this.cache.set(key, { mime, bytes, pw: size.pw, ph: size.ph });
			const patch: MediaPatch = { ...media, pw: size.pw, ph: size.ph };
			this.onChange?.(job.mid, job.id, patch);
		} catch {
			this.failed.add(key);
			const patch: MediaPatch = { ...media, error: true };
			this.onChange?.(job.mid, job.id, patch);
		} finally {
			this.inflight.delete(key);
			this.active--;
			this.drain();
		}
	}
}
