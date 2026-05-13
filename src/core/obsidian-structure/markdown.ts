import type { StructureValidationIssue } from "./canvas";

export interface MarkdownHeading {
	depth: number;
	text: string;
	line: number;
}

export interface MarkdownReference {
	raw: string;
	target: string;
	display?: string;
	line: number;
}

export interface MarkdownOutline {
	frontmatter: Record<string, unknown>;
	headings: MarkdownHeading[];
	wikilinks: MarkdownReference[];
	embeds: MarkdownReference[];
	markdownLinks: MarkdownReference[];
}

export interface FrontmatterUpdateInput {
	set?: Record<string, unknown>;
	remove?: string[];
}

export interface MarkdownInsertReferenceInput {
	reference: string;
	placement?: "append" | "after_heading" | "before_heading";
	heading?: string;
	dedupe?: boolean;
}

export interface MarkdownValidationResult {
	ok: boolean;
	items: StructureValidationIssue[];
	summary: string;
}

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function outlineMarkdown(content: string): MarkdownOutline {
	const split = splitFrontmatter(content);
	const wikiReferences = extractWikiReferences(content);
	return {
		frontmatter: split.frontmatter,
		headings: extractHeadings(split.body, split.bodyLineOffset),
		wikilinks: [...wikiReferences.links, ...wikiReferences.embeds],
		embeds: wikiReferences.embeds,
		markdownLinks: extractMarkdownLinks(content),
	};
}

export function updateFrontmatter(content: string, input: FrontmatterUpdateInput): string {
	const split = splitFrontmatter(content);
	const updated: Record<string, unknown> = { ...split.frontmatter };
	for (const key of input.remove ?? []) {
		if (typeof key === "string" && key.trim()) {
			delete updated[key.trim()];
		}
	}
	for (const [key, value] of Object.entries(input.set ?? {})) {
		if (key.trim()) {
			updated[key.trim()] = value;
		}
	}
	const yaml = stringifySimpleYaml(updated).trimEnd();
	const body = split.body.replace(/^\r?\n/, "");
	return body ? `---\n${yaml}\n---\n\n${body}` : `---\n${yaml}\n---\n`;
}

export function insertMarkdownReference(content: string, input: MarkdownInsertReferenceInput): string {
	const reference = input.reference.trim();
	if (!reference) {
		return content;
	}
	if (input.dedupe !== false && content.includes(reference)) {
		return content;
	}
	const lines = content.replace(/\r/g, "").split("\n");
	const placement = input.placement ?? "append";
	if ((placement === "after_heading" || placement === "before_heading") && input.heading?.trim()) {
		const headingIndex = lines.findIndex((line) => normalizeHeadingText(line) === input.heading!.trim());
		if (headingIndex >= 0) {
			const insertAt = placement === "before_heading" ? headingIndex : findFirstContentLineAfterHeading(lines, headingIndex);
			lines.splice(insertAt, 0, reference);
			return normalizeTrailingNewline(lines.join("\n"), content);
		}
	}
	const suffix = content.endsWith("\n") ? "" : "\n";
	return `${content}${suffix}${reference}\n`;
}

export function validateMarkdownDocument(
	filePath: string,
	content: string,
	exists: (vaultPath: string) => boolean = () => false,
): MarkdownValidationResult {
	const items: StructureValidationIssue[] = [];
	try {
		splitFrontmatter(content);
	} catch (error) {
		items.push({
			severity: "error",
			code: "invalid_frontmatter",
			message: error instanceof Error ? error.message : String(error),
			path: filePath,
		});
	}
	const references = extractWikiReferences(content);
	for (const link of references.links) {
		if (!referenceExists(link.target, exists)) {
			items.push({
				severity: "error",
				code: "missing_wikilink",
				message: `Wikilink target does not exist: ${link.target}.`,
				path: filePath,
				target: link.target,
			});
		}
	}
	for (const embed of references.embeds) {
		if (!referenceExists(embed.target, exists)) {
			items.push({
				severity: "error",
				code: "missing_embed",
				message: `Embed target does not exist: ${embed.target}.`,
				path: filePath,
				target: embed.target,
			});
		}
	}
	for (const link of extractMarkdownLinks(content)) {
		if (isExternalOrAnchor(link.target)) {
			continue;
		}
		const targetPath = normalizeMarkdownLinkTarget(link.target);
		if (targetPath && !exists(targetPath)) {
			items.push({
				severity: "error",
				code: "missing_markdown_link",
				message: `Markdown link target does not exist: ${link.target}.`,
				path: filePath,
				target: link.target,
			});
		}
	}
	return {
		ok: !items.some((item) => item.severity === "error"),
		items,
		summary: items.length === 0 ? "Markdown structure is valid." : `Markdown has ${items.length} issue(s).`,
	};
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string; bodyLineOffset: number } {
	const match = content.match(FRONTMATTER_RE);
	if (!match) {
		return { frontmatter: {}, body: content, bodyLineOffset: 0 };
	}
	const yaml = match[1] ?? "";
	const parsed = yaml.trim() ? parseSimpleYaml(yaml) : {};
	if (parsed !== null && (typeof parsed !== "object" || Array.isArray(parsed))) {
		throw new Error("Frontmatter must parse to an object.");
	}
	const consumed = match[0] ?? "";
	return {
		frontmatter: (parsed ?? {}) as Record<string, unknown>,
		body: content.slice(consumed.length),
		bodyLineOffset: consumed.split(/\r?\n/).length - 1,
	};
}

function extractHeadings(content: string, lineOffset: number): MarkdownHeading[] {
	const headings: MarkdownHeading[] = [];
	const lines = content.replace(/\r/g, "").split("\n");
	for (const [index, line] of lines.entries()) {
		const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
		if (!match) continue;
		headings.push({
			depth: (match[1] ?? "").length,
			text: (match[2] ?? "").trim(),
			line: lineOffset + index + 1,
		});
	}
	return headings;
}

function extractWikiReferences(content: string): { links: MarkdownReference[]; embeds: MarkdownReference[] } {
	const links: MarkdownReference[] = [];
	const embeds: MarkdownReference[] = [];
	const re = /(!)?\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(content))) {
		const raw = match[0];
		const body = match[2] ?? "";
		const [targetPart = "", displayPart] = body.split("|");
		const target = stripSubpath(targetPart.trim());
		const reference = {
			raw,
			target,
			...(displayPart ? { display: displayPart.trim() } : {}),
			line: lineNumberAt(content, match.index),
		};
		if (match[1]) {
			embeds.push(reference);
		} else {
			links.push(reference);
		}
	}
	return { links, embeds };
}

function extractMarkdownLinks(content: string): MarkdownReference[] {
	const links: MarkdownReference[] = [];
	const re = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(content))) {
		links.push({
			raw: match[0],
			display: match[1],
			target: match[2] ?? "",
			line: lineNumberAt(content, match.index),
		});
	}
	return links;
}

function normalizeHeadingText(line: string): string {
	const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
	return match ? (match[2] ?? "").trim() : "";
}

function findFirstContentLineAfterHeading(lines: string[], headingIndex: number): number {
	let index = headingIndex + 1;
	while (index < lines.length && (lines[index] ?? "").trim() === "") {
		index += 1;
	}
	return index;
}

function normalizeTrailingNewline(value: string, original: string): string {
	return original.endsWith("\n") && !value.endsWith("\n") ? `${value}\n` : value;
}

function lineNumberAt(content: string, offset: number): number {
	return content.slice(0, offset).split(/\r?\n/).length;
}

function stripSubpath(target: string): string {
	const hashIndex = target.indexOf("#");
	return hashIndex >= 0 ? target.slice(0, hashIndex).trim() : target.trim();
}

function referenceExists(target: string, exists: (vaultPath: string) => boolean): boolean {
	const normalized = stripSubpath(target);
	if (!normalized) {
		return true;
	}
	if (exists(normalized)) {
		return true;
	}
	if (!/\.[A-Za-z0-9]+$/.test(normalized) && exists(`${normalized}.md`)) {
		return true;
	}
	return false;
}

function normalizeMarkdownLinkTarget(target: string): string {
	const withoutHash = stripSubpath(target);
	try {
		return decodeURIComponent(withoutHash);
	} catch {
		return withoutHash;
	}
}

function isExternalOrAnchor(target: string): boolean {
	return /^([a-z][a-z0-9+.-]*:|#)/i.test(target.trim());
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = yaml.replace(/\r/g, "").split("\n");
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim() || line.trim().startsWith("#")) {
			continue;
		}
		const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
		if (!match) {
			throw new Error(`Unsupported frontmatter line: ${line}`);
		}
		const key = match[1] ?? "";
		const rawValue = match[2] ?? "";
		if (rawValue.trim()) {
			result[key] = parseYamlScalar(rawValue.trim());
			continue;
		}
		const values: unknown[] = [];
		let cursor = index + 1;
		while (cursor < lines.length) {
			const itemMatch = (lines[cursor] ?? "").match(/^\s+-\s*(.*)$/);
			if (!itemMatch) {
				break;
			}
			values.push(parseYamlScalar((itemMatch[1] ?? "").trim()));
			cursor += 1;
		}
		result[key] = values;
		index = cursor - 1;
	}
	return result;
}

function stringifySimpleYaml(value: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [key, raw] of Object.entries(value)) {
		if (Array.isArray(raw)) {
			lines.push(`${key}:`);
			for (const item of raw) {
				lines.push(`  - ${formatYamlScalar(item)}`);
			}
		} else {
			lines.push(`${key}: ${formatYamlScalar(raw)}`);
		}
	}
	return lines.join("\n");
}

function parseYamlScalar(value: string): unknown {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
		return trimmed.slice(1, -1);
	}
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return trimmed;
}

function formatYamlScalar(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean" || typeof value === "number") return String(value);
	const text = String(value);
	return /[:#{}[\],&*!|>'"%@`]|\s$|^\s/.test(text) ? JSON.stringify(text) : text;
}
