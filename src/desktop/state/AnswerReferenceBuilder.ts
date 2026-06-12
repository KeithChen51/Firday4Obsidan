export const ANSWER_REFERENCE_SOURCE_TYPES = [
	"@引用",
	"FRIDAY 读取",
	"当前产物",
	"选区",
] as const;

export type AnswerReferenceSourceType = (typeof ANSWER_REFERENCE_SOURCE_TYPES)[number];

export interface AnswerReferenceCandidate {
	targetType: string;
	targetUri: string;
	sourceType: string;
	fileName?: string;
	fileType?: string;
	metadata?: Record<string, unknown>;
	eligibleForAnswerReference?: boolean;
}

export interface AnswerReferenceDisplayFields {
	fileType: string;
	fileName: string;
	sourceType: AnswerReferenceSourceType;
}

export interface AnswerReference {
	targetType: string;
	targetUri: string;
	display: AnswerReferenceDisplayFields;
	metadata?: Record<string, unknown>;
}

export interface BuildAnswerReferencesOptions {
	allowedSourceTypes?: AnswerReferenceSourceType[];
	maxItems?: number;
}

const ALLOWED_SOURCE_TYPE_SET = new Set<string>(ANSWER_REFERENCE_SOURCE_TYPES);

export function buildAnswerReferences(
	candidates: AnswerReferenceCandidate[],
	options: BuildAnswerReferencesOptions = {},
): AnswerReference[] {
	const allowedSourceTypes = new Set(options.allowedSourceTypes ?? ANSWER_REFERENCE_SOURCE_TYPES);
	const seenTargets = new Set<string>();
	const references: AnswerReference[] = [];

	for (const candidate of candidates) {
		if (candidate.eligibleForAnswerReference === false) {
			continue;
		}
		if (!ALLOWED_SOURCE_TYPE_SET.has(candidate.sourceType) || !allowedSourceTypes.has(candidate.sourceType as AnswerReferenceSourceType)) {
			continue;
		}
		const targetType = normalizeString(candidate.targetType);
		const targetUri = normalizeString(candidate.targetUri);
		if (!targetType || !targetUri) {
			continue;
		}
		const targetKey = `${targetType}\u0000${targetUri}`;
		if (seenTargets.has(targetKey)) {
			continue;
		}
		seenTargets.add(targetKey);

		const reference: AnswerReference = {
			targetType,
			targetUri,
			display: {
				fileType: normalizeString(candidate.fileType) || inferFileType(candidate.fileName || targetUri),
				fileName: displayFileName(candidate.fileName || targetUri),
				sourceType: candidate.sourceType as AnswerReferenceSourceType,
			},
		};
		if (candidate.metadata && Object.keys(candidate.metadata).length > 0) {
			reference.metadata = deepClone(candidate.metadata);
		}
		references.push(reference);
		if (typeof options.maxItems === "number" && references.length >= Math.max(0, options.maxItems)) {
			break;
		}
	}

	return references;
}

function displayFileName(value: string): string {
	const withoutQuery = normalizeString(value).split(/[?#]/u)[0] ?? "";
	const normalized = withoutQuery.replace(/\\/g, "/");
	const segments = normalized.split("/").filter(Boolean);
	const fileName = segments[segments.length - 1] ?? normalized;
	return fileName || "unknown";
}

function inferFileType(value: string): string {
	const fileName = displayFileName(value);
	const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : "";
	const types: Record<string, string> = {
		css: "CSS",
		csv: "CSV",
		gif: "Image",
		htm: "HTML",
		html: "HTML",
		jpeg: "Image",
		jpg: "Image",
		json: "JSON",
		md: "Markdown",
		pdf: "PDF",
		png: "Image",
		svg: "Image",
		txt: "Text",
		webp: "Image",
		yaml: "YAML",
		yml: "YAML",
	};
	return extension ? types[extension] ?? extension.toUpperCase() : "File";
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
