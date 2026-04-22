import { resolveContextZone, type ContextZoneType } from "../../../features/wiki/TagPolicyRuntime";

export type MentionTokenType = "active_note" | "note" | "folder" | "skill";
export type MentionChannel = "mentioned_notes" | "folder_structures";

export interface MentionToken {
	id: string;
	type: MentionTokenType;
	path?: string;
}

export interface MentionDocumentSnapshot {
	text: string;
	tokens: MentionToken[];
}

export interface MentionResolvedEntry {
	tokenId: string;
	tokenType: MentionTokenType;
	channel: MentionChannel;
	target: string;
	title: string;
	body: string;
	summary: string;
	zone?: ContextZoneType;
	dynamic?: boolean;
}

export interface MentionResolutionError {
	tokenId: string;
	tokenType: MentionTokenType;
	code: "MENTION_RESOLUTION_FAILED";
	message: string;
	target?: string;
}

export interface MentionSourceMapEntry {
	tokenId: string;
	tokenType: MentionTokenType;
	channel: MentionChannel;
	target: string;
	zone?: ContextZoneType;
	dynamic?: boolean;
}

export interface MentionResolutionSummary {
	resolvedCount: number;
	errorCount: number;
	tokenTypes: MentionTokenType[];
	sourceMap: MentionSourceMapEntry[];
}

export interface MentionResolutionResult {
	text: string;
	entries: MentionResolvedEntry[];
	errors: MentionResolutionError[];
	summary: MentionResolutionSummary;
	channels: {
		mentioned_notes: MentionResolvedEntry[];
		folder_structures: MentionResolvedEntry[];
	};
}

export interface MentionResolverInput {
	document: MentionDocumentSnapshot;
	currentFilePath?: string;
	activeProjectRoot?: string;
	readFile: (path: string) => Promise<string | null>;
	listFolderEntries: (path: string) => Promise<string[]>;
	maxNoteChars?: number;
	maxFolderEntries?: number;
}

export interface LegacyMentionParseResult {
	text: string;
	tokens: MentionToken[];
}

const DEFAULT_MAX_NOTE_CHARS = 1800;
const DEFAULT_MAX_FOLDER_ENTRIES = 24;

export function parseLegacyMentionMarkup(text: string): LegacyMentionParseResult {
	const tokens: MentionToken[] = [];
	const stripped = text.replace(/@\[(.+?)\]/g, (_all, rawPath: string) => {
		const pathValue = normalizePathValue(rawPath);
		if (pathValue) {
			tokens.push({
				id: `legacy-note-${tokens.length + 1}`,
				type: "note",
				path: pathValue,
			});
		}
		return " ";
	});
	return {
		text: normalizeInlineText(stripped),
		tokens,
	};
}

export class MentionResolver {
	async resolve(input: MentionResolverInput): Promise<MentionResolutionResult> {
		const uniqueTokens = dedupeTokens(input.document.tokens);
		const entries: MentionResolvedEntry[] = [];
		const errors: MentionResolutionError[] = [];
		const sourceMap: MentionSourceMapEntry[] = [];

		for (const token of uniqueTokens) {
			if (token.type === "skill") {
				continue;
			}
			if (token.type === "folder") {
				const target = normalizePathValue(token.path);
				if (!target) {
					errors.push(this.buildError(token, "Folder mention is missing a target path."));
					continue;
				}
				const summary = await this.buildFolderSummary(target, input);
				const zone = this.resolveZone(target, input.activeProjectRoot);
				const entry: MentionResolvedEntry = {
					tokenId: token.id,
					tokenType: token.type,
					channel: "folder_structures",
					target,
					title: getBaseName(target),
					body: summary,
					summary,
					zone,
				};
				entries.push(entry);
				sourceMap.push(this.toSourceMap(entry));
				continue;
			}

			const target = token.type === "active_note"
				? normalizePathValue(input.currentFilePath)
				: normalizePathValue(token.path);
			if (!target) {
				errors.push(this.buildError(
					token,
					token.type === "active_note"
						? "Active note mention could not be resolved because there is no active note."
						: "Note mention is missing a target path.",
				));
				continue;
			}
			const content = await input.readFile(target);
			if (!content) {
				errors.push(this.buildError(token, `Mention target could not be loaded: ${target}`, target));
				continue;
			}
			const zone = this.resolveZone(target, input.activeProjectRoot);
			const body = clipText(content, input.maxNoteChars ?? DEFAULT_MAX_NOTE_CHARS);
			const entry: MentionResolvedEntry = {
				tokenId: token.id,
				tokenType: token.type,
				channel: "mentioned_notes",
				target,
				title: getBaseName(target),
				body,
				summary: body,
				zone,
				dynamic: token.type === "active_note",
			};
			entries.push(entry);
			sourceMap.push(this.toSourceMap(entry));
		}

		return {
			text: normalizeInlineText(input.document.text ?? ""),
			entries,
			errors,
			summary: {
				resolvedCount: entries.length,
				errorCount: errors.length,
				tokenTypes: [...new Set(entries.map((entry) => entry.tokenType))].sort(),
				sourceMap,
			},
			channels: {
				mentioned_notes: entries.filter((entry) => entry.channel === "mentioned_notes"),
				folder_structures: entries.filter((entry) => entry.channel === "folder_structures"),
			},
		};
	}

	private async buildFolderSummary(pathValue: string, input: MentionResolverInput): Promise<string> {
		const entries = (await input.listFolderEntries(pathValue))
			.map((entry) => normalizePathValue(entry))
			.filter(Boolean)
			.slice(0, input.maxFolderEntries ?? DEFAULT_MAX_FOLDER_ENTRIES);
		if (entries.length === 0) {
			return "(empty folder)";
		}
		const projectRoot = normalizePathValue(input.activeProjectRoot);
		return entries
			.map((entry) => {
				const relative = projectRoot && entry.startsWith(`${projectRoot}/`)
					? entry.slice(projectRoot.length + 1)
					: entry;
				return `- ${relative}`;
			})
			.join("\n");
	}

	private resolveZone(pathValue: string, activeProjectRoot?: string): ContextZoneType | undefined {
		const projectRoot = normalizePathValue(activeProjectRoot);
		if (!projectRoot || !pathValue.startsWith(`${projectRoot}/`)) {
			return undefined;
		}
		const relative = pathValue.slice(projectRoot.length + 1);
		const contentKind = relative.startsWith("wiki/") ? "wiki" : "raw";
		return resolveContextZone(relative, contentKind);
	}

	private buildError(token: MentionToken, message: string, target?: string): MentionResolutionError {
		return {
			tokenId: token.id,
			tokenType: token.type,
			code: "MENTION_RESOLUTION_FAILED",
			message,
			target,
		};
	}

	private toSourceMap(entry: MentionResolvedEntry): MentionSourceMapEntry {
		return {
			tokenId: entry.tokenId,
			tokenType: entry.tokenType,
			channel: entry.channel,
			target: entry.target,
			zone: entry.zone,
			dynamic: entry.dynamic,
		};
	}
}

function dedupeTokens(tokens: MentionToken[]): MentionToken[] {
	const seen = new Set<string>();
	const next: MentionToken[] = [];
	for (const token of tokens) {
		const pathValue = normalizePathValue(token.path);
		const key = `${token.type}:${pathValue}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		next.push({
			id: token.id,
			type: token.type,
			path: pathValue,
		});
	}
	return next;
}

function clipText(text: string, maxChars: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) {
		return trimmed;
	}
	return `${trimmed.slice(0, Math.max(0, maxChars - 9))}\n...(truncated)`;
}

function getBaseName(pathValue: string): string {
	const normalized = normalizePathValue(pathValue);
	const parts = normalized.split("/").filter(Boolean);
	return parts[parts.length - 1] ?? normalized;
}

function normalizeInlineText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function normalizePathValue(value: string | undefined): string {
	return String(value ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}
