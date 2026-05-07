import type { Vault } from "obsidian";
import type { AgentMode } from "../../core/tools/ToolRegistry";
import type { ToolApprovalScope } from "../ToolApprovalService";
import type { FridaySettings } from "../../types/settings";
import type { WorkspaceAccessService } from "../WorkspaceAccessService";
import type { SkillCommandService } from "../SkillCommandService";
import type { ProjectBoundaryService } from "../ProjectBoundaryService";
import type { MemoryStoreV1 } from "../../core/memory/MemoryStoreV1";
import type { WikiCompileCapability } from "../../platform/capability/WikiCompileCapability";
import type { InlineEditService, EditOperation } from "../InlineEditService";
import type { CommandExecService } from "../CommandExecService";
import type { RuntimeProfile } from "../../platform/runtime/RuntimeProfile";

interface SimpleDiffSummary {
	beforeLines: number;
	afterLines: number;
	addedLines: number;
	removedLines: number;
	beforePreview: string;
	afterPreview: string;
}

interface ObsidianRuntimeToolHost {
	vault: Vault;
	workspaceAccessService: WorkspaceAccessService;
	skillCommandService: SkillCommandService;
	projectBoundaryService: ProjectBoundaryService;
	memoryStore: MemoryStoreV1;
	wikiCompileCapability: WikiCompileCapability;
	inlineEditService: InlineEditService;
	commandExecService: CommandExecService;
	activeRuntimeProfile: RuntimeProfile;
	activeAgentMode: AgentMode;
	getSettings: () => FridaySettings;
	getStringArg(args: Record<string, unknown>, key: string): string;
	getRequiredStringArg(args: Record<string, unknown>, key: string): string;
	getPositiveIntArg(args: Record<string, unknown>, key: string, fallback: number): number;
	getBooleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean;
	resolveScope(pathValue: string): ToolApprovalScope;
	resolveDefaultVaultSearchPath(rawPath: string | undefined): string;
	resolveVaultFilePath(rawPath: string): string;
	resolveExistingVaultFilePath(rawPath: string): string | null;
	buildVaultScopeDeniedError(targetPath: string, action: "read" | "write"): string;
	listVault(targetPath: string, recursive: boolean, maxEntries: number): string[];
	listExternal(rootPath: string, recursive: boolean, maxEntries: number): Promise<string[]>;
	collectExternalFiles(rootPath: string, maxFiles: number): Promise<string[]>;
	appendGrepMatches(
		matches: Array<{ path: string; line: number; text: string }>,
		filePath: string,
		text: string,
		regExp: RegExp,
		maxMatches: number,
	): void;
	buildSafeRegex(pattern: string, flags: string): RegExp;
	escapeRegExp(value: string): string;
	globToRegex(pattern: string): RegExp;
	isPathWithin(filePath: string, folderPath: string): boolean;
	truncateText(text: string, maxChars: number): string;
	assertAgentWritableVaultPath(targetPath: string): void;
	parseEditOperations(args: Record<string, unknown>): EditOperation[];
	recordEditPlan(input: {
		agentId: string;
		toolCallId?: string;
		tool: string;
		path: string;
		before: string;
		after: string;
		changeType: "create" | "update" | "delete";
	}): Promise<string>;
	maybeAutoApplyEditPlan(planId: string): Promise<boolean>;
	makeSimpleDiffSummary(beforeContent: string, afterContent: string): SimpleDiffSummary;
}

export class ObsidianToolContext {
	constructor(private readonly runtime: unknown) {}

	get vault(): Vault {
		return this.host.vault;
	}

	get workspaceAccessService(): WorkspaceAccessService {
		return this.host.workspaceAccessService;
	}

	get skillCommandService(): SkillCommandService {
		return this.host.skillCommandService;
	}

	get projectBoundaryService(): ProjectBoundaryService {
		return this.host.projectBoundaryService;
	}

	get memoryStore(): MemoryStoreV1 {
		return this.host.memoryStore;
	}

	get wikiCompileCapability(): WikiCompileCapability {
		return this.host.wikiCompileCapability;
	}

	get inlineEditService(): InlineEditService {
		return this.host.inlineEditService;
	}

	get commandExecService(): CommandExecService {
		return this.host.commandExecService;
	}

	get activeRuntimeProfile(): RuntimeProfile {
		return this.host.activeRuntimeProfile;
	}

	get activeAgentMode(): AgentMode {
		return this.host.activeAgentMode;
	}

	getSettings(): FridaySettings {
		return this.host.getSettings();
	}

	getStringArg(args: Record<string, unknown>, key: string): string {
		return this.host.getStringArg(args, key);
	}

	getRequiredStringArg(args: Record<string, unknown>, key: string): string {
		return this.host.getRequiredStringArg(args, key);
	}

	getPositiveIntArg(args: Record<string, unknown>, key: string, fallback: number): number {
		return this.host.getPositiveIntArg(args, key, fallback);
	}

	getBooleanArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
		return this.host.getBooleanArg(args, key, fallback);
	}

	resolveScope(pathValue: string): ToolApprovalScope {
		return this.host.resolveScope(pathValue);
	}

	resolveDefaultVaultSearchPath(rawPath: string | undefined): string {
		return this.host.resolveDefaultVaultSearchPath(rawPath);
	}

	resolveVaultFilePath(rawPath: string): string {
		return this.host.resolveVaultFilePath(rawPath);
	}

	resolveExistingVaultFilePath(rawPath: string): string | null {
		return this.host.resolveExistingVaultFilePath(rawPath);
	}

	buildVaultScopeDeniedError(targetPath: string, action: "read" | "write"): string {
		return this.host.buildVaultScopeDeniedError(targetPath, action);
	}

	listVault(targetPath: string, recursive: boolean, maxEntries: number): string[] {
		return this.host.listVault(targetPath, recursive, maxEntries);
	}

	listExternal(rootPath: string, recursive: boolean, maxEntries: number): Promise<string[]> {
		return this.host.listExternal(rootPath, recursive, maxEntries);
	}

	collectExternalFiles(rootPath: string, maxFiles: number): Promise<string[]> {
		return this.host.collectExternalFiles(rootPath, maxFiles);
	}

	appendGrepMatches(
		matches: Array<{ path: string; line: number; text: string }>,
		filePath: string,
		text: string,
		regExp: RegExp,
		maxMatches: number,
	): void {
		this.host.appendGrepMatches(matches, filePath, text, regExp, maxMatches);
	}

	buildSafeRegex(pattern: string, flags: string): RegExp {
		return this.host.buildSafeRegex(pattern, flags);
	}

	escapeRegExp(value: string): string {
		return this.host.escapeRegExp(value);
	}

	globToRegex(pattern: string): RegExp {
		return this.host.globToRegex(pattern);
	}

	isPathWithin(filePath: string, folderPath: string): boolean {
		return this.host.isPathWithin(filePath, folderPath);
	}

	truncateText(text: string, maxChars: number): string {
		return this.host.truncateText(text, maxChars);
	}

	assertAgentWritableVaultPath(targetPath: string): void {
		this.host.assertAgentWritableVaultPath(targetPath);
	}

	parseEditOperations(args: Record<string, unknown>): EditOperation[] {
		return this.host.parseEditOperations(args);
	}

	recordEditPlan(input: {
		agentId: string;
		toolCallId?: string;
		tool: string;
		path: string;
		before: string;
		after: string;
		changeType: "create" | "update" | "delete";
	}): Promise<string> {
		return this.host.recordEditPlan(input);
	}

	maybeAutoApplyEditPlan(planId: string): Promise<boolean> {
		return this.host.maybeAutoApplyEditPlan(planId);
	}

	makeSimpleDiffSummary(beforeContent: string, afterContent: string): SimpleDiffSummary {
		return this.host.makeSimpleDiffSummary(beforeContent, afterContent);
	}

	private get host(): ObsidianRuntimeToolHost {
		return this.runtime as ObsidianRuntimeToolHost;
	}
}
