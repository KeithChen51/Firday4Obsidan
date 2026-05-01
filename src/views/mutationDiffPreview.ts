export type MutationDiffPreviewKind = "remove" | "add";

export interface MutationDiffPreviewLine {
	kind: MutationDiffPreviewKind;
	text: string;
}

export interface BuildMutationDiffPreviewInput {
	before: string;
	after: string;
	maxLines?: number;
	maxLineChars?: number;
}

export interface MutationDiffPreview {
	lines: MutationDiffPreviewLine[];
	truncated: boolean;
	omittedLineCount: number;
}

export function buildMutationDiffPreview(input: BuildMutationDiffPreviewInput): MutationDiffPreview {
	const maxLines = Math.max(1, input.maxLines ?? 12);
	const maxLineChars = Math.max(1, input.maxLineChars ?? 160);
	const beforeLines = splitLines(input.before);
	const afterLines = splitLines(input.after);
	const changedLines: MutationDiffPreviewLine[] = [];
	const lineCount = Math.max(beforeLines.length, afterLines.length);

	for (let index = 0; index < lineCount; index += 1) {
		const before = beforeLines[index];
		const after = afterLines[index];
		if (before === after) {
			continue;
		}
		if (before !== undefined) {
			changedLines.push({ kind: "remove", text: truncateLine(before, maxLineChars) });
		}
		if (after !== undefined) {
			changedLines.push({ kind: "add", text: truncateLine(after, maxLineChars) });
		}
	}

	if (changedLines.length === 0) {
		return {
			lines: [],
			truncated: false,
			omittedLineCount: 0,
		};
	}

	const lines = changedLines.slice(0, maxLines);
	return {
		lines,
		truncated: changedLines.length > lines.length,
		omittedLineCount: Math.max(0, changedLines.length - lines.length),
	};
}

function splitLines(text: string): string[] {
	if (!text) {
		return [];
	}
	return text.replace(/\r\n?/g, "\n").split("\n");
}

function truncateLine(text: string, maxLineChars: number): string {
	if (text.length <= maxLineChars) {
		return text;
	}
	return `${text.slice(0, maxLineChars)}...`;
}
