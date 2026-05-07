import { promises as fsPromises } from "fs";
import path from "path";
import { normalizePath, TFile, TFolder } from "obsidian";
import type { AgentActionType } from "../../types/action";
import type { MemoryWriteInput } from "../../core/memory/MemoryTypes";
import { resolveAgentWritableVaultPath } from "../../utils/projectWorkspacePolicy";
import type { ObsidianToolContext } from "./ObsidianToolContext";

const MAX_TOOL_RESULT_ITEM = 80;
const DEFAULT_MAX_LIST = 120;
const DEFAULT_MAX_READ_CHARS = 10000;
const DEFAULT_MAX_GREP_MATCHES = 40;

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
