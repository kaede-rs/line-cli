export type EccLevel = "L" | "M" | "Q" | "H";

const ECC_CODEWORDS_PER_BLOCK: Record<EccLevel, number[]> = {
	L: [-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
	M: [-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],
	Q: [-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
	H: [-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
};

const NUM_ERROR_CORRECTION_BLOCKS: Record<EccLevel, number[]> = {
	L: [-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],
	M: [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],
	Q: [-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],
	H: [-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81],
};

function numRawDataModules(version: number): number {
	let result = (16 * version + 128) * version + 64;
	if (version >= 2) {
		const numAlign = Math.floor(version / 7) + 2;
		result -= (25 * numAlign - 10) * numAlign - 55;
		if (version >= 7) result -= 36;
	}
	return result;
}

function numDataCodewords(version: number, level: EccLevel): number {
	return Math.floor(numRawDataModules(version) / 8) -
		ECC_CODEWORDS_PER_BLOCK[level][version] *
			NUM_ERROR_CORRECTION_BLOCKS[level][version];
}

function reedSolomonComputeDivisor(degree: number): number[] {
	const result = new Array<number>(degree).fill(0);
	result[degree - 1] = 1;
	let root = 1;
	for (let i = 0; i < degree; i++) {
		for (let j = 0; j < degree; j++) {
			result[j] = reedSolomonMultiply(result[j], root);
			if (j + 1 < degree) result[j] ^= result[j + 1];
		}
		root = reedSolomonMultiply(root, 0x02);
	}
	return result;
}

function reedSolomonComputeRemainder(
	data: number[],
	divisor: number[],
): number[] {
	const result = new Array<number>(divisor.length).fill(0);
	for (const byte of data) {
		const factor = byte ^ result.shift()!;
		result.push(0);
		divisor.forEach((coef, i) => {
			result[i] ^= reedSolomonMultiply(coef, factor);
		});
	}
	return result;
}

function reedSolomonMultiply(x: number, y: number): number {
	let z = 0;
	for (let i = 7; i >= 0; i--) {
		z = (z << 1) ^ ((z >>> 7) * 0x11d);
		z ^= ((y >>> i) & 1) * x;
	}
	return z & 0xff;
}

class BitBuffer {
	bits: number[] = [];

	append(value: number, length: number): void {
		for (let i = length - 1; i >= 0; i--) {
			this.bits.push((value >>> i) & 1);
		}
	}

	appendBytes(bytes: Uint8Array): void {
		for (const byte of bytes) this.append(byte, 8);
	}
}

function charCountBits(version: number): number {
	return version <= 9 ? 8 : 16;
}

function selectVersion(byteLength: number, level: EccLevel): number {
	for (let version = 1; version <= 40; version++) {
		const capacity = numDataCodewords(version, level) * 8;
		const needed = 4 + charCountBits(version) + byteLength * 8;
		if (needed <= capacity) return version;
	}
	throw new Error("データが長すぎて QR にできません");
}

function buildCodewords(
	data: Uint8Array,
	version: number,
	level: EccLevel,
): number[] {
	const capacity = numDataCodewords(version, level) * 8;
	const bits = new BitBuffer();
	bits.append(0b0100, 4);
	bits.append(data.length, charCountBits(version));
	bits.appendBytes(data);
	if (bits.bits.length > capacity) throw new Error("データが長すぎます");

	bits.append(0, Math.min(4, capacity - bits.bits.length));
	bits.append(0, (8 - bits.bits.length % 8) % 8);
	for (let pad = 0xec; bits.bits.length < capacity; pad ^= 0xec ^ 0x11) {
		bits.append(pad, 8);
	}

	const codewords: number[] = [];
	for (let i = 0; i < bits.bits.length; i += 8) {
		let byte = 0;
		for (let j = 0; j < 8; j++) byte = (byte << 1) | bits.bits[i + j];
		codewords.push(byte);
	}
	return codewords;
}

function addEccAndInterleave(
	codewords: number[],
	version: number,
	level: EccLevel,
): number[] {
	const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[level][version];
	const blockEccLength = ECC_CODEWORDS_PER_BLOCK[level][version];
	const numShortBlocks = numBlocks - numRawDataModules(version) / 8 % numBlocks;
	const shortBlockLength = Math.floor(
		numRawDataModules(version) / 8 / numBlocks,
	);

	const blocks: number[][] = [];
	const divisor = reedSolomonComputeDivisor(blockEccLength);
	for (let i = 0, k = 0; i < numBlocks; i++) {
		const dataLength = shortBlockLength - blockEccLength +
			(i < numShortBlocks ? 0 : 1);
		const data = codewords.slice(k, k + dataLength);
		k += dataLength;
		const ecc = reedSolomonComputeRemainder(data, divisor);
		if (i < numShortBlocks) data.push(0);
		blocks.push(data.concat(ecc));
	}

	const result: number[] = [];
	for (let i = 0; i < blocks[0].length; i++) {
		blocks.forEach((block, j) => {
			if (i === shortBlockLength - blockEccLength && j < numShortBlocks) return;
			result.push(block[i]);
		});
	}
	return result;
}

type Matrix = boolean[][];

class QrBuilder {
	readonly size: number;
	modules: Matrix;
	isFunction: Matrix;

	constructor(readonly version: number) {
		this.size = version * 4 + 17;
		this.modules = Array.from(
			{ length: this.size },
			() => new Array(this.size).fill(false),
		);
		this.isFunction = Array.from(
			{ length: this.size },
			() => new Array(this.size).fill(false),
		);
	}

	setFunction(x: number, y: number, dark: boolean): void {
		this.modules[y][x] = dark;
		this.isFunction[y][x] = true;
	}

	drawFunctionPatterns(): void {
		for (let i = 0; i < this.size; i++) {
			this.setFunction(6, i, i % 2 === 0);
			this.setFunction(i, 6, i % 2 === 0);
		}
		this.drawFinder(3, 3);
		this.drawFinder(this.size - 4, 3);
		this.drawFinder(3, this.size - 4);
		const positions = this.alignmentPositions();
		for (let i = 0; i < positions.length; i++) {
			for (let j = 0; j < positions.length; j++) {
				const skip = (i === 0 && j === 0) ||
					(i === 0 && j === positions.length - 1) ||
					(i === positions.length - 1 && j === 0);
				if (skip) continue;
				this.drawAlignment(positions[i], positions[j]);
			}
		}
		this.drawFormatBits(0);
		this.drawVersion();
	}

	private drawFinder(centerX: number, centerY: number): void {
		for (let dy = -4; dy <= 4; dy++) {
			for (let dx = -4; dx <= 4; dx++) {
				const distance = Math.max(Math.abs(dx), Math.abs(dy));
				const x = centerX + dx;
				const y = centerY + dy;
				if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
					this.setFunction(x, y, distance !== 2 && distance !== 4);
				}
			}
		}
	}

	private drawAlignment(centerX: number, centerY: number): void {
		for (let dy = -2; dy <= 2; dy++) {
			for (let dx = -2; dx <= 2; dx++) {
				this.setFunction(
					centerX + dx,
					centerY + dy,
					Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
				);
			}
		}
	}

	private alignmentPositions(): number[] {
		if (this.version === 1) return [];
		const count = Math.floor(this.version / 7) + 2;
		const step = this.version === 32
			? 26
			: Math.ceil((this.version * 4 + 4) / (count * 2 - 2)) * 2;
		const positions = [6];
		for (let pos = this.size - 7; positions.length < count; pos -= step) {
			positions.splice(1, 0, pos);
		}
		return positions;
	}

	drawFormatBits(mask: number): void {
		const levelBits = { L: 1, M: 0, Q: 3, H: 2 }[this.level];
		const data = (levelBits << 3) | mask;
		let rem = data;
		for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
		const bits = ((data << 10) | rem) ^ 0x5412;

		for (let i = 0; i <= 5; i++) this.setFunction(8, i, getBit(bits, i));
		this.setFunction(8, 7, getBit(bits, 6));
		this.setFunction(8, 8, getBit(bits, 7));
		this.setFunction(7, 8, getBit(bits, 8));
		for (let i = 9; i < 15; i++) {
			this.setFunction(14 - i, 8, getBit(bits, i));
		}
		for (let i = 0; i < 8; i++) {
			this.setFunction(this.size - 1 - i, 8, getBit(bits, i));
		}
		for (let i = 8; i < 15; i++) {
			this.setFunction(8, this.size - 15 + i, getBit(bits, i));
		}
		this.setFunction(8, this.size - 8, true);
	}

	private drawVersion(): void {
		if (this.version < 7) return;
		let rem = this.version;
		for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
		const bits = (this.version << 12) | rem;
		for (let i = 0; i < 18; i++) {
			const bit = getBit(bits, i);
			const a = this.size - 11 + i % 3;
			const b = Math.floor(i / 3);
			this.setFunction(a, b, bit);
			this.setFunction(b, a, bit);
		}
	}

	drawCodewords(data: number[]): void {
		let i = 0;
		for (let right = this.size - 1; right >= 1; right -= 2) {
			if (right === 6) right = 5;
			for (let vertical = 0; vertical < this.size; vertical++) {
				for (let j = 0; j < 2; j++) {
					const x = right - j;
					const upward = ((right + 1) & 2) === 0;
					const y = upward ? this.size - 1 - vertical : vertical;
					if (!this.isFunction[y][x] && i < data.length * 8) {
						this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
						i++;
					}
				}
			}
		}
	}

	applyMask(mask: number): void {
		for (let y = 0; y < this.size; y++) {
			for (let x = 0; x < this.size; x++) {
				if (this.isFunction[y][x]) continue;
				const invert = maskFunction(mask, x, y);
				this.modules[y][x] = this.modules[y][x] !== invert;
			}
		}
	}

	penalty(): number {
		const size = this.size;
		const at = (x: number, y: number) => this.modules[y][x];
		let penalty = 0;

		for (let y = 0; y < size; y++) {
			let runColor = false;
			let runLength = 0;
			for (let x = 0; x < size; x++) {
				const color = at(x, y);
				if (color === runColor) runLength++;
				else {
					if (runLength >= 5) penalty += runLength - 2;
					runColor = color;
					runLength = 1;
				}
			}
			if (runLength >= 5) penalty += runLength - 2;
		}
		for (let x = 0; x < size; x++) {
			let runColor = false;
			let runLength = 0;
			for (let y = 0; y < size; y++) {
				const color = at(x, y);
				if (color === runColor) runLength++;
				else {
					if (runLength >= 5) penalty += runLength - 2;
					runColor = color;
					runLength = 1;
				}
			}
			if (runLength >= 5) penalty += runLength - 2;
		}
		for (let y = 0; y < size - 1; y++) {
			for (let x = 0; x < size - 1; x++) {
				const color = at(x, y);
				if (
					color === at(x + 1, y) && color === at(x, y + 1) &&
					color === at(x + 1, y + 1)
				) {
					penalty += 3;
				}
			}
		}
		
    const patternA = [true,false,true,true,true,false,true,false,false,false,false];
    const patternB = [false,false,false,false,true,false,true,true,true,false,true];

    const matches = (cells: boolean[]) =>
			cells.every((cell, i) => cell === patternA[i]) ||
			cells.every((cell, i) => cell === patternB[i]);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x <= size - 11; x++) {
				const cells: boolean[] = [];
				for (let i = 0; i < 11; i++) cells.push(at(x + i, y));
				if (matches(cells)) penalty += 40;
			}
		}
		for (let x = 0; x < size; x++) {
			for (let y = 0; y <= size - 11; y++) {
				const cells: boolean[] = [];
				for (let i = 0; i < 11; i++) cells.push(at(x, y + i));
				if (matches(cells)) penalty += 40;
			}
		}
		let dark = 0;
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) if (at(x, y)) dark++;
		}
		const total = size * size;
		const ratio = dark * 100 / total;
		const deviation = Math.min(
			Math.abs(Math.ceil(ratio / 5) * 5 - 50) / 5,
			Math.abs(Math.floor(ratio / 5) * 5 - 50) / 5,
		);
		penalty += deviation * 10;
		return penalty;
	}

	level: EccLevel = "M";
}

function maskFunction(mask: number, x: number, y: number): boolean {
	switch (mask) {
		case 0:
			return (x + y) % 2 === 0;
		case 1:
			return y % 2 === 0;
		case 2:
			return x % 3 === 0;
		case 3:
			return (x + y) % 3 === 0;
		case 4:
			return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
		case 5:
			return (x * y) % 2 + (x * y) % 3 === 0;
		case 6:
			return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
		case 7:
			return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
		default:
			return false;
	}
}

function getBit(value: number, index: number): boolean {
	return ((value >>> index) & 1) !== 0;
}

export function encodeQr(
	text: string,
	level: EccLevel = "M",
	options: { mask?: number } = {},
): Matrix {
	const data = new TextEncoder().encode(text);
	const version = selectVersion(data.length, level);
	const codewords = buildCodewords(data, version, level);
	const all = addEccAndInterleave(codewords, version, level);

	const builder = new QrBuilder(version);
	builder.level = level;
	builder.drawFunctionPatterns();
	builder.drawCodewords(all);

	let bestMask = options.mask ?? -1;
	if (bestMask < 0) {
		let bestPenalty = Infinity;
		for (let mask = 0; mask < 8; mask++) {
			builder.applyMask(mask);
			builder.drawFormatBits(mask);
			const penalty = builder.penalty();
			builder.applyMask(mask);
			if (penalty < bestPenalty) {
				bestPenalty = penalty;
				bestMask = mask;
			}
		}
	}
	builder.applyMask(bestMask);
	builder.drawFormatBits(bestMask);
	return builder.modules;
}

export function qrVersion(text: string, level: EccLevel = "M"): number {
	return selectVersion(new TextEncoder().encode(text).length, level);
}

export function renderQrAnsi(
	matrix: Matrix,
	options: { quietZone?: number; color?: boolean } = {},
): string {
	const zone = options.quietZone ?? 4;
	const color = options.color ?? true;
	const size = matrix.length;
	const total = size + zone * 2;
	const dark = (x: number, y: number): boolean => {
		const mx = x - zone;
		const my = y - zone;
		if (mx < 0 || my < 0 || mx >= size || my >= size) return false;
		return matrix[my][mx];
	};

	const lines: string[] = [];
	const open = color ? "\x1b[30;47m" : "";
	const close = color ? "\x1b[0m" : "";
	for (let y = 0; y < total; y += 2) {
		let line = "";
		for (let x = 0; x < total; x++) {
			const top = dark(x, y);
			const bottom = y + 1 < total ? dark(x, y + 1) : false;
			if (color) {
				line += top ? (bottom ? "█" : "▀") : bottom ? "▄" : " ";
			} else {
				line += top ? "██" : "  ";
			}
		}
		if (!color) {
			lines.push(line);
			let second = "";
			for (let x = 0; x < total; x++) {
				second += dark(x, y + 1) ? "██" : "  ";
			}
			lines.push(second);
			continue;
		}
		lines.push(line);
	}
	return lines.map((line) => `${open}${line}${close}`).join("\n");
}

export const _internal = {reedSolomonComputeDivisor,reedSolomonComputeRemainder,reedSolomonMultiply,numDataCodewords,numRawDataModules,buildCodewords,addEccAndInterleave,selectVersion};
