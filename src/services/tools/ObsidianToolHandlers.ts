import { promises as fsPromises } from "fs";
import path from "path";
import { normalizePath, TFile, TFolder } from "obsidian";
import type { AgentActionType } from "../../types/action";
import type { MemoryWriteInput } from "../../core/memory/MemoryTypes";
import { resolveAgentWritableVaultPath } from "../../utils/projectWorkspacePolicy";
import { applyCanvasDocument, summarizeCanvasDocument } from "../../core/obsidian-structure/canvas";
import { insertMarkdownReference, outlineMarkdown, updateFrontmatter, validateMarkdownDocument } from "../../core/obsidian-structure/markdown";
import { validateOutputDocument, validateOutputs } from "../../core/obsidian-structure/validation";
import type { ObsidianToolContext } from "./ObsidianToolContext";

const MAX_TOOL_RESULT_ITEM = 80;
const DEFAULT_MAX_LIST = 120;
const DEFAULT_MAX_READ_CHARS = 10000;
const DEFAULT_MAX_GREP_MATCHES = 40;
const DEFAULT_MAX_READ_MANY_FILES = 8;
const DEFAULT_MAX_READ_MANY_CHARS = 6000;
const DEFAULT_MAX_SEARCH_AND_READ_MATCHES = 20;
const DEFAULT_MAX_SEARCH_AND_READ_CHARS = 800;
const DEFAULT_MAX_TREE_DEPTH = 3;
const DEFAULT_MAX_TREE_ENTRIES = 160;
const GENERATED_TREE_SEGMENTS = new Set(["node_modules", ".git", ".obsidian", "dist", "build", "coverage", ".cache", ".tmp", "tmp"]);

interface ExecVaultDeleteRedirect {
	routedToDelete: true;
	path: string;
	deletedType: "file" | "folder";
}

export class ObsidianToolHandlers {
	constructor(private readonly context: ObsidianToolContext) {}

	async toolUseSkill(args: Record<string, unknown>): Promise<unknown> {
		const command = this.context.getRequiredStringArg(args, "command");
		const reason = this.context.getStringArg(args, "reason");
		const skillContext = await this.context.skillCommandService.buildSkillSystemContext(command, {
			invocationMode: "auto",
			selectionReason: reason || "Model selected the skill during runtime routing.",
		});
		return {
			command: skillContext.skill.command,
			name: skillContext.skill.name,
			description: skillContext.skill.description,
			loaded: true,
			summary: `Loaded skill ${skillContext.skill.command}`,
			systemContext: skillContext.systemContext,
		};
	}

	async toolMemory(args: Record<string, unknown>): Promise<unknown> {
		const action = this.context.getRequiredStringArg(args, "action") as MemoryWriteInput["action"];
		const scope = this.context.getRequiredStringArg(args, "scope") as MemoryWriteInput["scope"];
		const content = this.context.getStringArg(args, "content");
		const oldText = this.context.getStringArg(args, "old_text");
		const activeProjectRoot = this.context.projectBoundaryService.getActiveProjectRoot();
		const result = await this.context.memoryStore.write({
			action,
			scope,
			content,
			oldText,
			projectRoot: scope === "project" ? activeProjectRoot || undefined : undefined,
		});
		return result;
	}

	async toolList(args: Record<string, unknown>): Promise<unknown> {
		const rawPath = this.context.getStringArg(args, "path");
		const maxEntries = this.context.getPositiveIntArg(args, "maxEntries", DEFAULT_MAX_LIST);
		const recursive = this.context.getBooleanArg(args, "recursive", false);
		const scope = this.context.resolveScope(rawPath);
		if (scope === "external") {
			if (!rawPath || !this.context.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath || "(empty path)"}`);
			}
			const rows = await this.context.listExternal(rawPath, recursive, maxEntries);
			return {
				scope: "external",
				path: rawPath,
				items: rows,
			};
		}

		const targetPath = this.context.resolveDefaultVaultSearchPath(rawPath);
		if (targetPath && !this.context.workspaceAccessService.canReadVaultPath(targetPath)) {
			throw new Error(this.context.buildVaultScopeDeniedError(targetPath, "read"));
		}

		const rows = this.context.listVault(targetPath, recursive, maxEntries);
		return {
			scope: "vault",
			path: targetPath,
			items: rows,
		};
	}

	async toolRead(args: Record<string, unknown>): Promise<unknown> {
		const rawPath = this.context.getRequiredStringArg(args, "path");
		const maxChars = this.context.getPositiveIntArg(args, "maxChars", DEFAULT_MAX_READ_CHARS);
		const scope = this.context.resolveScope(rawPath);

		if (scope === "external") {
			if (!this.context.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath}`);
			}
			const stat = await fsPromises.stat(rawPath);
			if (!stat.isFile()) {
				throw new Error(`External path is not a file: ${rawPath}`);
			}
			const text = await fsPromises.readFile(rawPath, "utf8");
			return {
				scope: "external",
				path: rawPath,
				content: this.context.truncateText(text, maxChars),
				truncated: text.length > maxChars,
			};
		}

		const targetPath = this.context.resolveVaultFilePath(rawPath);
		if (!this.context.workspaceAccessService.canReadVaultPath(targetPath)) {
			throw new Error(this.context.buildVaultScopeDeniedError(targetPath, "read"));
		}
		const file = this.context.vault.getAbstractFileByPath(targetPath);
		if (!(file instanceof TFile)) {
			throw new Error(`Vault file does not exist: ${targetPath}`);
		}
		const text = await this.context.vault.cachedRead(file);
		return {
			scope: "vault",
			path: targetPath,
			content: this.context.truncateText(text, maxChars),
			truncated: text.length > maxChars,
		};
	}

	async toolReadMany(args: Record<string, unknown>): Promise<unknown> {
		const maxFiles = this.context.getPositiveIntArg(args, "maxFiles", DEFAULT_MAX_READ_MANY_FILES);
		const maxCharsPerFile = this.context.getPositiveIntArg(args, "maxCharsPerFile", DEFAULT_MAX_READ_MANY_CHARS);
		const paths = this.getStringArrayArg(args, "paths")
			.slice(0, maxFiles);
		if (paths.length === 0) {
			throw new Error("read_many requires at least one path.");
		}

		const files = [];
		for (const inputPath of paths) {
			try {
				const data = await this.toolRead({ path: inputPath, maxChars: maxCharsPerFile }) as {
					scope?: string;
					path?: string;
					content?: string;
					truncated?: boolean;
				};
				files.push({
					ok: true,
					inputPath,
					scope: data.scope,
					path: data.path,
					content: data.content,
					truncated: Boolean(data.truncated),
				});
			} catch (error) {
				files.push({
					ok: false,
					inputPath,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		return {
			scope: "mixed",
			requested: this.getStringArrayArg(args, "paths").length,
			returned: files.length,
			files,
			truncated: this.getStringArrayArg(args, "paths").length > files.length,
		};
	}

	async toolGrep(args: Record<string, unknown>): Promise<unknown> {
		const pattern = this.context.getRequiredStringArg(args, "pattern");
		const flags = this.context.getStringArg(args, "flags") || "i";
		const maxMatches = this.context.getPositiveIntArg(args, "maxMatches", DEFAULT_MAX_GREP_MATCHES);
		const rawPath = this.context.getStringArg(args, "path");
		const scope = this.context.resolveScope(rawPath);
		const regExp = this.context.buildSafeRegex(pattern, flags);

		const matches: Array<{ path: string; line: number; text: string }> = [];
		if (scope === "external") {
			if (!rawPath || !this.context.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath || "(empty path)"}`);
			}
			const fileList = await this.context.collectExternalFiles(rawPath, 120);
			for (const filePath of fileList) {
				const text = await fsPromises.readFile(filePath, "utf8");
				this.context.appendGrepMatches(matches, filePath, text, regExp, maxMatches);
				if (matches.length >= maxMatches) break;
			}
		} else {
			const targetPath = this.context.resolveDefaultVaultSearchPath(rawPath);
			if (targetPath && !this.context.workspaceAccessService.canReadVaultPath(targetPath)) {
				throw new Error(this.context.buildVaultScopeDeniedError(targetPath, "read"));
			}
			const files = this.context.vault
				.getFiles()
				.filter((file) => !targetPath || this.context.isPathWithin(file.path, targetPath));
			for (const file of files) {
				if (!this.context.workspaceAccessService.canReadVaultPath(file.path)) {
					continue;
				}
				const text = await this.context.vault.cachedRead(file);
				this.context.appendGrepMatches(matches, file.path, text, regExp, maxMatches);
				if (matches.length >= maxMatches) break;
			}
		}

		return {
			scope,
			path: rawPath || "",
			pattern,
			matches,
			truncated: matches.length >= maxMatches,
		};
	}

	async toolSearchText(args: Record<string, unknown>): Promise<unknown> {
		const query = this.context.getRequiredStringArg(args, "query");
		return this.toolGrep({
			path: this.context.getStringArg(args, "path"),
			pattern: this.context.escapeRegExp(query),
			flags: "i",
			maxMatches: this.context.getPositiveIntArg(args, "maxMatches", DEFAULT_MAX_GREP_MATCHES),
		});
	}

	async toolSearchAndRead(args: Record<string, unknown>): Promise<unknown> {
		const mode = (this.context.getStringArg(args, "mode") || "text").toLowerCase();
		const query = this.context.getStringArg(args, "query");
		const rawPattern = this.context.getStringArg(args, "pattern");
		const pattern = mode === "regex" ? rawPattern : this.context.escapeRegExp(query);
		if (!pattern) {
			throw new Error("search_and_read requires query for text mode or pattern for regex mode.");
		}
		const flags = this.context.getStringArg(args, "flags") || "i";
		const maxMatches = this.context.getPositiveIntArg(args, "maxMatches", DEFAULT_MAX_SEARCH_AND_READ_MATCHES);
		const maxCharsPerMatch = this.context.getPositiveIntArg(args, "maxCharsPerMatch", DEFAULT_MAX_SEARCH_AND_READ_CHARS);
		const grepResult = await this.toolGrep({
			path: this.context.getStringArg(args, "path"),
			pattern,
			flags,
			maxMatches,
		}) as {
			scope?: string;
			path?: string;
			matches?: Array<{ path: string; line: number; text: string }>;
			truncated?: boolean;
		};
		const matches = Array.isArray(grepResult.matches) ? grepResult.matches : [];
		const textByPath = new Map<string, string>();
		const enrichedMatches = [];
		for (const match of matches) {
			let content = textByPath.get(match.path);
			if (content === undefined) {
				try {
					const readResult = await this.toolRead({ path: match.path, maxChars: 100000 }) as { content?: string };
					content = typeof readResult.content === "string" ? readResult.content : "";
				} catch {
					content = "";
				}
				textByPath.set(match.path, content);
			}
			enrichedMatches.push({
				path: match.path,
				line: match.line,
				text: match.text,
				snippet: this.buildLineSnippet(content, match.line, maxCharsPerMatch),
			});
		}

		return {
			scope: grepResult.scope ?? this.context.resolveScope(this.context.getStringArg(args, "path")),
			path: grepResult.path ?? this.context.getStringArg(args, "path") ?? "",
			mode: mode === "regex" ? "regex" : "text",
			query: mode === "regex" ? undefined : query,
			pattern,
			matches: enrichedMatches,
			truncated: Boolean(grepResult.truncated),
		};
	}

	async toolGlob(args: Record<string, unknown>): Promise<unknown> {
		const pattern = this.context.getRequiredStringArg(args, "pattern");
		const maxMatches = this.context.getPositiveIntArg(args, "maxMatches", MAX_TOOL_RESULT_ITEM);
		const rawPath = this.context.getStringArg(args, "path");
		const scope = this.context.resolveScope(rawPath);
		const matcher = this.context.globToRegex(pattern);

		const matched: string[] = [];
		if (scope === "external") {
			if (!rawPath || !this.context.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath || "(empty path)"}`);
			}
			const files = await this.context.collectExternalFiles(rawPath, 300);
			for (const filePath of files) {
				const relative = rawPath ? normalizePath(path.relative(rawPath, filePath)) : filePath;
				const baseName = path.basename(filePath);
				if (matcher.test(relative) || (!pattern.includes("/") && matcher.test(baseName))) {
					matched.push(filePath);
				}
				if (matched.length >= maxMatches) break;
			}
		} else {
			const targetPath = this.context.resolveDefaultVaultSearchPath(rawPath);
			if (targetPath && !this.context.workspaceAccessService.canReadVaultPath(targetPath)) {
				throw new Error(this.context.buildVaultScopeDeniedError(targetPath, "read"));
			}
			for (const file of this.context.vault.getFiles()) {
				if (targetPath && !this.context.isPathWithin(file.path, targetPath)) {
					continue;
				}
				if (!this.context.workspaceAccessService.canReadVaultPath(file.path)) {
					continue;
				}
				const relative = targetPath ? normalizePath(path.posix.relative(targetPath, file.path)) : file.path;
				const baseName = path.posix.basename(file.path);
				if (matcher.test(relative) || (!pattern.includes("/") && matcher.test(baseName))) {
					matched.push(file.path);
				}
				if (matched.length >= maxMatches) break;
			}
		}

		return {
			scope,
			path: rawPath || "",
			pattern,
			files: matched,
			truncated: matched.length >= maxMatches,
		};
	}

	async toolProjectTree(args: Record<string, unknown>): Promise<unknown> {
		const rawPath = this.context.getStringArg(args, "path");
		const maxDepth = this.context.getPositiveIntArg(args, "maxDepth", DEFAULT_MAX_TREE_DEPTH);
		const maxEntries = this.context.getPositiveIntArg(args, "maxEntries", DEFAULT_MAX_TREE_ENTRIES);
		const scope = this.context.resolveScope(rawPath);
		let basePath = "";
		let rows: string[] = [];
		if (scope === "external") {
			if (!rawPath || !this.context.workspaceAccessService.canReadExternalPath(rawPath)) {
				throw new Error(`No permission to read external path: ${rawPath || "(empty path)"}`);
			}
			basePath = rawPath;
			rows = await this.context.listExternal(rawPath, true, maxEntries * 4);
		} else {
			basePath = this.context.resolveDefaultVaultSearchPath(rawPath);
			if (basePath && !this.context.workspaceAccessService.canReadVaultPath(basePath)) {
				throw new Error(this.context.buildVaultScopeDeniedError(basePath, "read"));
			}
			rows = this.context.listVault(basePath, true, maxEntries * 4);
		}

		const entries = rows
			.map((entry) => this.toTreeEntry(entry, basePath, scope, maxDepth))
			.filter((entry): entry is { path: string; relativePath: string; depth: number; label: string } => Boolean(entry))
			.slice(0, maxEntries);

		return {
			scope,
			path: basePath,
			maxDepth,
			entries: entries.map((entry) => entry.path),
			tree: entries.map((entry) => `${"  ".repeat(Math.max(0, entry.depth - 1))}- ${entry.label}`).join("\n"),
			truncated: rows.length > entries.length,
		};
	}

	async toolCanvasRead(args: Record<string, unknown>): Promise<unknown> {
		const pathValue = this.context.getRequiredStringArg(args, "path");
		const file = await this.readVaultFile(pathValue);
		return summarizeCanvasDocument(file.content, file.path, (vaultPath) => this.vaultReferenceExists(vaultPath));
	}

	async toolCanvasApply(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
		const pathValue = this.context.getRequiredStringArg(args, "path");
		const effectivePath = this.resolveWritablePath(pathValue);
		const existing = this.context.vault.getAbstractFileByPath(effectivePath);
		const mode = this.context.getStringArg(args, "mode").toLowerCase() || "upsert";
		if (mode === "update" && !(existing instanceof TFile)) {
			throw new Error(`Vault file does not exist: ${effectivePath}`);
		}
		const beforeContent = existing instanceof TFile ? await this.context.vault.cachedRead(existing) : "";
		const result = applyCanvasDocument(beforeContent, {
			mode: mode === "create" || mode === "update" ? mode : "upsert",
			nodes: this.getRecordArrayArg(args, "nodes"),
			edges: this.getRecordArrayArg(args, "edges"),
			autoLayout: this.context.getBooleanArg(args, "autoLayout", true),
		});
		if (!result.validation.ok) {
			throw new Error(`canvas_apply produced invalid canvas: ${result.validation.summary}`);
		}
		return this.recordStructuredMutation({
			agentId,
			toolCallId,
			tool: "canvas_apply",
			path: effectivePath,
			beforeContent,
			afterContent: result.content,
			changeType: existing instanceof TFile ? "update" : "create",
			extra: {
				nodeCount: result.document.nodes.length,
				edgeCount: result.document.edges.length,
				validation: result.validation,
			},
		});
	}

	async toolMarkdownOutline(args: Record<string, unknown>): Promise<unknown> {
		const file = await this.readVaultFile(this.context.getRequiredStringArg(args, "path"));
		return {
			path: file.path,
			...outlineMarkdown(file.content),
		};
	}

	async toolFrontmatterUpdate(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
		const pathValue = this.context.getRequiredStringArg(args, "path");
		const file = await this.readVaultFile(pathValue);
		this.context.assertAgentWritableVaultPath(file.path);
		const afterContent = updateFrontmatter(file.content, {
			set: this.getRecordArg(args, "set"),
			remove: this.getStringArrayArg(args, "remove"),
		});
		return this.recordStructuredMutation({
			agentId,
			toolCallId,
			tool: "frontmatter_update",
			path: file.path,
			beforeContent: file.content,
			afterContent,
			changeType: "update",
			extra: {
				validation: validateMarkdownDocument(file.path, afterContent, (vaultPath) => this.vaultReferenceExists(vaultPath)),
			},
		});
	}

	async toolMarkdownInsertReference(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
		const pathValue = this.context.getRequiredStringArg(args, "path");
		const file = await this.readVaultFile(pathValue);
		this.context.assertAgentWritableVaultPath(file.path);
		const afterContent = insertMarkdownReference(file.content, {
			reference: this.context.getRequiredStringArg(args, "reference"),
			placement: this.normalizeReferencePlacement(this.context.getStringArg(args, "placement")),
			heading: this.context.getStringArg(args, "heading") || undefined,
			dedupe: this.context.getBooleanArg(args, "dedupe", true),
		});
		return this.recordStructuredMutation({
			agentId,
			toolCallId,
			tool: "markdown_insert_reference",
			path: file.path,
			beforeContent: file.content,
			afterContent,
			changeType: "update",
			extra: {
				validation: validateMarkdownDocument(file.path, afterContent, (vaultPath) => this.vaultReferenceExists(vaultPath)),
			},
		});
	}

	async toolValidateCanvas(args: Record<string, unknown>): Promise<unknown> {
		const file = await this.readVaultFile(this.context.getRequiredStringArg(args, "path"));
		const result = validateOutputDocument(file.path, file.content, (vaultPath) => this.vaultReferenceExists(vaultPath));
		return result;
	}

	async toolValidateMarkdown(args: Record<string, unknown>): Promise<unknown> {
		const file = await this.readVaultFile(this.context.getRequiredStringArg(args, "path"));
		return validateOutputDocument(file.path, file.content, (vaultPath) => this.vaultReferenceExists(vaultPath));
	}

	async toolValidateOutputs(args: Record<string, unknown>): Promise<unknown> {
		const paths = this.getStringArrayArg(args, "paths");
		if (paths.length === 0) {
			throw new Error("validate_outputs requires at least one path.");
		}
		const docs = new Map<string, string>();
		for (const inputPath of paths) {
			try {
				const file = await this.readVaultFile(inputPath);
				docs.set(file.path, file.content);
			} catch {
				// validateOutputs reports missing files using the resolved path/existence host.
			}
		}
		return validateOutputs(paths, {
			read: (targetPath) => {
				try {
					const resolvedPath = this.context.resolveVaultFilePath(targetPath);
					return docs.get(resolvedPath) ?? null;
				} catch {
					return null;
				}
			},
			exists: (targetPath) => this.vaultReferenceExists(targetPath),
		});
	}

	async toolCompileWiki(args: Record<string, unknown>): Promise<unknown> {
		const mode = this.context.getStringArg(args, "mode").toLowerCase();
		if (mode === "all") {
			return this.context.wikiCompileCapability.execute(undefined, true);
		}

		const requestedPaths: string[] = [];
		const singlePath = this.context.getStringArg(args, "path");
		if (singlePath) {
			requestedPaths.push(singlePath);
		}

		const multiPaths = args["paths"];
		if (Array.isArray(multiPaths)) {
			for (const item of multiPaths) {
				if (typeof item !== "string") {
					continue;
				}
				const normalized = item.trim();
				if (normalized) {
					requestedPaths.push(normalized);
				}
			}
		}

		const normalized = [...new Set(requestedPaths.map((item) => normalizePath(item)))].filter(Boolean);
		return this.context.wikiCompileCapability.execute(normalized.length > 0 ? normalized : undefined, false);
	}

	async toolWrite(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
		const pathValue = this.context.getRequiredStringArg(args, "path");
		if (this.context.resolveScope(pathValue) === "external") {
			throw new Error("write only supports Vault-relative paths.");
		}
		const activeProjectRoot = this.context.projectBoundaryService.getActiveProjectRoot();
		const normalizedPath = activeProjectRoot
			? resolveAgentWritableVaultPath(activeProjectRoot, pathValue)
			: normalizePath(pathValue);
		const resolvedExistingPath = this.context.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.context.assertAgentWritableVaultPath(effectivePath);
		const modeRaw = this.context.getStringArg(args, "mode").toLowerCase();
		const content = this.context.getRequiredStringArg(args, "content");
		const existing = this.context.vault.getAbstractFileByPath(effectivePath);

		let actionType: AgentActionType = "update";
		if (modeRaw === "create") {
			actionType = "create";
		} else if (modeRaw === "update") {
			actionType = "update";
		} else {
			actionType = existing instanceof TFile ? "update" : "create";
		}

		const beforeContent = existing instanceof TFile ? await this.context.vault.cachedRead(existing) : "";
		const afterContent = content;
		const diffSegments = this.context.inlineEditService.computeLineDiff(beforeContent, afterContent);
		const editPlanId = await this.context.recordEditPlan({
			agentId,
			toolCallId,
			tool: "write",
			path: effectivePath,
			before: beforeContent,
			after: afterContent,
			changeType: actionType === "create" ? "create" : "update",
		});
		const applied = await this.context.maybeAutoApplyEditPlan(editPlanId);
		return {
			editPlanId,
			path: effectivePath,
			type: actionType,
			status: applied ? "applied" : "pending_review",
			planned: !applied,
			applied,
			diff: this.context.makeSimpleDiffSummary(beforeContent, afterContent),
			diffPreview: this.context.inlineEditService.formatDiffForModel(diffSegments),
		};
	}

	async toolDelete(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
		const pathValue = this.context.getRequiredStringArg(args, "path");
		if (this.context.resolveScope(pathValue) === "external") {
			throw new Error("delete only supports Vault-relative paths.");
		}
		const normalizedPath = normalizePath(pathValue);
		const resolvedExistingPath = this.context.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.context.assertAgentWritableVaultPath(effectivePath);
		const beforeTarget = this.context.vault.getAbstractFileByPath(effectivePath);
		if (!(beforeTarget instanceof TFile) && !(beforeTarget instanceof TFolder)) {
			throw new Error(`Vault path does not exist: ${effectivePath}`);
		}
		const deletedType = beforeTarget instanceof TFolder ? "folder" : "file";
		const beforeContent = beforeTarget instanceof TFile ? await this.context.vault.cachedRead(beforeTarget) : "";
		if (deletedType === "folder") {
			throw new Error("Folder delete cannot be represented as a reviewable mutation plan yet.");
		}
		const editPlanId = await this.context.recordEditPlan({
			agentId,
			toolCallId,
			tool: "delete",
			path: effectivePath,
			before: beforeContent,
			after: "",
			changeType: "delete",
		});
		const applied = await this.context.maybeAutoApplyEditPlan(editPlanId);
		return {
			editPlanId,
			path: effectivePath,
			type: "delete",
			deletedType,
			status: applied ? "applied" : "pending_review",
			planned: !applied,
			applied,
		};
	}

	async toolEdit(args: Record<string, unknown>, agentId: string, toolCallId?: string): Promise<unknown> {
		const pathValue = this.context.getRequiredStringArg(args, "path");
		if (this.context.resolveScope(pathValue) === "external") {
			throw new Error("edit only supports Vault-relative paths.");
		}
		const normalizedPath = normalizePath(pathValue);
		const resolvedExistingPath = this.context.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.context.assertAgentWritableVaultPath(effectivePath);
		const file = this.context.vault.getAbstractFileByPath(effectivePath);
		if (!(file instanceof TFile)) {
			throw new Error(`Vault file does not exist: ${effectivePath}`);
		}
		const beforeContent = await this.context.vault.cachedRead(file);
		const edits = this.context.parseEditOperations(args);
		const editResult = this.context.inlineEditService.applyEdits(beforeContent, edits);

		if (editResult.appliedCount === 0) {
			throw new Error(`No matching text found: ${editResult.failedReasons.join("; ")}`);
		}

		const diffSegments = this.context.inlineEditService.computeLineDiff(beforeContent, editResult.result);
		const editPlanId = await this.context.recordEditPlan({
			agentId,
			toolCallId,
			tool: "edit",
			path: effectivePath,
			before: beforeContent,
			after: editResult.result,
			changeType: "update",
		});
		const applied = await this.context.maybeAutoApplyEditPlan(editPlanId);
		return {
			editPlanId,
			path: effectivePath,
			status: applied ? "applied" : "pending_review",
			planned: !applied,
			applied,
			proposedEdits: editResult.appliedCount,
			appliedEdits: editResult.appliedCount,
			failedReasons: editResult.failedReasons,
			diffPreview: this.context.inlineEditService.formatDiffForModel(diffSegments),
		};
	}

	private getStringArrayArg(args: Record<string, unknown>, key: string): string[] {
		const raw = args[key];
		if (!Array.isArray(raw)) {
			return [];
		}
		return raw
			.map((item) => typeof item === "string" ? item.trim() : "")
			.filter((item) => item.length > 0);
	}

	private getRecordArg(args: Record<string, unknown>, key: string): Record<string, unknown> {
		const raw = args[key];
		return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
	}

	private getRecordArrayArg(args: Record<string, unknown>, key: string): Record<string, unknown>[] {
		const raw = args[key];
		if (!Array.isArray(raw)) {
			return [];
		}
		return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
	}

	private async readVaultFile(pathValue: string): Promise<{ path: string; content: string }> {
		if (this.context.resolveScope(pathValue) === "external") {
			throw new Error(`${pathValue} is outside the Vault. Obsidian structure tools only support Vault files.`);
		}
		const targetPath = this.context.resolveVaultFilePath(pathValue);
		if (!this.context.workspaceAccessService.canReadVaultPath(targetPath)) {
			throw new Error(this.context.buildVaultScopeDeniedError(targetPath, "read"));
		}
		const file = this.context.vault.getAbstractFileByPath(targetPath);
		if (!(file instanceof TFile)) {
			throw new Error(`Vault file does not exist: ${targetPath}`);
		}
		return {
			path: targetPath,
			content: await this.context.vault.cachedRead(file),
		};
	}

	private resolveWritablePath(pathValue: string): string {
		if (this.context.resolveScope(pathValue) === "external") {
			throw new Error("Obsidian structure tools only support Vault-relative writes.");
		}
		const activeProjectRoot = this.context.projectBoundaryService.getActiveProjectRoot();
		const normalizedPath = activeProjectRoot
			? resolveAgentWritableVaultPath(activeProjectRoot, pathValue)
			: normalizePath(pathValue);
		const resolvedExistingPath = this.context.resolveExistingVaultFilePath(normalizedPath);
		const effectivePath = resolvedExistingPath ?? normalizedPath;
		this.context.assertAgentWritableVaultPath(effectivePath);
		return effectivePath;
	}

	private async recordStructuredMutation(input: {
		agentId: string;
		toolCallId?: string;
		tool: string;
		path: string;
		beforeContent: string;
		afterContent: string;
		changeType: "create" | "update";
		extra?: Record<string, unknown>;
	}): Promise<unknown> {
		const diffSegments = this.context.inlineEditService.computeLineDiff(input.beforeContent, input.afterContent);
		const editPlanId = await this.context.recordEditPlan({
			agentId: input.agentId,
			toolCallId: input.toolCallId,
			tool: input.tool,
			path: input.path,
			before: input.beforeContent,
			after: input.afterContent,
			changeType: input.changeType,
		});
		const applied = await this.context.maybeAutoApplyEditPlan(editPlanId);
		return {
			editPlanId,
			path: input.path,
			type: input.changeType,
			status: applied ? "applied" : "pending_review",
			planned: !applied,
			applied,
			diff: this.context.makeSimpleDiffSummary(input.beforeContent, input.afterContent),
			diffPreview: this.context.inlineEditService.formatDiffForModel(diffSegments),
			...(input.extra ?? {}),
		};
	}

	private vaultReferenceExists(targetPath: string): boolean {
		const normalized = normalizePath(targetPath.replace(/\\/g, "/").trim());
		if (!normalized) {
			return true;
		}
		try {
			const resolved = this.context.resolveVaultFilePath(normalized);
			if (this.context.vault.getAbstractFileByPath(resolved)) {
				return true;
			}
		} catch {
			// Fall through to direct and basename checks.
		}
		if (this.context.vault.getAbstractFileByPath(normalized)) {
			return true;
		}
		if (!/\.[A-Za-z0-9]+$/.test(normalized) && this.context.vault.getAbstractFileByPath(`${normalized}.md`)) {
			return true;
		}
		const basename = path.posix.basename(normalized, path.posix.extname(normalized));
		return this.context.vault.getFiles().some((file) => file.basename === basename || file.path === normalized || file.path === `${normalized}.md`);
	}

	private normalizeReferencePlacement(value: string): "append" | "after_heading" | "before_heading" {
		const normalized = value.trim().toLowerCase();
		if (normalized === "after_heading" || normalized === "before_heading") {
			return normalized;
		}
		return "append";
	}

	private buildLineSnippet(content: string, oneBasedLine: number, maxChars: number): string {
		if (!content) {
			return "";
		}
		const lines = content.split(/\r?\n/);
		const index = Math.max(0, oneBasedLine - 1);
		const start = Math.max(0, index - 2);
		const end = Math.min(lines.length, index + 3);
		return this.context.truncateText(lines.slice(start, end).join("\n"), maxChars);
	}

	private toTreeEntry(
		entryPath: string,
		basePath: string,
		scope: string,
		maxDepth: number,
	): { path: string; relativePath: string; depth: number; label: string } | null {
		const normalizedEntry = normalizePath(entryPath);
		const normalizedBase = normalizePath(basePath || "");
		const relativePath = scope === "external"
			? normalizePath(path.relative(normalizedBase, normalizedEntry))
			: (normalizedBase ? normalizePath(path.posix.relative(normalizedBase, normalizedEntry)) : normalizedEntry);
		const visibleRelative = relativePath && !relativePath.startsWith("..") ? relativePath : normalizedEntry;
		const segments = visibleRelative.split("/").filter(Boolean);
		if (segments.length === 0 || segments.length > maxDepth) {
			return null;
		}
		if (segments.some((segment) => this.isGeneratedOrHiddenTreeSegment(segment))) {
			return null;
		}
		return {
			path: normalizedEntry,
			relativePath: visibleRelative,
			depth: segments.length,
			label: segments[segments.length - 1] ?? normalizedEntry,
		};
	}

	private isGeneratedOrHiddenTreeSegment(segment: string): boolean {
		const normalized = segment.trim().toLowerCase();
		return normalized.startsWith(".") || GENERATED_TREE_SEGMENTS.has(normalized);
	}

	async toolExec(args: Record<string, unknown>): Promise<unknown> {
		const settings = this.context.getSettings();
		if (!this.context.activeRuntimeProfile.capabilities.supportsExecTool) {
			throw new Error(`exec tool is not supported on runtime profile: ${this.context.activeRuntimeProfile.id}`);
		}
		if (!settings.agentRuntime.enableExecTool) {
			throw new Error("exec tool is disabled. Enable it in settings first.");
		}
		const command = this.context.getRequiredStringArg(args, "command");
		const rawArgs = args["args"];
		const cmdArgs = Array.isArray(rawArgs)
			? rawArgs.map((item) => String(item))
			: [];
		const redirectedDelete = await this.tryExecuteVaultDeleteBuiltin(command, cmdArgs);
		if (redirectedDelete) {
			return redirectedDelete;
		}
		const cwd = this.context.getStringArg(args, "cwd") || undefined;

		const result = await this.context.commandExecService.exec(command, cmdArgs, { cwd, agentMode: this.context.activeAgentMode });
		return {
			exitCode: result.exitCode,
			stdout: result.stdout,
			stderr: result.stderr,
			truncated: result.truncated,
			timedOut: result.timedOut,
		};
	}

	private async tryExecuteVaultDeleteBuiltin(command: string, args: string[]): Promise<ExecVaultDeleteRedirect | null> {
		const normalizedCommand = command.trim().toLowerCase();
		if (!["rmdir", "rd", "rm", "del", "erase"].includes(normalizedCommand)) {
			return null;
		}
		const targetArg = args.find((item) => {
			const normalized = item.trim();
			return normalized.length > 0 && !normalized.startsWith("/") && !normalized.startsWith("-");
		});
		if (!targetArg) {
			return null;
		}
		const normalizedTarget = normalizePath(targetArg.replace(/\\/g, "/"));
		if (!normalizedTarget || path.isAbsolute(normalizedTarget)) {
			return null;
		}
		const existing = this.context.vault.getAbstractFileByPath(normalizedTarget);
		if (!(existing instanceof TFile) && !(existing instanceof TFolder)) {
			return null;
		}
		const activeSoulId = this.context.getSettings().activeSoulId;
		if (!activeSoulId) {
			return null;
		}
		await this.toolDelete({ path: normalizedTarget }, activeSoulId);
		return {
			routedToDelete: true,
			path: normalizedTarget,
			deletedType: existing instanceof TFolder ? "folder" : "file",
		};
	}
}
