import * as Diff from "diff";

export interface EditOperation {
	search: string;
	replace: string;
	description?: string;
}

export interface EditDiffSegment {
	type: "equal" | "add" | "remove";
	value: string;
}

export interface EditApplyResult {
	result: string;
	appliedCount: number;
	failedReasons: string[];
}

export class InlineEditService {
	/**
	 * Apply a list of search-replace edits to file content.
	 * Each edit replaces the first occurrence of `search` text.
	 */
	applyEdits(originalContent: string, operations: EditOperation[]): EditApplyResult {
		let content = originalContent;
		let appliedCount = 0;
		const failedReasons: string[] = [];

		for (const op of operations) {
			if (!op.search) {
				failedReasons.push("空的 search 字段");
				continue;
			}
			const idx = content.indexOf(op.search);
			if (idx === -1) {
				failedReasons.push(`未找到匹配文本: "${this.truncate(op.search, 60)}"`);
				continue;
			}
			content =
				content.slice(0, idx) +
				(op.replace ?? "") +
				content.slice(idx + op.search.length);
			appliedCount += 1;
		}

		return { result: content, appliedCount, failedReasons };
	}

	/**
	 * Compute word-level diff between two strings.
	 * Returns segments with type (add/remove/equal) and value.
	 */
	computeWordDiff(before: string, after: string): EditDiffSegment[] {
		const changes = Diff.diffWordsWithSpace(before, after);
		return changes.map((change) => ({
			type: change.added ? "add" : change.removed ? "remove" : "equal",
			value: change.value,
		}));
	}

	/**
	 * Compute line-level diff between two strings.
	 */
	computeLineDiff(before: string, after: string): EditDiffSegment[] {
		const changes = Diff.diffLines(before, after);
		return changes.map((change) => ({
			type: change.added ? "add" : change.removed ? "remove" : "equal",
			value: change.value,
		}));
	}

	/**
	 * Format diff segments as a compact text suitable for model context.
	 */
	formatDiffForModel(segments: EditDiffSegment[], maxChars = 2000): string {
		const lines: string[] = [];
		let totalLen = 0;

		for (const seg of segments) {
			if (seg.type === "equal") {
				// Show only first/last 2 lines of equal segments for context
				const equalLines = seg.value.split("\n");
				if (equalLines.length > 4) {
					lines.push(` ${equalLines.slice(0, 2).join("\n ")}`);
					lines.push(` ... (${equalLines.length - 4} lines) ...`);
					lines.push(` ${equalLines.slice(-2).join("\n ")}`);
				} else {
					lines.push(` ${seg.value}`);
				}
			} else if (seg.type === "add") {
				for (const line of seg.value.split("\n")) {
					if (line) lines.push(`+${line}`);
				}
			} else {
				for (const line of seg.value.split("\n")) {
					if (line) lines.push(`-${line}`);
				}
			}

			totalLen += seg.value.length;
			if (totalLen > maxChars) {
				lines.push("... (diff truncated)");
				break;
			}
		}

		return lines.join("\n");
	}

	private truncate(text: string, maxLen: number): string {
		return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
	}
}
