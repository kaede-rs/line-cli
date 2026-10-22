import { Canvas } from "./canvas.ts";
import type { CursorState } from "./screen.ts";
import {
	cellWidth,
	chars,
	clock,
	formatDateLabel,
	formatRelative,
	graphemeWidth,
	hashCode,
	initialOf,
	singleLine,
	spinnerFrame,
	truncate,
	wrapText,
} from "./text.ts";
import { DEFAULT, type Style, type Theme } from "./theme.ts";
import type { ChatKind, MessageStatus, NoticeKind } from "./backend.ts";

export type Focus = "list" | "filter" | "input";

export type ChatRow = {
	mid: string;
	name: string;
	kind: ChatKind;
	unread: number;
	time: number;
	preview?: string;
	previewWho?: string;
	members?: number;
	muted?: boolean;
};

export type MessageRow = {
	id: string;
	time: number;
	who: string;
	body: string;
	mine: boolean;
	read?: boolean;
	status?: MessageStatus;
	label?: string;
};

export type ToastItem = { id: number; kind: NoticeKind; text: string };

export type Hint = { id: string; key: string; label: string };

export type MenuItem = { id: string; label: string; hint?: string };

export type OverlayView =
	| { kind: "help"; scroll: number }
	| { kind: "info"; title: string; rows: [string, string][]; scroll: number }
	| { kind: "confirm"; title: string; message: string; action: string }
	| {
		kind: "menu";
		items: MenuItem[];
		selected: number;
		at?: { row: number; col: number };
	}
	| null;

export type PaletteItem = { label: string; description: string };

export type AppView = {
	cols: number;
	rows: number;
	themeName: string;
	me: { name: string; mid: string } | null;
	connected: boolean;
	statusText?: string;
	chats: ChatRow[];
	totalCount: number;
	totalUnread: number;
	filter: string;
	focus: Focus;
	selectedIndex: number;
	listScroll: number;
	openChat: ChatRow | null;
	messages: MessageRow[];
	unreadFrom: number;
	msgScroll: number;
	hasMore: boolean;
	input: string;
	inputCursor: number;
	inputScroll: number;
	busy: string | null;
	toasts: ToastItem[];
	overlay: OverlayView;
	hints: Hint[];
	palette: { items: PaletteItem[]; selected: number } | null;
	now: number;
	tick: number;
};

export type Region = {
	row: number;
	col: number;
	width: number;
	height: number;
};

export type HotspotAction =
	| { type: "chat"; index: number }
	| { type: "filter" }
	| { type: "input" }
	| { type: "scroll" }
	| { type: "hint"; id: string }
	| { type: "overlay"; id: string }
	| { type: "back" };

export type Hotspot = {
	row: number;
	col: number;
	rows: number;
	cols: number;
	action: HotspotAction;
};

export type Layout = {
	mobile: boolean;
	body: Region;
	sidebar: Region | null;
	main: Region | null;
	messages: Region | null;
	input: {
		box: Region;
		innerCol: number;
		innerWidth: number;
		lines: string[];
		scroll: number;
	} | null;
	filter: { row: number; innerCol: number; innerWidth: number } | null;
	list: { top: number; itemHeight: number; scroll: number } | null;
	scrollbar: {
		col: number;
		top: number;
		height: number;
		total: number;
		visible: number;
	} | null;
};

export type Frame = {
	lines: string[];
	cursor: CursorState;
	hotspots: Hotspot[];
	layout: Layout;
};

const AVATAR_WIDTH = 3;
const TIME_WIDTH = 5;
const BADGE_WIDTH = 4;
const META_WIDTH = 10;
const SCROLL_GUTTER = 1;

export function sidebarWidthFor(cols: number): number {
	return Math.min(42, Math.max(24, Math.round(cols * 0.3)));
}

function makeStyles(theme: Theme) {
	const p = theme.p;
	const mono = theme.mono;
	return {
		app: { bg: p.appBg } as Style,
		panel: { bg: p.panelBg } as Style,
		bar: { bg: p.barBg } as Style,
		logo: { fg: p.accent, bg: p.barBg, bold: true } as Style,
		barText: { fg: p.text, bg: p.barBg, bold: mono } as Style,
		barDim: { fg: p.textDim, bg: p.barBg } as Style,
		barAccent: { fg: p.accent, bg: p.barBg, bold: true } as Style,
		barWarn: { fg: p.warn, bg: p.barBg } as Style,
		divider: { fg: p.border, bg: p.appBg, dim: true } as Style,
		panelDivider: { fg: p.border, bg: p.panelBg } as Style,
		text: { fg: p.text, bg: p.appBg } as Style,
		textBold: { fg: p.text, bg: p.appBg, bold: true } as Style,
		dim: { fg: p.textDim, bg: p.appBg } as Style,
		faint: { fg: p.textFaint, bg: p.appBg } as Style,
		accent: { fg: p.accent, bg: p.appBg } as Style,
		warn: { fg: p.warn, bg: p.appBg, bold: true } as Style,
		err: { fg: p.err, bg: p.appBg } as Style,
		panelText: { fg: p.text, bg: p.panelBg } as Style,
		panelDim: { fg: p.textDim, bg: p.panelBg } as Style,
		panelFaint: { fg: p.textFaint, bg: p.panelBg } as Style,
		selected: {
			fg: mono ? p.text : p.selectedFg,
			bg: p.selectedBg,
			bold: true,
			reverse: mono,
		} as Style,
		selectedDim: {
			fg: mono ? p.text : p.textDim,
			bg: p.selectedBg,
			reverse: mono,
		} as Style,
		selectedAccent: {
			fg: mono ? p.text : p.accent,
			bg: p.selectedBg,
			bold: true,
			reverse: mono,
		} as Style,
		badge: {
			fg: mono ? p.text : p.badgeFg,
			bg: mono ? DEFAULT : p.badgeBg,
			bold: true,
			reverse: mono,
		} as Style,
		bubbleMine: { fg: p.bubbleMineFg, bg: p.bubbleMineBg } as Style,
		bubbleMineEdge: { fg: p.bubbleMineBg, bg: p.appBg } as Style,
		bubbleOther: { fg: p.bubbleOtherFg, bg: p.bubbleOtherBg } as Style,
		bubbleOtherEdge: { fg: p.bubbleOtherBg, bg: p.appBg } as Style,
		input: { fg: p.text, bg: p.inputBg } as Style,
		inputDim: { fg: p.textFaint, bg: p.inputBg } as Style,
		inputAccent: { fg: p.accent, bg: p.inputBg, bold: true } as Style,
		inputEdge: { fg: p.border, bg: p.appBg } as Style,
		inputEdgeFocus: { fg: p.accent, bg: p.appBg, bold: true } as Style,
		overlay: { bg: p.panelBg } as Style,
		overlayBar: { bg: p.panelAltBg } as Style,
		overlayBorder: { fg: p.borderStrong, bg: p.panelBg } as Style,
		overlayTitle: { fg: p.accent, bg: p.panelAltBg, bold: true } as Style,
		overlayTitleDim: { fg: p.textDim, bg: p.panelAltBg } as Style,
		overlayText: { fg: p.text, bg: p.panelBg } as Style,
		overlayDim: { fg: p.textDim, bg: p.panelBg } as Style,
		overlayKey: { fg: p.accent, bg: p.panelBg, bold: true } as Style,
		overlaySelected: {
			fg: mono ? p.text : p.selectedFg,
			bg: p.selectedBg,
			bold: true,
			reverse: mono,
		} as Style,
		overlaySelectedDim: {
			fg: mono ? p.text : p.textDim,
			bg: p.selectedBg,
			reverse: mono,
		} as Style,
		button: {
			fg: mono ? p.text : p.onAccent,
			bg: mono ? DEFAULT : p.accentSoft,
			bold: true,
			reverse: mono,
		} as Style,
		toast: { bg: p.panelAltBg } as Style,
		toastBorder: { fg: p.border, bg: p.panelAltBg } as Style,
		toastText: { fg: p.text, bg: p.panelAltBg } as Style,
		scrollThumb: { fg: p.borderStrong, bg: p.appBg } as Style,
		scrollTrack: { fg: p.border, bg: p.appBg, dim: true } as Style,
	};
}

type Styles = ReturnType<typeof makeStyles>;

export function renderFrame(view: AppView, theme: Theme): Frame {
	const cols = Math.max(20, Math.floor(view.cols));
	const rows = Math.max(6, Math.floor(view.rows));
	const S = makeStyles(theme);
	const canvas = new Canvas(cols, rows, S.app);
	const hotspots: Hotspot[] = [];

	const mobile = cols < 74;
	const body: Region = { row: 1, col: 0, width: cols, height: rows - 2 };
	const sidebarWidth = sidebarWidthFor(cols);
	const showSidebar = mobile ? !view.openChat : true;
	const showMain = mobile ? Boolean(view.openChat) : true;

	const sidebar: Region | null = showSidebar
		? {
			row: body.row,
			col: 0,
			width: mobile ? cols : sidebarWidth,
			height: body.height,
		}
		: null;
	const main: Region | null = showMain
		? {
			row: body.row,
			col: sidebar ? sidebar.width + 1 : 0,
			width: cols - (sidebar ? sidebar.width + 1 : 0),
			height: body.height,
		}
		: null;

	const layout: Layout = {
		mobile,
		body,
		sidebar,
		main,
		messages: null,
		input: null,
		filter: null,
		list: null,
		scrollbar: null,
	};

	drawTopBar(canvas, view, S, cols, mobile, hotspots);

	if (sidebar && main) {
		canvas.vline(body.row, sidebar.width, body.height, "│", {
			fg: theme.p.border,
			bg: theme.p.appBg,
		});
	}

	if (sidebar) {
		const drawn = drawSidebar(canvas, view, theme, S, sidebar, hotspots);
		layout.filter = drawn.filter;
		layout.list = drawn.list;
	}
	if (main) {
		const drawn = drawMain(canvas, view, theme, S, main, hotspots);
		layout.messages = drawn.messages;
		layout.input = drawn.input;
		layout.scrollbar = drawn.scrollbar;
	}
	if (view.palette && layout.input) {
		drawPalette(canvas, view, theme, S, layout.input.box, hotspots);
	}
	drawStatusBar(canvas, view, theme, S, rows - 1, cols, hotspots);
	const toastArea = layout.messages ?? main ?? sidebar ?? body;
	drawToasts(canvas, view, theme, S, toastArea, !layout.messages && !main);
	if (view.overlay) {
		drawOverlay(canvas, view, theme, S, cols, rows, hotspots);
	}

	return {
		lines: canvas.render(theme),
		cursor: caretFor(view, layout),
		hotspots,
		layout,
	};
}

function drawTopBar(
	canvas: Canvas,
	view: AppView,
	S: Styles,
	cols: number,
	mobile: boolean,
	hotspots: Hotspot[],
) {
	canvas.fillRect(0, 0, cols, 1, S.bar);
	let x = 0;
	if (mobile && view.openChat) {
		canvas.text(0, 0, " ‹ 一覧", S.barAccent, { max: 9 });
		hotspots.push({
			row: 0,
			col: 0,
			rows: 1,
			cols: 9,
			action: { type: "back" },
		});
		x = 9;
	} else {
		canvas.text(0, 0, " LINE", S.logo, { max: 6 });
		x = 6;
	}

	const right: { text: string; style: Style }[] = [];
	if (view.busy) {
		right.push({
			text: `${spinnerFrame(view.tick)} ${singleLine(view.busy)}`,
			style: S.barAccent,
		});
	} else {
		right.push({
			text: view.connected ? "● 受信待ち" : "○ 切断中",
			style: view.connected ? S.barAccent : S.barDim,
		});
	}
	if (view.totalUnread) {
		right.push({ text: `未読 ${view.totalUnread}`, style: S.barWarn });
	} else {
		right.push({ text: `${view.totalCount} チャット`, style: S.barDim });
	}
	right.push({ text: clock(view.now), style: S.barDim });

	const rightWidth = right.reduce(
		(sum, part) => sum + cellWidth(part.text) + 2,
		0,
	);
	const nameMax = Math.max(4, cols - x - rightWidth - 2);
	const name = view.me ? singleLine(view.me.name) : "接続中…";
	canvas.text(0, x, `  ${name}`, view.me ? S.barText : S.barDim, {
		max: nameMax,
	});

	let cursor = Math.max(x + nameMax, cols - rightWidth);
	for (const part of right) {
		if (cursor + cellWidth(part.text) > cols - 1) break;
		canvas.text(0, cursor, part.text, part.style, { max: cols - cursor });
		cursor += cellWidth(part.text) + 2;
	}
}

function drawSidebar(
	canvas: Canvas,
	view: AppView,
	theme: Theme,
	S: Styles,
	area: Region,
	hotspots: Hotspot[],
): { filter: Layout["filter"]; list: Layout["list"] } {
	const { row, col, width, height } = area;
	canvas.fillRect(row, col, width, height, S.panel);

	// 検索フィールド
	const filterRow = row;
	const fieldCol = col + 1;
	const fieldWidth = Math.max(6, width - 2);
	const focused = view.focus === "filter";
	const edge = focused ? theme.p.accent : theme.p.border;
	canvas.fillRect(filterRow, fieldCol, fieldWidth, 1, { bg: theme.p.inputBg });
	canvas.setCell(filterRow, fieldCol, "│", { fg: edge, bg: theme.p.inputBg });
	canvas.setCell(filterRow, fieldCol + fieldWidth - 1, "│", {
		fg: edge,
		bg: theme.p.inputBg,
	});
	const innerCol = fieldCol + 2;
	const innerWidth = Math.max(2, fieldWidth - 4);
	canvas.text(
		filterRow,
		innerCol,
		view.filter ? view.filter : "検索  ( / )",
		view.filter ? S.input : S.inputDim,
		{ max: innerWidth },
	);
	hotspots.push({
		row: filterRow,
		col,
		rows: 1,
		cols: width,
		action: { type: "filter" },
	});

	const headerRow = filterRow + 1;
	canvas.fillRect(headerRow, col, width, 1, S.panel);
	canvas.hline(headerRow, col, width, "─", S.panelDivider);
	const unreadText = view.totalUnread ? ` · 未読 ${view.totalUnread}` : "";
	canvas.text(
		headerRow,
		col + 1,
		` ${
			view.filter ? "検索結果" : "チャット"
		} ${view.chats.length}${unreadText} `,
		S.panelDim,
		{ max: width - 2 },
	);

	const listTop = headerRow + 1;
	const listHeight = Math.max(0, row + height - listTop);
	const itemHeight = listHeight < 12 ? 1 : 2;
	const visibleCount = Math.floor(listHeight / itemHeight);
	const scroll = clamp(
		view.listScroll,
		0,
		Math.max(0, view.chats.length - visibleCount),
	);

	for (let i = 0; i < visibleCount; i++) {
		const index = scroll + i;
		const itemRow = listTop + i * itemHeight;
		if (itemRow + itemHeight > row + height) break;
		drawChatItem(
			canvas,
			view.chats[index],
			index,
			{ row: itemRow, col, width, height: itemHeight },
			view,
			theme,
			S,
		);
		hotspots.push({
			row: itemRow,
			col,
			rows: itemHeight,
			cols: width,
			action: { type: "chat", index },
		});
	}

	const used = Math.max(0, Math.min(visibleCount, view.chats.length - scroll)) *
		itemHeight;
	if (used < listHeight) {
		canvas.fillRect(listTop + used, col, width, listHeight - used, S.panel);
	}
	if (!view.chats.length) {
		canvas.text(
			listTop + 1,
			col + 2,
			view.busy ? "読み込み中…" : "チャットがありません",
			S.panelFaint,
			{ max: width - 4 },
		);
		if (!view.busy) {
			canvas.text(listTop + 2, col + 2, "r で再読み込み", S.panelFaint, {
				max: width - 4,
			});
		}
	}

	return {
		filter: { row: filterRow, innerCol, innerWidth },
		list: { top: listTop, itemHeight, scroll },
	};
}

function drawChatItem(
	canvas: Canvas,
	chat: ChatRow | undefined,
	index: number,
	area: Region,
	view: AppView,
	theme: Theme,
	S: Styles,
) {
	const { row, col, width, height } = area;
	const base = index % 2 === 1 ? S.panel : S.panel;
	canvas.fillRect(row, col, width, height, base);
	if (!chat) return;

	const selected = index === view.selectedIndex;
	const opened = view.openChat?.mid === chat.mid;
	if (selected) {
		canvas.fillRect(row, col, width, height, { bg: theme.p.selectedBg });
	}

	// 左端のアクセントバー（開いている / 選択中）
	const barStyle = selected
		? S.selectedAccent
		: { fg: opened ? theme.p.accent : theme.p.border, bg: theme.p.panelBg };
	canvas.vline(row, col, height, opened || selected ? "▌" : " ", barStyle);

	const tall = height > 1;
	const avatarColor = theme.p.avatar[
		hashCode(chat.mid + chat.name) %
		theme.p.avatar.length
	];
	if (tall) {
		canvas.fillRect(row, col + 1, AVATAR_WIDTH, 2, {
			bg: theme.mono ? DEFAULT : avatarColor,
		});
		canvas.text(row, col + 1, initialOf(chat.name), {
			fg: theme.mono ? theme.p.text : theme.p.onAccent,
			bg: avatarColor,
			bold: true,
		}, { max: AVATAR_WIDTH, align: "center" });
	}

	const textCol = col + 1 + (tall ? AVATAR_WIDTH + 1 : 1);
	const nameMax = Math.max(4, col + width - TIME_WIDTH - 2 - textCol);
	const nameStyle = selected ? S.selected : opened ? S.panelText : S.panelText;
	canvas.text(
		row,
		textCol,
		singleLine(chat.name),
		opened ? { ...nameStyle, bold: true } : nameStyle,
		{ max: nameMax },
	);
	canvas.text(
		row,
		col + width - TIME_WIDTH - 1,
		formatRelative(chat.time, view.now),
		selected ? S.selectedDim : S.panelDim,
		{ max: TIME_WIDTH, align: "right" },
	);

	if (!tall) {
		if (chat.unread) {
			canvas.text(
				row,
				col + width - TIME_WIDTH - 2 - BADGE_WIDTH,
				`●${Math.min(chat.unread, 99)}`,
				S.badge,
				{ max: BADGE_WIDTH, align: "right" },
			);
		}
		return;
	}

	const preview = chat.preview
		? (chat.kind !== "user" && chat.previewWho
			? `${chat.previewWho}: ${chat.preview}`
			: chat.preview)
		: "";
	const badgeText = chat.unread
		? chat.unread > 99 ? "99+" : String(chat.unread)
		: "";
	const badgeWidth = badgeText
		? Math.min(BADGE_WIDTH, cellWidth(badgeText) + 2)
		: 0;
	const membersText = !badgeText && chat.members ? `${chat.members}人` : "";
	const membersWidth = membersText ? cellWidth(membersText) + 1 : 0;
	const previewMax = Math.max(
		4,
		col + width - 1 - badgeWidth - membersWidth - textCol,
	);
	canvas.text(
		row + 1,
		textCol,
		singleLine(preview),
		selected ? S.selectedDim : S.panelDim,
		{ max: previewMax },
	);
	if (badgeText) {
		canvas.text(
			row + 1,
			col + width - badgeWidth - 1,
			badgeText,
			S.badge,
			{ max: badgeWidth, align: "center" },
		);
	} else if (membersText) {
		canvas.text(
			row + 1,
			col + width - membersWidth,
			membersText,
			selected ? S.selectedDim : S.panelFaint,
			{ max: membersWidth, align: "right" },
		);
	}
}

function drawMain(
	canvas: Canvas,
	view: AppView,
	theme: Theme,
	S: Styles,
	area: Region,
	hotspots: Hotspot[],
): {
	messages: Region | null;
	input: Layout["input"];
	scrollbar: Layout["scrollbar"];
} {
	const chat = view.openChat;
	if (!chat) {
		drawEmptyState(canvas, theme, S, area);
		return { messages: null, input: null, scrollbar: null };
	}

	const headerHeight = area.height > 12 ? 2 : 1;
	drawChatHeader(canvas, chat, theme, S, hotspots, {
		row: area.row,
		col: area.col,
		width: area.width,
		height: headerHeight,
	});

	const inputWidth = Math.max(8, area.width - 8);
	const wrapped = wrapInput(view.input, inputWidth);
	const available = area.height - headerHeight;
	const maxInner = clamp(Math.floor(available * 0.4), 1, 6);
	const innerRows = clamp(wrapped.lines.length, 1, maxInner);
	const inputHeight = innerRows + 2;
	const messageHeight = Math.max(1, available - inputHeight);

	const messages: Region = {
		row: area.row + headerHeight,
		col: area.col,
		width: area.width,
		height: messageHeight,
	};
	const input: Region = {
		row: area.row + headerHeight + messageHeight,
		col: area.col + 2,
		width: area.width - 4,
		height: inputHeight,
	};

	const specs = buildMessageRows(
		view.messages,
		view.unreadFrom,
		view.now,
		chat.kind !== "user",
		Math.max(8, area.width - SCROLL_GUTTER),
	);
	const scrollbar = drawMessages(
		canvas,
		view,
		theme,
		S,
		messages,
		specs,
		hotspots,
	);
	drawInputBox(canvas, view, S, input, wrapped.lines, hotspots);

	return {
		messages,
		input: {
			box: input,
			innerCol: input.col + 1,
			innerWidth: inputWidth,
			lines: wrapped.lines,
			scroll: clamp(
				view.inputScroll,
				0,
				Math.max(
					0,
					wrapped.lines.length - (inputHeight - 2),
				),
			),
		},
		scrollbar,
	};
}

function drawChatHeader(
	canvas: Canvas,
	chat: ChatRow,
	theme: Theme,
	S: Styles,
	hotspots: Hotspot[],
	area: Region,
) {
	const { row, col, width, height } = area;
	canvas.fillRect(row, col, width, height, S.app);
	canvas.fillRect(row, col + 1, AVATAR_WIDTH, Math.min(2, height), {
		bg: theme.mono
			? DEFAULT
			: theme.p.avatar[hashCode(chat.mid + chat.name) % theme.p.avatar.length],
	});
	canvas.text(row, col + 1, initialOf(chat.name), {
		fg: theme.mono ? theme.p.text : theme.p.onAccent,
		bg: theme.p.avatar[hashCode(chat.mid + chat.name) % theme.p.avatar.length],
		bold: true,
	}, { max: AVATAR_WIDTH, align: "center" });

	const nameCol = col + AVATAR_WIDTH + 2;
	const info = chat.kind === "user"
		? "1:1 チャット"
		: chat.members
		? `${chat.members} 人のグループ`
		: "グループ";
	const unread = chat.unread ? ` · 未読 ${chat.unread}` : "";
	const rightLabel = height > 1 ? "ⓘ 情報" : "";
	const rightWidth = rightLabel ? cellWidth(rightLabel) + 2 : 0;

	canvas.text(row, nameCol, singleLine(chat.name), S.textBold, {
		max: Math.max(6, col + width - nameCol - rightWidth - 2),
	});
	if (height > 1) {
		canvas.text(row + 1, nameCol, `${info}${unread}`, S.dim, {
			max: Math.max(6, col + width - nameCol - rightWidth - 2),
		});
		canvas.text(row + 1, col + width - rightWidth + 1, rightLabel, S.faint, {
			max: rightWidth,
		});
		hotspots.push({
			row: row + 1,
			col: col + width - rightWidth - 1,
			rows: 1,
			cols: rightWidth + 1,
			action: { type: "hint", id: "info" },
		});
	} else {
		canvas.text(
			row,
			col + width - cellWidth(`${info}${unread}`) - 2,
			`${info}${unread}`,
			S.dim,
			{
				max: 24,
			},
		);
	}
}

type RowSpec =
	| { t: "blank" }
	| { t: "sep"; label: string; warn: boolean }
	| {
		t: "name";
		name: string;
		who: string;
		kind: "sender" | "note";
		x: number;
		initial?: string;
	}
	| {
		t: "bubble";
		edge: "top" | "mid" | "bottom";
		x: number;
		width: number;
		text: string;
		mine: boolean;
		meta?: string;
		metaX?: number;
		failed?: boolean;
	};

function buildMessageRows(
	messages: MessageRow[],
	unreadFrom: number,
	now: number,
	grouped: boolean,
	contentWidth: number,
): RowSpec[] {
	const specs: RowSpec[] = [];
	const leftPad = 2;
	const avatarCol = grouped ? AVATAR_WIDTH + 1 : 0;
	const maxWidth = Math.max(
		12,
		Math.min(52, contentWidth - leftPad - avatarCol - META_WIDTH - 2),
	);
	const innerMax = Math.max(2, maxWidth - 2);

	messages.forEach((message, i) => {
		const prev = messages[i - 1];
		const dayChanged = !prev ||
			new Date(prev.time).toDateString() !==
				new Date(message.time).toDateString();
		if (dayChanged) {
			specs.push({
				t: "sep",
				label: formatDateLabel(message.time, now),
				warn: false,
			});
		}
		if (i === unreadFrom && unreadFrom < messages.length) {
			specs.push({
				t: "sep",
				label: `未読 ${messages.length - unreadFrom} 件`,
				warn: true,
			});
		}
		const gap = prev ? message.time - prev.time > 5 * 60_000 : true;
		const newGroup = !prev || prev.mine !== message.mine ||
			prev.who !== message.who || gap || dayChanged;
		if (i > 0 && newGroup) specs.push({ t: "blank" });
		if (!message.mine && newGroup && grouped) {
			specs.push({
				t: "name",
				name: singleLine(message.who),
				who: message.who,
				kind: "sender",
				x: leftPad + avatarCol,
				initial: initialOf(message.who),
			});
		}

		const lines = wrapText(message.body || " ", innerMax);
		const bubbleWidth = clamp(
			2 + Math.max(...lines.map((line) => cellWidth(line))),
			4,
			maxWidth,
		);
		const x = message.mine
			? Math.max(leftPad, contentWidth - bubbleWidth - 1)
			: leftPad + avatarCol;
		const meta = message.status === "sending"
			? "送信中…"
			: message.status === "failed"
			? "送信失敗"
			: `${message.read ? "既読 " : ""}${clock(message.time)}`;
		const metaX = message.mine
			? clamp(x - cellWidth(meta) - 1, 0, contentWidth)
			: x + bubbleWidth + 1;

		specs.push({
			t: "bubble",
			edge: "top",
			x,
			width: bubbleWidth,
			text: "",
			mine: message.mine,
			failed: message.status === "failed",
		});
		lines.forEach((line, index) => {
			specs.push({
				t: "bubble",
				edge: "mid",
				x,
				width: bubbleWidth,
				text: line,
				mine: message.mine,
				meta: index === lines.length - 1 ? meta : undefined,
				metaX: index === lines.length - 1 ? metaX : undefined,
				failed: message.status === "failed",
			});
		});
		specs.push({
			t: "bubble",
			edge: "bottom",
			x,
			width: bubbleWidth,
			text: "",
			mine: message.mine,
			failed: message.status === "failed",
		});
		if (message.label) {
			specs.push({
				t: "name",
				name: message.label,
				who: "",
				kind: "note",
				x,
			});
		}
	});

	if (!specs.length) specs.push({ t: "blank" });
	return specs;
}

function drawMessages(
	canvas: Canvas,
	view: AppView,
	theme: Theme,
	S: Styles,
	area: Region,
	specs: RowSpec[],
	hotspots: Hotspot[],
): Layout["scrollbar"] {
	canvas.fillRect(area.row, area.col, area.width, area.height, S.app);
	const total = specs.length;
	const contentWidth = Math.max(4, area.width - SCROLL_GUTTER);
	const maxScroll = Math.max(0, total - area.height);
	const scroll = clamp(view.msgScroll, 0, maxScroll);
	const start = Math.max(0, total - area.height - scroll);
	const visible = specs.slice(start, start + area.height);

	visible.forEach((spec, i) => {
		const row = area.row + i;
		switch (spec.t) {
			case "blank":
				return;
			case "sep": {
				const label = ` ${spec.label} `;
				const style = spec.warn ? S.warn : S.dim;
				const lineWidth = Math.max(4, contentWidth - 2);
				const left = Math.max(
					2,
					Math.floor((lineWidth - cellWidth(label)) / 2),
				);
				canvas.hline(row, area.col + 1, left - 1, "─", S.divider);
				canvas.text(row, area.col + left, label, style, {
					max: lineWidth - left + 1,
				});
				const tailStart = left + cellWidth(label);
				canvas.hline(
					row,
					area.col + tailStart,
					Math.max(0, area.col + lineWidth + 1 - (area.col + tailStart)),
					"─",
					S.divider,
				);
				return;
			}
			case "name": {
				if (!spec.name) return;
				const color = spec.kind === "sender"
					? theme.p.sender[hashCode(spec.who) % theme.p.sender.length]
					: theme.p.textFaint;
				if (spec.initial) {
					const avatarColor = theme.p.avatar[
						hashCode(spec.who) % theme.p.avatar.length
					];
					canvas.fillRect(row, area.col + 2, AVATAR_WIDTH, 1, {
						bg: theme.mono ? DEFAULT : avatarColor,
					});
					canvas.text(row, area.col + 2, spec.initial, {
						fg: theme.mono ? theme.p.text : theme.p.onAccent,
						bg: avatarColor,
						bold: true,
					}, { max: AVATAR_WIDTH, align: "center" });
				}
				canvas.text(row, area.col + spec.x, truncate(spec.name, 18), {
					fg: color,
					bg: theme.p.appBg,
					bold: true,
				}, { max: contentWidth - spec.x });
				return;
			}
			case "bubble": {
				const edgeStyle = spec.mine ? S.bubbleMineEdge : S.bubbleOtherEdge;
				const bodyStyle = spec.mine ? S.bubbleMine : S.bubbleOther;
				const inner = spec.width - 2;
				const x = area.col + spec.x;
				if (spec.edge === "top") {
					canvas.setCell(row, x, "╭", edgeStyle);
					canvas.hline(row, x + 1, inner, "─", edgeStyle);
					canvas.setCell(row, x + inner + 1, "╮", edgeStyle);
				} else if (spec.edge === "bottom") {
					canvas.setCell(row, x, "╰", edgeStyle);
					canvas.hline(row, x + 1, inner, "─", edgeStyle);
					canvas.setCell(row, x + inner + 1, "╯", edgeStyle);
				} else {
					canvas.setCell(row, x, "│", edgeStyle);
					canvas.setCell(row, x + inner + 1, "│", edgeStyle);
				}
				if (spec.edge === "mid") {
					canvas.fillRect(row, x + 1, inner, 1, bodyStyle);
					canvas.text(row, x + 1, spec.text, bodyStyle, {
						max: inner,
						ellipsis: false,
					});
				}
				if (spec.meta) {
					canvas.text(
						row,
						area.col + Math.max(0, spec.metaX ?? 0),
						spec.meta,
						spec.failed ? S.err : S.faint,
						{ max: contentWidth - Math.max(0, spec.metaX ?? 0) },
					);
				}
				return;
			}
		}
	});

	const barCol = area.col + area.width - 1;
	if (total > area.height) {
		canvas.vline(area.row, barCol, area.height, "│", S.scrollTrack);
		const thumb = Math.max(
			1,
			Math.floor(
				area.height * area.height / total,
			),
		);
		const offset = maxScroll
			? Math.round((maxScroll - scroll) / maxScroll * (area.height - thumb))
			: 0;
		canvas.vline(area.row + offset, barCol, thumb, "█", S.scrollThumb);
		hotspots.push({
			row: area.row,
			col: barCol,
			rows: area.height,
			cols: 1,
			action: { type: "scroll" },
		});
	}

	if (view.hasMore && scroll >= maxScroll) {
		canvas.text(
			area.row,
			area.col + 2,
			view.busy ? "読み込み中…" : "↑ もっと古いメッセージ",
			S.faint,
			{
				max: contentWidth - 4,
			},
		);
	}

	return {
		col: barCol,
		top: area.row,
		height: area.height,
		total,
		visible: area.height,
	};
}

export function countMessageRows(
	messages: MessageRow[],
	contentWidth: number,
	unreadFrom = messages.length,
	now = Date.now(),
	grouped = false,
): number {
	return buildMessageRows(
		messages,
		unreadFrom,
		now,
		grouped,
		Math.max(8, contentWidth),
	).length;
}

function drawInputBox(
	canvas: Canvas,
	view: AppView,
	S: Styles,
	area: Region,
	lines: string[],
	hotspots: Hotspot[],
) {
	const { row, col, width, height } = area;
	const focused = view.focus === "input";
	const edge = focused ? S.inputEdgeFocus : S.inputEdge;
	const innerCol = col + 1;
	const innerWidth = Math.max(2, width - 2);
	const innerRows = Math.max(1, height - 2);

	canvas.fillRect(row, col, width, height, S.input);
	canvas.hline(row, innerCol, innerWidth, "─", edge);
	canvas.hline(row + height - 1, innerCol, innerWidth, "─", edge);
	canvas.setCell(row, col, "╭", edge);
	canvas.setCell(row, col + width - 1, "╮", edge);
	canvas.setCell(row + height - 1, col, "╰", edge);
	canvas.setCell(row + height - 1, col + width - 1, "╯", edge);
	canvas.vline(row + 1, col, innerRows, "│", edge);
	canvas.vline(row + 1, col + width - 1, innerRows, "│", edge);

	const scroll = clamp(
		view.inputScroll,
		0,
		Math.max(0, lines.length - innerRows),
	);
	for (let i = 0; i < innerRows; i++) {
		const y = row + 1 + i;
		canvas.fillRect(y, innerCol, innerWidth, 1, S.input);
		const line = lines[scroll + i];
		if (line === undefined) continue;
		canvas.text(y, innerCol + 1, line, S.input, {
			max: innerWidth - 2,
			ellipsis: false,
		});
	}

	const buttonLabel = view.input ? " Enter 送信 " : " 送信 ";
	const buttonWidth = cellWidth(buttonLabel) + 2;
	const buttonCol = col + width - buttonWidth - 1;
	const buttonRow = row + height - 1;
	canvas.text(
		buttonRow,
		buttonCol,
		`[${buttonLabel.trim()}]`,
		view.input ? S.inputAccent : S.inputDim,
		{ max: buttonWidth },
	);
	if (!view.input) {
		canvas.text(
			row + 1,
			innerCol + 1,
			"メッセージを入力…  ( / でコマンド)",
			S.inputDim,
			{ max: Math.max(4, innerWidth - buttonWidth - 2) },
		);
	}

	hotspots.push({
		row,
		col,
		rows: height,
		cols: width,
		action: { type: "input" },
	});
	hotspots.push({
		row: buttonRow,
		col: buttonCol - 1,
		rows: 1,
		cols: buttonWidth + 1,
		action: { type: "hint", id: "send" },
	});
}

function drawPalette(
	canvas: Canvas,
	view: AppView,
	theme: Theme,
	S: Styles,
	inputBox: Region,
	hotspots: Hotspot[],
) {
	const palette = view.palette;
	if (!palette || !palette.items.length) return;
	const items = palette.items.slice(0, 7);
	const width = Math.min(
		Math.max(28, canvas.cols - inputBox.col - 2),
		56,
	);
	const height = items.length + 2;
	const row = Math.max(1, inputBox.row - height);
	const col = Math.max(1, inputBox.col);

	canvas.fillRect(row, col, width, height, S.overlay);
	canvas.outline(row, col, width, height, S.overlayBorder);
	canvas.text(row, col + 2, "コマンド", S.overlayTitle, { max: width - 4 });
	items.forEach((item, i) => {
		const y = row + 1 + i;
		const selected = i === palette.selected;
		canvas.fillRect(
			y,
			col + 1,
			width - 2,
			1,
			selected ? { bg: theme.p.selectedBg } : { bg: theme.p.panelBg },
		);
		canvas.text(
			y,
			col + 2,
			item.label,
			selected ? S.overlaySelected : S.overlayKey,
			{
				max: 16,
			},
		);
		canvas.text(
			y,
			col + 19,
			item.description,
			selected ? S.overlaySelectedDim : S.overlayDim,
			{ max: Math.max(4, width - 21) },
		);
		hotspots.push({
			row: y,
			col,
			rows: 1,
			cols: width,
			action: { type: "overlay", id: `palette:${i}` },
		});
	});
}

function drawEmptyState(
	canvas: Canvas,
	theme: Theme,
	S: Styles,
	area: Region,
) {
	canvas.fillRect(area.row, area.col, area.width, area.height, S.app);
	const width = Math.min(48, area.width - 4);
	const height = Math.min(13, area.height - 2);
	if (width < 20 || height < 6) {
		canvas.text(
			area.row + 1,
			area.col + 2,
			"チャットを選択してください",
			S.dim,
			{
				max: area.width - 4,
			},
		);
		return;
	}
	const row = area.row + Math.floor((area.height - height) / 2);
	const col = area.col + Math.floor((area.width - width) / 2);
	canvas.fillRect(row, col, width, height, S.panel);
	canvas.outline(row, col, width, height, {
		fg: theme.p.border,
		bg: theme.p.panelBg,
	});
	canvas.text(row + 2, col, "LINE CLI", {
		fg: theme.p.accent,
		bg: theme.p.panelBg,
		bold: true,
	}, { max: width, align: "center" });
	canvas.text(row + 4, col, "左のチャットを選んでください", S.panelText, {
		max: width,
		align: "center",
	});
	const hints: [string, string][] = [
		["↑ ↓ / j k", "移動"],
		["Enter", "開く"],
		["/", "検索"],
		["?", "ヘルプ"],
		["Ctrl+C", "終了"],
	];
	hints.forEach(([key, label], i) => {
		const y = row + 6 + i;
		if (y >= row + height - 1) return;
		canvas.text(y, col + 6, key, {
			fg: theme.p.accent,
			bg: theme.p.panelBg,
			bold: true,
		}, { max: 12 });
		canvas.text(y, col + 20, label, S.panelDim, { max: width - 22 });
	});
}

function drawStatusBar(
	canvas: Canvas,
	view: AppView,
	theme: Theme,
	S: Styles,
	row: number,
	cols: number,
	hotspots: Hotspot[],
) {
	canvas.fillRect(row, 0, cols, 1, S.bar);
	const right = view.statusText ?? "";
	const rightWidth = right ? cellWidth(right) + 2 : 0;
	if (right) {
		canvas.text(row, cols - rightWidth, right, S.barDim, {
			max: rightWidth,
			align: "right",
		});
	}
	let x = 1;
	for (const hint of view.hints) {
		const keyWidth = cellWidth(hint.key);
		const width = keyWidth + 1 + cellWidth(hint.label);
		if (x + width + 2 > cols - rightWidth - 1) break;
		canvas.text(row, x, hint.key, {
			fg: theme.p.accent,
			bg: theme.p.barBg,
			bold: true,
		}, { max: keyWidth });
		canvas.text(row, x + keyWidth + 1, hint.label, S.barDim, {
			max: cols - x - keyWidth - 1,
		});
		hotspots.push({
			row,
			col: x - 1,
			rows: 1,
			cols: width + 2,
			action: { type: "hint", id: hint.id },
		});
		x += width + 3;
	}
}

function drawToasts(
	canvas: Canvas,
	view: AppView,
	theme: Theme,
	S: Styles,
	area: Region,
	atBottom = false,
) {
	if (!view.toasts.length) return;
	const width = clamp(area.width - 6, 24, 62);
	const col = area.col + Math.floor((area.width - width) / 2);
	const count = Math.min(3, view.toasts.length);
	for (let i = 0; i < count; i++) {
		const toast = view.toasts[view.toasts.length - 1 - i];
		if (!toast) continue;
		const row = atBottom ? area.row + area.height - 2 - i : area.row + 1 + i;
		if (row <= area.row || row >= area.row + area.height - 1) continue;
		const color = toast.kind === "error"
			? theme.p.err
			: toast.kind === "warn"
			? theme.p.warn
			: toast.kind === "success"
			? theme.p.ok
			: theme.p.info;
		const icon = toast.kind === "error"
			? "✕"
			: toast.kind === "warn"
			? "!"
			: toast.kind === "success"
			? "✓"
			: "i";
		canvas.fillRect(row, col, width, 1, S.toast);
		canvas.setCell(row, col, "│", { fg: color, bg: theme.p.panelAltBg });
		canvas.setCell(row, col + width - 1, "│", S.toastBorder);
		canvas.text(row, col + 1, ` ${icon} `, {
			fg: color,
			bg: theme.p.panelAltBg,
			bold: true,
		}, { max: 3 });
		canvas.text(row, col + 4, singleLine(toast.text), S.toastText, {
			max: width - 6,
		});
	}
}

type OverlayLine = { key?: string; value: string; header?: boolean };

function drawOverlay(
	canvas: Canvas,
	view: AppView,
	theme: Theme,
	S: Styles,
	cols: number,
	rows: number,
	hotspots: Hotspot[],
) {
	const overlay = view.overlay;
	if (!overlay) return;
	if (overlay.kind === "menu") {
		drawMenu(canvas, theme, S, overlay, cols, hotspots);
		return;
	}

	const lines: OverlayLine[] = [];
	let title = "";
	let actionLabel = "閉じる";
	let scroll = 0;
	if (overlay.kind === "help") {
		title = "操作一覧";
		scroll = overlay.scroll;
		for (const entry of helpContent()) {
			if (entry.header) lines.push({ value: entry.key, header: true });
			else lines.push({ key: entry.key, value: entry.value });
		}
	} else if (overlay.kind === "info") {
		title = overlay.title;
		scroll = overlay.scroll;
		for (const [key, value] of overlay.rows) lines.push({ key, value });
	} else {
		title = overlay.title;
		actionLabel = overlay.action;
		for (const line of wrapText(overlay.message, 46)) {
			lines.push({ value: line });
		}
	}

	const width = clamp(cols - 6, 30, 66);
	const bodyHeight = Math.max(1, Math.min(lines.length, rows - 8));
	const height = bodyHeight + 4;
	const row = Math.max(1, Math.floor((rows - height) / 2));
	const col = Math.max(1, Math.floor((cols - width) / 2));
	const maxScroll = Math.max(0, lines.length - bodyHeight);
	const offset = clamp(scroll, 0, maxScroll);

	canvas.fillRect(row, col, width, height, S.overlay);
	canvas.outline(row, col, width, height, S.overlayBorder);
	canvas.fillRect(row, col + 1, width - 2, 1, S.overlayBar);
	canvas.text(row, col + 2, title, S.overlayTitle, { max: width - 16 });
	canvas.text(row, col + width - 14, "Esc で閉じる", S.overlayTitleDim, {
		max: 12,
		align: "right",
	});

	for (let i = 0; i < bodyHeight; i++) {
		const line = lines[offset + i];
		if (!line) break;
		const y = row + 2 + i;
		if (line.header) {
			canvas.text(y, col + 2, line.value, {
				fg: theme.p.accent,
				bg: theme.p.panelBg,
				bold: true,
			}, { max: width - 4 });
			continue;
		}
		if (line.key) {
			canvas.text(y, col + 2, line.key, S.overlayKey, { max: 17 });
			canvas.text(y, col + 20, line.value, S.overlayDim, {
				max: width - 22,
			});
		} else {
			canvas.text(y, col + 2, line.value, S.overlayText, { max: width - 4 });
		}
	}

	const bottom = row + height - 1;
	if (maxScroll > 0) {
		canvas.text(bottom, col + 2, "PageUp/PageDown でスクロール", S.overlayDim, {
			max: width - 24,
		});
	}
	const button = ` ${actionLabel} `;
	const buttonWidth = cellWidth(button) + 2;
	const buttonCol = col + width - buttonWidth - 2;
	canvas.text(bottom, buttonCol, `[${button.trim()}]`, S.button, {
		max: buttonWidth,
	});
	hotspots.push({
		row: bottom,
		col: buttonCol - 1,
		rows: 1,
		cols: buttonWidth + 2,
		action: { type: "overlay", id: "close" },
	});
	hotspots.push({
		row,
		col,
		rows: 1,
		cols: width,
		action: { type: "overlay", id: "close" },
	});
}

function drawMenu(
	canvas: Canvas,
	theme: Theme,
	S: Styles,
	overlay: {
		kind: "menu";
		items: MenuItem[];
		selected: number;
		at?: { row: number; col: number };
	},
	cols: number,
	hotspots: Hotspot[],
) {
	const hintWidth = Math.max(
		0,
		...overlay.items.map((item) => cellWidth(item.hint ?? "")),
	);
	const labelWidth = Math.max(
		...overlay.items.map((item) => cellWidth(item.label)),
	);
	const width = clamp(labelWidth + hintWidth + 7, 18, Math.min(40, cols - 4));
	const height = overlay.items.length + 2;
	const row = clamp(
		overlay.at ? overlay.at.row - 1 : Math.floor((canvas.rows - height) / 2),
		1,
		Math.max(1, canvas.rows - height - 1),
	);
	const col = clamp(
		overlay.at ? overlay.at.col - 2 : Math.floor((cols - width) / 2),
		1,
		Math.max(1, cols - width - 1),
	);
	canvas.fillRect(row, col, width, height, S.overlay);
	canvas.outline(row, col, width, height, S.overlayBorder);
	overlay.items.forEach((item, i) => {
		const y = row + 1 + i;
		const selected = i === overlay.selected;
		canvas.fillRect(
			y,
			col + 1,
			width - 2,
			1,
			selected ? { bg: theme.p.selectedBg } : { bg: theme.p.panelBg },
		);
		const labelMax = Math.max(
			4,
			width - 4 - (item.hint ? cellWidth(item.hint) + 1 : 0),
		);
		canvas.text(
			y,
			col + 2,
			`${selected ? "▸" : " "} ${item.label}`,
			selected ? S.overlaySelected : S.overlayText,
			{ max: labelMax },
		);
		if (item.hint) {
			canvas.text(
				y,
				col + width - cellWidth(item.hint) - 2,
				item.hint,
				selected ? S.overlaySelectedDim : S.overlayDim,
				{ max: hintWidth + 1, align: "right" },
			);
		}
		hotspots.push({
			row: y,
			col,
			rows: 1,
			cols: width,
			action: { type: "overlay", id: item.id },
		});
	});
}

function helpContent(): { key: string; value: string; header?: boolean }[] {
	return [
		{ key: "移動", value: "", header: true },
		{ key: "↑ ↓ / j k", value: "チャットを選択" },
		{ key: "Enter / →", value: "チャットを開く" },
		{ key: "Tab", value: "入力欄 ⇄ 一覧" },
		{ key: "Esc", value: "戻る（入力 → 一覧 → 閉じる）" },
		{ key: "検索", value: "", header: true },
		{ key: "/", value: "検索ボックスへ" },
		{ key: "Enter", value: "検索結果の先頭を開く" },
		{ key: "Esc", value: "検索をやめる" },
		{ key: "メッセージ", value: "", header: true },
		{ key: "PageUp/Dn", value: "履歴をスクロール" },
		{ key: "Shift+↑ ↓", value: "1 行ずつスクロール" },
		{ key: "一番上", value: "さらに古いメッセージを読む" },
		{ key: "ホイール", value: "スクロール（一覧も）" },
		{ key: "入力", value: "", header: true },
		{ key: "Enter", value: "送信" },
		{ key: "Ctrl+J", value: "改行（Alt+Enter でも可）" },
		{ key: "↑ ↓", value: "送信履歴（1 行目のとき）" },
		{ key: "Ctrl+W / U", value: "単語削除 / 全部消す" },
		{ key: "/コマンド", value: "コマンド入力（Tab で補完）" },
		{ key: "//本文", value: "「/」で始まる文を送る" },
		{ key: "その他", value: "", header: true },
		{ key: "r", value: "一覧を再読み込み" },
		{ key: "i", value: "チャット情報" },
		{ key: "t", value: "テーマ切替" },
		{ key: "?", value: "このヘルプ" },
		{ key: "右クリック", value: "チャットのメニュー" },
		{ key: "Ctrl+C / D", value: "終了" },
	];
}

export function wrapInput(
	text: string,
	width: number,
): { lines: string[]; starts: number[] } {
	const max = Math.max(1, width);
	const parts = chars(text);
	const lines: string[] = [];
	const starts: number[] = [];
	let line = "";
	let used = 0;
	let start = 0;
	for (let i = 0; i < parts.length; i++) {
		const ch = parts[i];
		if (ch === "\n") {
			lines.push(line);
			starts.push(start);
			line = "";
			used = 0;
			start = i + 1;
			continue;
		}
		const w = graphemeWidth(ch);
		if (used + w > max && line) {
			lines.push(line);
			starts.push(start);
			line = "";
			used = 0;
			start = i;
		}
		line += ch;
		used += w;
	}
	lines.push(line);
	starts.push(start);
	return { lines, starts };
}

function caretFor(view: AppView, layout: Layout): CursorState {
	if (view.focus === "filter" && layout.filter) {
		const { row, innerCol, innerWidth } = layout.filter;
		const text = truncate(singleLine(view.filter), innerWidth);
		return {
			row,
			col: innerCol + cellWidth(text),
			visible: true,
			shape: "bar",
		};
	}
	if (view.focus !== "input" || !layout.input) return null;
	const { box, innerCol, innerWidth, lines, scroll } = layout.input;
	const wrapped = wrapInput(view.input, innerWidth);
	const cursorIndex = clamp(view.inputCursor, 0, chars(view.input).length);
	let lineIndex = 0;
	for (let i = 0; i < wrapped.starts.length; i++) {
		if (wrapped.starts[i] <= cursorIndex) lineIndex = i;
	}
	const visibleLine = lineIndex - scroll;
	if (visibleLine < 0 || visibleLine >= box.height - 2) return null;
	const start = wrapped.starts[lineIndex] ?? 0;
	const prefix = chars(lines[lineIndex] ?? "").slice(
		0,
		Math.max(0, cursorIndex - start),
	)
		.join("");
	return {
		row: box.row + 1 + visibleLine,
		col: innerCol + 1 + cellWidth(prefix),
		visible: true,
		shape: "bar",
	};
}

export function clamp(value: number, min: number, max: number): number {
	if (max < min) return min;
	return Math.min(max, Math.max(min, value));
}

export function hitTest(
	hotspots: Hotspot[],
	x: number,
	y: number,
): Hotspot | null {
	for (let i = hotspots.length - 1; i >= 0; i--) {
		const spot = hotspots[i];
		if (
			y >= spot.row && y < spot.row + spot.rows && x >= spot.col &&
			x < spot.col + spot.cols
		) {
			return spot;
		}
	}
	return null;
}
