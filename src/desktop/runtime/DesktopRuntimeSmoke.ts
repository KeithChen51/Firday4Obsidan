import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { AgentExecutionContext } from "../../core/agent-kernel/AgentExecutionContext";
import type { AgentTurnInput, AgentTurnResult, RuntimeProgressEvent } from "../../core/agent-kernel/contracts";
import { FridayPiRuntime } from "../../core/agent-kernel/pi/FridayPiRuntime";
import type {
	FridayPiSessionEvent,
	FridayPiSessionHostPort,
	FridayPiSessionListener,
	FridayPiSessionPort,
	FridayPiSessionUnsubscribe,
} from "../../core/agent-kernel/pi/FridayPiRuntimePorts";
import type { ArtifactHostPort, DesktopArtifactManifest } from "../contracts/ArtifactHostPort";
import type { DesktopHostAdapter, DesktopPermissionMode } from "../contracts/DesktopHostAdapter";
import type { ProjectContextItem, ProjectFileTreeEntry, ProjectLibraryHostPort } from "../contracts/ProjectLibraryHostPort";
import type { DesktopConversationRecord, DesktopTurnRecord } from "../contracts/RuntimeStateHostPort";
import type { ComposerSkillReference, DesktopSkillScope, DesktopSkillSummary, SkillHostPort } from "../contracts/SkillHostPort";
import type { DesktopTraceEvent } from "../contracts/TraceHostPort";
import { DesktopPermissionHost } from "../host/node/DesktopPermissionHost";
import { DesktopProjectHost } from "../host/node/DesktopProjectHost";
import { DesktopToolExecutionHost } from "../host/node/DesktopToolExecutionHost";
import { DesktopTraceHost } from "../host/node/DesktopTraceHost";
import { NodeFileSystemHost } from "../host/node/NodeFileSystemHost";
import { DesktopRuntimeStateStore } from "../state/DesktopRuntimeStateStore";
import { DesktopFridayPiRuntimeHostAdapter } from "./DesktopFridayPiRuntimeHostAdapter";

export interface DesktopRuntimeSmokeOptions {
	projectRoot?: string;
	prompt?: string;
	sessionHost?: FridayPiSessionHostPort;
	permissionMode?: DesktopPermissionMode;
	terminalEventTimeoutMs?: number;
}

export interface DesktopRuntimeSmokeEvidence {
	projectRoot: string;
	projectId: string;
	conversationId: string;
	turnId: string;
	prompt: string;
	result: AgentTurnResult;
	progress: RuntimeProgressEvent[];
	traceEvents: DesktopTraceEvent[];
	conversationRecord: DesktopConversationRecord;
	persistedTurns: DesktopTurnRecord[];
	disposeCount?: number;
}

export interface ScriptedDesktopPiSessionHostOptions {
	assistantText?: string;
	toolName?: string;
	toolTargetPath?: string;
	toolResultSummary?: string;
}

export interface ScriptedDesktopPiSessionHostState {
	createSessionCount: number;
	promptTexts: string[];
	disposeCount: number;
}

export interface ScriptedDesktopPiSessionHost {
	host: FridayPiSessionHostPort;
	state: ScriptedDesktopPiSessionHostState;
}

export function createScriptedDesktopPiSessionHost(
	options: ScriptedDesktopPiSessionHostOptions = {},
): ScriptedDesktopPiSessionHost {
	const state: ScriptedDesktopPiSessionHostState = {
		createSessionCount: 0,
		promptTexts: [],
		disposeCount: 0,
	};
	const assistantText = options.assistantText ?? "Desktop PI runtime smoke completed.";
	const toolName = options.toolName ?? "read_file";
	const toolTargetPath = options.toolTargetPath ?? "README.md";
	const toolResultSummary = options.toolResultSummary ?? "Read README.md through desktop host.";

	return {
		state,
		host: {
			createSession() {
				state.createSessionCount += 1;
				return new ScriptedDesktopPiSession({
					state,
					assistantText,
					toolName,
					toolTargetPath,
					toolResultSummary,
				});
			},
		},
	};
}

export async function runDesktopPiRuntimeSmoke(
	options: DesktopRuntimeSmokeOptions = {},
): Promise<DesktopRuntimeSmokeEvidence> {
	const projectRoot = path.resolve(options.projectRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), "friday-desktop-pi-")));
	const permissionMode = options.permissionMode ?? "standard";
	const projectHost = new DesktopProjectHost();
	const projectSession = await projectHost.initializeProject(projectRoot, {
		name: "FRIDAY Desktop PI Runtime Smoke",
		defaultPermissionMode: permissionMode,
	});
	const projectId = projectSession.project.id;
	const runtimeState = new DesktopRuntimeStateStore(projectRoot);
	const trace = new DesktopTraceHost(projectRoot);
	const permissions = new DesktopPermissionHost({ traceHost: trace, defaultMode: permissionMode });
	const tools = new DesktopToolExecutionHost({
		traceHost: trace,
		permissionHost: permissions,
		executor: async (invocation) => ({
			invocationId: invocation.id,
			toolName: invocation.toolName,
			input: invocation.input,
		}),
	});
	const desktopHost: DesktopHostAdapter = {
		project: projectHost,
		fileSystem: new NodeFileSystemHost(),
		runtimeState,
		permissions,
		trace,
		tools,
		artifacts: createNoopArtifactHost(),
		library: createNoopProjectLibraryHost(),
		skills: createNoopSkillHost(),
	};
	const scripted = options.sessionHost ? undefined : createScriptedDesktopPiSessionHost();
	const sessionHost = options.sessionHost ?? scripted?.host;
	if (!sessionHost) {
		throw new Error("Desktop runtime smoke requires a PI session host.");
	}

	const conversationId = "conversation-desktop-pi-smoke";
	const turnId = "turn-desktop-pi-smoke";
	const traceId = "trace-desktop-pi-smoke";
	const prompt = options.prompt ?? "run desktop PI runtime smoke";
	const progress: RuntimeProgressEvent[] = [];
	const input: AgentTurnInput = {
		turnId,
		traceId,
		conversationId,
		agentId: "agent-desktop-pi-smoke",
		conversation: [],
		userPrompt: prompt,
		mode: "ask",
		metadata: {
			projectId,
			projectRoot,
			permissionMode,
		},
		onProgress(event) {
			progress.push(event);
		},
	};
	const context = new AgentExecutionContext({
		turnId,
		traceId,
		conversationId,
		agentId: input.agentId,
		mode: input.mode,
		metadata: input.metadata,
	});
	const runtime = new FridayPiRuntime(
		new DesktopFridayPiRuntimeHostAdapter({
			desktopHost,
			sessionHost,
			projectId,
			projectRoot,
			permissionMode,
		}),
		undefined,
		{
			terminalEventTimeoutMs: options.terminalEventTimeoutMs ?? 2_000,
			cancelledPromptGraceMs: 0,
		},
	);

	const result = await runtime.execute(input, context);
	const traceEvents = await trace.queryTraceEvents({ projectId, conversationId, turnId });
	const conversationRecord = await readJson<DesktopConversationRecord>(
		path.join(projectRoot, "FRIDAY", "conversations", conversationId, "conversation.json"),
	);
	const persistedTurns = await readJsonl<DesktopTurnRecord>(
		path.join(projectRoot, "FRIDAY", "conversations", conversationId, "turns.jsonl"),
	);

	return {
		projectRoot,
		projectId,
		conversationId,
		turnId,
		prompt,
		result,
		progress,
		traceEvents,
		conversationRecord,
		persistedTurns,
		disposeCount: scripted?.state.disposeCount,
	};
}

interface ScriptedDesktopPiSessionInput extends Required<ScriptedDesktopPiSessionHostOptions> {
	state: ScriptedDesktopPiSessionHostState;
}

class ScriptedDesktopPiSession implements FridayPiSessionPort {
	private readonly listeners = new Set<FridayPiSessionListener>();

	constructor(private readonly input: ScriptedDesktopPiSessionInput) {}

	subscribe(listener: FridayPiSessionListener): FridayPiSessionUnsubscribe {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async prompt(text: string): Promise<void> {
		this.input.state.promptTexts.push(text);
		this.emit({ type: "text_delta", text: "Desktop PI " });
		this.emit({
			type: "tool_call",
			runId: "desktop-pi-tool-1",
			step: 1,
			tool: this.input.toolName,
			scope: "vault",
			targetPath: this.input.toolTargetPath,
			summary: `Read ${this.input.toolTargetPath}.`,
		});
		this.emit({
			type: "tool_result",
			runId: "desktop-pi-tool-1",
			step: 1,
			tool: this.input.toolName,
			scope: "vault",
			targetPath: this.input.toolTargetPath,
			status: "ok",
			ok: true,
			summary: this.input.toolResultSummary,
		});
		this.emit({ type: "text_final", text: this.input.assistantText });
		this.emit({ type: "done", summary: "Desktop PI session finished." });
	}

	dispose(): void {
		this.input.state.disposeCount += 1;
		this.listeners.clear();
	}

	private emit(event: FridayPiSessionEvent): void {
		for (const listener of [...this.listeners]) {
			listener(event);
		}
	}
}

function createNoopArtifactHost(): ArtifactHostPort {
	const missing = async (): Promise<never> => {
		throw new Error("Artifact host is not part of the desktop PI runtime smoke.");
	};
	return {
		createArtifact: missing,
		listArtifacts: async () => [],
		openArtifact: missing,
		updateArtifactManifest: async () => {},
		writeArtifactVersionFile: missing,
		readArtifactVersionFile: missing,
		listArtifactVersionFiles: async () => [],
		createProjectFileArtifactWrapper: missing,
		openProjectFileArtifactWrapper: missing,
	};
}

function createNoopProjectLibraryHost(): ProjectLibraryHostPort {
	const items = new Map<string, ProjectContextItem>();
	return {
		async registerContextItem(_context, item) {
			items.set(item.id, item);
			return item;
		},
		async listContextItems() {
			return [...items.values()];
		},
		async updateContextItem(_context, item) {
			items.set(item.id, item);
			return item;
		},
		async readProjectFileTree(): Promise<ProjectFileTreeEntry[]> {
			return [];
		},
	};
}

function createNoopSkillHost(): SkillHostPort {
	return {
		async listProjectSkills() {
			return [];
		},
		async listGlobalSkills() {
			return [];
		},
		async setSkillEnabled(_projectId: string, skillId: string, enabled: boolean): Promise<DesktopSkillSummary> {
			return {
				id: skillId,
				name: skillId,
				scope: "project",
				enabled,
			};
		},
		async setScopedSkillEnabled(
			_projectId: string,
			skillId: string,
			scope: DesktopSkillScope,
			enabled: boolean,
		): Promise<DesktopSkillSummary> {
			return {
				id: skillId,
				name: skillId,
				scope,
				enabled,
			};
		},
		async buildComposerSkillReference(
			_projectId: string,
			skillId: string,
			scope: DesktopSkillScope,
		): Promise<ComposerSkillReference> {
			return {
				skillId,
				scope,
				label: skillId,
				referenceText: `@skill:${skillId}`,
			};
		},
	};
}

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function readJsonl<T>(filePath: string): Promise<T[]> {
	const raw = await fs.readFile(filePath, "utf8");
	return raw
		.split(/\r?\n/u)
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as T);
}
