export type ChatKind = "user" | "group" | "room";

export type ChatItem = {
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

export type MessageStatus = "sending" | "sent" | "failed";

export type MessageItem = {
	id: string;
	time: number;
	who: string;
	body: string;
	mine: boolean;
	read?: boolean;
	status?: MessageStatus;
	label?: string;
};

export type NoticeKind = "info" | "success" | "warn" | "error";

export type BackendEvent =
	| { type: "message"; chat: ChatItem; message: MessageItem }
	| { type: "notice"; kind: NoticeKind; text: string }
	| { type: "state"; connected: boolean; text?: string };

export type HistoryResult = {
	messages: MessageItem[];
	hasMore: boolean;
};

export interface Backend {
	readonly me: { name: string; mid: string; status?: string } | null;
	listChats(): Promise<ChatItem[]>;
	history(mid: string, options?: { before?: string; limit?: number }): Promise<
		HistoryResult
	>;
	send(mid: string, text: string): Promise<string>;
	markRead(mid: string, messageId: string): Promise<void>;
	chatInfo(mid: string): Promise<{ title: string; rows: [string, string][] }>;
	subscribe(handler: (event: BackendEvent) => void): () => void;
	close(): Promise<void>;
}

const CONTENT_LABELS: Record<string, string> = {
	IMAGE: "画像",
	VIDEO: "動画",
	AUDIO: "音声",
	FILE: "ファイル",
	STICKER: "スタンプ",
	LOCATION: "位置情報",
	CONTACT: "連絡先",
	CALL: "通話",
	LINK: "リンク",
	FLEX: "リッチメッセージ",
	NONE: "内容なし",
};

export function formatBody(text: string | undefined, contentType: string) {
	if (text) return text;
	const type = (contentType || "").toUpperCase();
	return `[${CONTENT_LABELS[type] ?? (contentType || "不明").toLowerCase()}]`;
}

export const contentLabel = (contentType: string): string =>
	CONTENT_LABELS[(contentType || "").toUpperCase()] ?? contentType;
