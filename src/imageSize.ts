export type ImageFormat = "image/png" | "image/jpeg";

const PNG_MAGIC = [
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
] as const;

export function sniffMime(bytes: Uint8Array): ImageFormat | null {
	if (bytes.length < 8) return null;
	const b = bytes;
	if (
		b[0] === PNG_MAGIC[0] && b[1] === PNG_MAGIC[1] &&
		b[2] === PNG_MAGIC[2] && b[3] === PNG_MAGIC[3] &&
		b[4] === PNG_MAGIC[4] && b[5] === PNG_MAGIC[5] &&
		b[6] === PNG_MAGIC[6] && b[7] === PNG_MAGIC[7]
	) {
		return "image/png";
	}
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
		return "image/jpeg";
	}
	return null;
}

export function imageSize(
	bytes: Uint8Array,
): { pw: number; ph: number } | null {
	const mime = sniffMime(bytes);
	if (mime === "image/png") {
		return pngSize(bytes);
	}
	if (mime === "image/jpeg") {
		return jpegSize(bytes);
	}
	return null;
}

function pngSize(bytes: Uint8Array): { pw: number; ph: number } | null {
	if (bytes.length < 24) return null;
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = dv.getUint32(16), height = dv.getUint32(20);
	if (width === 0) return null;
	return { pw: width, ph: height };
}

function jpegSize(bytes: Uint8Array): { pw: number; ph: number } | null {
	let i = 2;
	while (i + 4 <= bytes.length) {
		if (bytes[i] !== 0xff) return null;
		const marker = bytes[i + 1];
		if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
			if (i + 9 > bytes.length) return null;
			const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const height = dv.getUint16(i + 5);
			const width = dv.getUint16(i + 7);
			if (height === 0 || width === 0) return null;
			return { pw: width, ph: height };
		}
		if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
			i += 2;
			continue;
		}
		if (i + 4 > bytes.length) return null;
		const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		i += 2 + dv.getUint16(i + 2);
	}
	return null;
}
