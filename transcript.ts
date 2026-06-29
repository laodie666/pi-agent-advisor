import type { ReadonlySessionManager } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "@earendil-works/pi-coding-agent";

interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

/** Number of recent turns to include in full detail. Older turns are summarized. */
const RECENT_TURNS_DETAIL = 5;

/**
 * Build a transcript string from session entries.
 * Recent turns (last RECENT_TURNS_DETAIL) include tool calls and results.
 * Older turns only include user/assistant text to save context.
 * Filters out advisor-injected messages.
 */
export function buildTranscriptDelta(
	sessionManager: ReadonlySessionManager,
): string {
	const entries = sessionManager.getBranch();

	// Count total user turns to determine which are "recent"
	let totalTurns = 0;
	for (const entry of entries) {
		if (entry.type === "message" && entry.message?.role === "user") {
			totalTurns++;
		}
	}

	const recentStart = Math.max(1, totalTurns - RECENT_TURNS_DETAIL + 1);
	const parts: string[] = [];
	let currentTurn = 0;

	for (const entry of entries) {
		// Skip entries without a message, or custom-type entries (advisor notes)
		if (!entry.message) continue;
		if (entry.type !== "message") continue;

		const msg = entry.message;
		if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "toolResult") continue;

		if (msg.role === "user") {
			currentTurn++;
			const text = extractTextContent(msg.content);
			if (!text) continue;
			parts.push(`## Turn ${currentTurn}\n\n**User:** ${text}`);
		} else if (msg.role === "assistant") {
			const text = extractTextContent(msg.content);
			const thinking = extractThinking(msg.content);
			const toolCalls = extractToolCalls(msg.content);

			if (thinking) parts.push(`**Assistant thinking:**\n${thinking}`);
			if (text) parts.push(`**Assistant:**\n${text}`);

			// Only show tool calls for recent turns
			if (currentTurn >= recentStart) {
				for (const tc of toolCalls) {
					parts.push(`**Tool:** → ${tc.name}(${formatArgs(tc.args)})`);
				}
			} else if (toolCalls.length > 0) {
				// For old turns, just note that tools were used
				parts.push(`**Tools used:** ${toolCalls.map(t => t.name).join(", ")}`);
			}
		} else if (msg.role === "toolResult") {
			// Only show tool results for recent turns
			if (currentTurn >= recentStart) {
				const resultText = extractToolResultText(msg);
				if (resultText) {
					const truncated = truncateTail(resultText, { maxLines: 20, maxBytes: 2000 });
					parts.push(`**Tool result:**\n${truncated.content}`);
				}
			}
		}
	}

	if (parts.length === 0) return "";

	return parts.join("\n\n");
}

// ── Content extraction helpers ──

function extractTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content as ContentBlock[]) {
		if (block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join("\n").trim();
}

function extractThinking(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	const thinkingBlocks = (content as ContentBlock[]).filter(
		(b) => b.type === "thinking" && typeof b.text === "string" && b.text.trim(),
	);
	return thinkingBlocks.length > 0 ? thinkingBlocks.map((b) => b.text).join("\n").trim() : undefined;
}

interface ToolCallInfo {
	name: string;
	args: Record<string, unknown>;
}

function extractToolCalls(content: unknown): ToolCallInfo[] {
	if (!Array.isArray(content)) return [];
	return (content as ContentBlock[])
		.filter((b) => b.type === "toolCall" && typeof b.name === "string")
		.map((b) => ({
			name: b.name!,
			args: b.arguments ?? {},
		}));
}

function extractToolResultText(msg: { content?: unknown; details?: { error?: string } }): string {
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		const texts = (msg.content as ContentBlock[])
			.filter((b) => b.type === "text" && typeof b.text === "string")
			.map((b) => b.text);
		if (texts.length > 0) return texts.join("\n").trim();
	}
	if (msg.details?.error) return `Error: ${msg.details.error}`;
	return "";
}

function formatArgs(args: Record<string, unknown>): string {
	const entries = Object.entries(args).slice(0, 3);
	const str = entries.map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 80)}`).join(", ");
	if (Object.keys(args).length > 3) return str + ", ...";
	return str;
}
