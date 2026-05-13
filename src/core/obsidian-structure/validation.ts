import { validateCanvasDocument, type StructureValidationIssue } from "./canvas";
import { validateMarkdownDocument } from "./markdown";

export interface OutputValidationResult {
	path: string;
	ok: boolean;
	items: StructureValidationIssue[];
	summary: string;
}

export interface OutputValidationBatchResult {
	ok: boolean;
	results: OutputValidationResult[];
	summary: string;
}

export interface OutputValidationHost {
	read(path: string): string | null;
	exists(path: string): boolean;
}

export function validateOutputDocument(
	path: string,
	content: string,
	exists: (vaultPath: string) => boolean = () => false,
): OutputValidationResult {
	const normalized = path.trim();
	if (/\.canvas$/i.test(normalized)) {
		const result = validateCanvasDocument(content);
		return { path: normalized, ok: result.ok, items: result.items, summary: result.summary };
	}
	if (/\.md$/i.test(normalized)) {
		const result = validateMarkdownDocument(normalized, content, exists);
		return { path: normalized, ok: result.ok, items: result.items, summary: result.summary };
	}
	return {
		path: normalized,
		ok: true,
		items: [],
		summary: "No structured validator is available for this file type.",
	};
}

export function validateOutputs(paths: string[], host: OutputValidationHost): OutputValidationBatchResult {
	const results = paths.map((targetPath) => {
		const path = targetPath.trim();
		if (!path || !host.exists(path)) {
			return missingFileResult(path);
		}
		const content = host.read(path);
		if (content === null) {
			return missingFileResult(path);
		}
		return validateOutputDocument(path, content, (candidatePath) => host.exists(candidatePath));
	});
	const issueSetCount = results.filter((result) => result.items.length > 0).length;
	return {
		ok: results.every((result) => result.ok),
		results,
		summary: issueSetCount === 0
			? `Validated ${results.length} output(s) with no issues.`
			: `Validated ${results.length} output(s); ${issueSetCount} output(s) need attention.`,
	};
}

function missingFileResult(path: string): OutputValidationResult {
	return {
		path,
		ok: false,
		items: [{
			severity: "error",
			code: "file_missing",
			message: `File does not exist: ${path || "(empty path)"}.`,
			path,
		}],
		summary: "File is missing.",
	};
}
