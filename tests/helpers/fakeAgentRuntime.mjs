/* eslint-env node */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

import { createScriptedModelDriver } from "./scriptedModelDriver.mjs";

const helperDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(helperDir, "../..");
const fakeVaultPath = path.join(helperDir, "fakeVault.mjs");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");
const kernelPath = path.join(projectRoot, "src/core/agent-kernel/AgentKernel.ts");
const turnReplayReaderPath = path.join(projectRoot, "src/core/runtime/TurnReplayReader.ts");
const mutationPlanStorePath = path.join(projectRoot, "src/core/mutations/MutationPlanStore.ts");
const agentTaskStorePath = path.join(projectRoot, "src/core/tasks/AgentTaskStore.ts");

async function loadHarnessModules() {
	const jiti = createJiti(import.meta.url, {
		alias: {
			obsidian: fakeVaultPath,
		},
	});
	const [runtimeModule, kernelModule, fakeVaultModule, replayModule, mutationPlanStoreModule, agentTaskStoreModule] = await Promise.all([
		jiti.import(runtimePath),
		jiti.import(kernelPath),
		jiti.import(fakeVaultPath),
		jiti.import(turnReplayReaderPath),
		jiti.import(mutationPlanStorePath),
		jiti.import(agentTaskStorePath),
	]);
	return {
		AgentRuntimeService: runtimeModule.AgentRuntimeService,
		AgentKernel: kernelModule.AgentKernel,
		AgentRuntimeFacade: kernelModule.AgentRuntimeFacade,
		TurnReplayReader: replayModule.TurnReplayReader,
		MutationPlanStore: mutationPlanStoreModule.MutationPlanStore,
		AgentTaskStore: agentTaskStoreModule.AgentTaskStore,
		createFakeVault: fakeVaultModule.createFakeVault,
		TFile: fakeVaultModule.TFile,
		TFolder: fakeVaultModule.TFolder,
		normalizePath: fakeVaultModule.normalizePath,
	};
}

function createBaseSettings(overrides = {}) {
	return mergeDeep(
		{
			activeSoulId: "agent",
			agentRuntime: {
				requireWriteConfirmation: true,
				toolPermissionMode: "standard",
				fileMutationMode: "review",
				disabledTools: [],
				disabledSkills: [],
				enableExecTool: false,
				execTimeout: 30000,
				execWorkingDir: "vault",
				execCustomCwd: "",
				vaultFocusPaths: [],
				externalReadOnlyPaths: [],
				externalSkillPaths: [],
				excludedTags: [],
				toolRuntimeEnabled: true,
				maxToolIterations: 6,
				blockedCommands: [],
				toolCallingMode: "native",
				projectToolPolicyRules: {},
			},
		},
		overrides,
	);
}

function mergeDeep(base, overrides) {
	const output = { ...base };
	for (const [key, value] of Object.entries(overrides ?? {})) {
		if (
			value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			base[key] &&
			typeof base[key] === "object" &&
			!Array.isArray(base[key])
		) {
			output[key] = mergeDeep(base[key], value);
			continue;
		}
		output[key] = value;
	}
	return output;
}

export async function runAgentRuntimeScenario(scenario) {
	const modules = await loadHarnessModules();
	const settings = createBaseSettings(scenario.settings);
	const vault = modules.createFakeVault(scenario.files ?? {});
	const modelDriver = createScriptedModelDriver(scenario.modelSteps ?? []);
	const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "friday-agent-harness-"));
	const runtimeStateStore = createRuntimeStateStore(runtimeRoot);
	const approvalService = createFakeApprovalService(scenario.approvals ?? []);
	let workbenchStateStore = createFakeWorkbenchStateStore();
	const projectBoundaryService = createFakeProjectBoundaryService({
		projectRoot: scenario.projectRoot ?? "",
		normalizePath: modules.normalizePath,
	});
	const workspaceAccessService = createFakeWorkspaceAccessService({
		denyReadPaths: scenario.denyReadPaths ?? [],
		denyWritePaths: scenario.denyWritePaths ?? [],
		normalizePath: modules.normalizePath,
	});
	const actionService = createFakeActionService(vault, modules, {
		failActionPaths: scenario.failActionPaths ?? [],
	});
	const progress = [];
	const createRuntime = () => {
		const nextRuntime = new modules.AgentRuntimeService(
			vault,
			modelDriver,
			createFakeSoulStore(),
			runtimeStateStore,
			workspaceAccessService,
			actionService,
			approvalService,
			createFakeCommandExecService(),
			createFakeInlineEditService(),
			createFakeSkillCommandService(),
			projectBoundaryService,
			workbenchStateStore,
			async () => ({
				projectId: "test-project",
				projectRoot: scenario.projectRoot ?? "",
				requested: 0,
				processed: 0,
				succeeded: 0,
				failed: 0,
				rawPaths: [],
				updatedDocs: [],
				updatedIndex: "",
				updatedLog: "",
			}),
			() => settings,
		);
		nextRuntime.memoryStore = createFakeMemoryStore();
		return nextRuntime;
	};
	let runtime = createRuntime();
	let runtimeFacade = createRuntimeFacade(modules, runtime);

	let runtimeResult;
	let failure = null;
	const taskActionResults = [];
	let cancelOnProgressTriggered = false;
	const handleProgress = (event) => {
		progress.push(event);
		if (
			scenario.cancelOnProgress &&
			!cancelOnProgressTriggered &&
			event.phase === scenario.cancelOnProgress.phase &&
			(scenario.cancelOnProgress.step == null || scenario.cancelOnProgress.step === event.step)
		) {
			cancelOnProgressTriggered = true;
			const taskId = event.taskId;
			if (taskId) {
				void runtime.cancelAgentTask(taskId, scenario.cancelOnProgress.reason ?? "User cancelled task.");
			}
		}
	};
	try {
		runtimeResult = await runtimeFacade.runTurn({
			agentId: scenario.agentId ?? "agent",
			conversation: scenario.conversation ?? [],
			userPrompt: scenario.userPrompt ?? scenario.name ?? "Run scripted Agent scenario.",
			modelOverride: scenario.modelOverride ?? "scripted-model",
			depth: scenario.depth ?? 0,
			currentFilePath: scenario.currentFilePath,
			extraSystemContext: scenario.extraSystemContext,
			mentionContext: scenario.mentionContext,
			allowedTools: scenario.allowedTools,
			agentMode: scenario.agentMode ?? "ask",
			onProgress: handleProgress,
		});
	} catch (error) {
		failure = {
			message: error instanceof Error ? error.message : String(error ?? ""),
		};
		runtimeResult = {
			assistantText: failure.message,
			traces: [],
			rawFinalReply: "",
			parseError: failure.message,
		};
	}
	if (!failure && (runtimeResult.status === "failed" || runtimeResult.status === "cancelled")) {
		failure = {
			message: runtimeResult.failure?.technicalMessage ??
				runtimeResult.failure?.userMessage ??
				runtimeResult.parseError ??
				runtimeResult.assistantText ??
				"Agent turn failed.",
		};
	}

	for (const action of scenario.afterTurnActions ?? []) {
		if (action && typeof action === "object" && action.type === "modifyFile") {
			const targetPath = modules.normalizePath(action.path);
			const existing = vault.getAbstractFileByPath(targetPath);
			if (existing instanceof modules.TFile) {
				await vault.modify(existing, action.content ?? "");
			} else {
				await vault.create(targetPath, action.content ?? "");
			}
			continue;
		}
		if (action === "reloadPendingMutations") {
			workbenchStateStore = createFakeWorkbenchStateStore();
			runtime = createRuntime();
			runtimeFacade = createRuntimeFacade(modules, runtime);
			await runtime.restorePendingMutationPlans();
			continue;
		}
		if (action === "retryFirstTask") {
			const taskStore = new modules.AgentTaskStore({
				storePath: runtimeStateStore.getAgentTaskStorePath(),
			});
			const firstTask = (await taskStore.list())[0];
			if (!firstTask) {
				throw new Error("afterTurnAction retryFirstTask requested an agent task, but none were recorded.");
			}
			const result = await runtime.retryAgentTask(firstTask.id, { onProgress: handleProgress });
			taskActionResults.push({
				type: "retryFirstTask",
				result: normalizeRuntimeActionResult(result, modelDriver),
			});
			continue;
		}
		if (action && typeof action === "object" && action.type === "continueFirstTask") {
			const taskStore = new modules.AgentTaskStore({
				storePath: runtimeStateStore.getAgentTaskStorePath(),
			});
			const tasks = await taskStore.list();
			const firstTask = tasks.find((task) => task.status === "waiting_for_user") ?? tasks[0];
			if (!firstTask) {
				throw new Error("afterTurnAction continueFirstTask requested an agent task, but none were recorded.");
			}
			const result = await runtime.continueAgentTask(firstTask.id, {
				userPrompt: action.userPrompt ?? "Continue.",
				onProgress: handleProgress,
			});
			taskActionResults.push({
				type: "continueFirstTask",
				result: normalizeRuntimeActionResult(result, modelDriver),
			});
			continue;
		}
		const editPlans = workbenchStateStore.getEditPlans();
		const firstPlan = editPlans[0];
		if (!firstPlan) {
			throw new Error(`afterTurnAction ${action} requested an edit plan, but none were recorded.`);
		}
		if (action === "acceptFirstEditPlan") {
			await runtime.acceptEditPlan(firstPlan.id);
			continue;
		}
		if (action === "rejectFirstEditPlan") {
			await runtime.rejectEditPlan(firstPlan.id);
			continue;
		}
		throw new Error(`Unknown afterTurnAction: ${action}`);
	}

	const pendingMutations = [
		...(runtimeResult.pendingMutations ?? []).map(normalizePendingMutation),
		...extractPendingMutationsFromEditPlans(workbenchStateStore.getEditPlans()),
	];
	const mutationPlanStore = new modules.MutationPlanStore({
		storePath: runtimeStateStore.getMutationPlanStorePath(),
	});
	const storedMutations = (await mutationPlanStore.list()).map(normalizeStoredMutation);
	const agentTaskStore = new modules.AgentTaskStore({
		storePath: runtimeStateStore.getAgentTaskStorePath(),
	});
	const tasks = (await agentTaskStore.list()).map(normalizeAgentTask);
	const task = tasks.find((item) => item.turnId === runtimeResult.turnId) ??
		(runtimeResult.task ? normalizeAgentTask(runtimeResult.task) : undefined) ??
		tasks[0];
	let reloadedPendingMutations = [];
	if (scenario.reloadPendingMutations) {
		workbenchStateStore = createFakeWorkbenchStateStore();
		runtime = createRuntime();
		await runtime.restorePendingMutationPlans();
		reloadedPendingMutations = extractPendingMutationsFromEditPlans(workbenchStateStore.getEditPlans());
	}
	const events = normalizeEvents({
		progress,
		runtimeResult,
		pendingMutations,
		failure,
	});
	const turnReplay = await readTurnReplay({
		TurnReplayReader: modules.TurnReplayReader,
		runtimeStateStore,
		conversationId: scenario.agentId ?? "agent",
		turnId: runtimeResult.turnId,
	});

	return {
		status: failure ? "failed" : "completed",
		assistantText: runtimeResult.assistantText ?? "",
		traces: runtimeResult.traces ?? [],
		events,
		turnEvents: turnReplay.events,
		turnEventValidation: turnReplay.validation,
		turnEventSummary: turnReplay.summary,
		pendingMutations,
		storedMutations,
		reloadedPendingMutations,
		task,
		tasks,
		taskActionResults,
		files: vault.snapshot(),
		modelCalls: { ...modelDriver.calls },
		modelRequests: modelDriver.requests.map(normalizeModelRequest),
		parseError: runtimeResult.parseError,
		failure,
		rawFinalReply: runtimeResult.rawFinalReply ?? "",
		turnId: runtimeResult.turnId,
		traceId: runtimeResult.traceId,
		stepTraces: runtimeResult.stepTraces ?? [],
		approvalRequests: approvalService.requests,
		agentMode: scenario.agentMode ?? "ask",
	};
}

function createRuntimeFacade(modules, runtime) {
	return new modules.AgentRuntimeFacade(
		new modules.AgentKernel(runtime.createAgentLoopController()),
	);
}

function normalizeModelRequest(request) {
	const messages = Array.isArray(request.messages) ? request.messages : [];
	const fullText = messages.map((message) => String(message.content ?? "")).join("\n");
	return {
		channel: request.channel,
		tools: Array.isArray(request.tools)
			? request.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}))
			: [],
		options: { ...request.options },
		messageCount: messages.length,
		approximateTokens: approximateTokenCount(fullText),
		sanitizedText: sanitizeModelRequestText(fullText),
		toolBoundaryViolations: findToolBoundaryViolations(messages),
	};
}

function approximateTokenCount(text) {
	const value = String(text ?? "");
	if (!value) {
		return 0;
	}
	let cjkChars = 0;
	let otherChars = 0;
	for (const char of Array.from(value)) {
		const codePoint = char.codePointAt(0) ?? 0;
		if (
			(codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
			(codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
			(codePoint >= 0x20000 && codePoint <= 0x2a6df) ||
			(codePoint >= 0x2a700 && codePoint <= 0x2b73f) ||
			(codePoint >= 0x2b740 && codePoint <= 0x2b81f) ||
			(codePoint >= 0x2b820 && codePoint <= 0x2ceaf) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff)
		) {
			cjkChars += 1;
		} else {
			otherChars += 1;
		}
	}
	return Math.ceil(otherChars / 4) + Math.ceil(cjkChars / 1.6);
}

function sanitizeModelRequestText(text) {
	const redacted = String(text ?? "")
		.replace(/(authorization|api[_-]?key|token|secret)(\\?":\\?"?)[^\n,}\]]+/gi, "$1$2[REDACTED]")
		.replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_SECRET]");
	if (redacted.length <= 12000) {
		return redacted;
	}
	const head = redacted.slice(0, 6000);
	const tail = redacted.slice(-6000);
	return `${head}\n[...sanitized model request omitted ${redacted.length - 12000} chars...]\n${tail}`;
}

function findToolBoundaryViolations(messages) {
	const violations = [];
	const pending = new Set();
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message.role === "assistant") {
			if (pending.size > 0) {
				for (const toolCallId of pending) {
					violations.push({ reason: "dangling_tool_call", toolCallId, index });
				}
				pending.clear();
			}
			for (const toolCall of message.toolCalls ?? []) {
				if (toolCall.id) {
					pending.add(toolCall.id);
				}
			}
			continue;
		}
		if (message.role === "tool") {
			const toolCallId = message.toolCallId;
			if (!toolCallId || !pending.has(toolCallId)) {
				violations.push({ reason: "orphan_tool_result", toolCallId, index });
				continue;
			}
			pending.delete(toolCallId);
			continue;
		}
		if (pending.size > 0) {
			for (const toolCallId of pending) {
				violations.push({ reason: "dangling_tool_call", toolCallId, index });
			}
			pending.clear();
		}
	}
	for (const toolCallId of pending) {
		violations.push({ reason: "dangling_tool_call", toolCallId, index: messages.length });
	}
	return violations;
}

function createRuntimeStateStore(root) {
	const safePathSegment = (value) => {
		const segment = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
		return segment || "default";
	};
	return {
		getRuntimeRoot: () => path.join(root, "runtime"),
		getConversationRuntimeRoot: (conversationId) =>
			path.join(root, "runtime", "conversations", safePathSegment(conversationId)),
		getTurnEventLogPath: (conversationId, turnId) =>
			path.join(
				root,
				"runtime",
				"conversations",
				safePathSegment(conversationId),
				"turns",
				`${safePathSegment(turnId)}.jsonl`,
			),
		getMutationPlanStorePath: () => path.join(root, "runtime", "mutation-plans.json"),
		getAgentTaskStorePath: () => path.join(root, "runtime", "agent-tasks.json"),
		getApprovalStorePath: (scopeKey = "global") => path.join(root, "approvals", `${scopeKey}.json`),
		getSoulSnapshotsRoot: (soulId) => path.join(root, "snapshots", soulId),
		ensureBaseLayout: async () => {
			await fs.mkdir(path.join(root, "runtime"), { recursive: true });
			await fs.mkdir(path.join(root, "approvals"), { recursive: true });
			await fs.mkdir(path.join(root, "snapshots"), { recursive: true });
		},
	};
}

async function readTurnReplay({ TurnReplayReader, runtimeStateStore, conversationId, turnId }) {
	const reader = new TurnReplayReader({
		resolveTurnPath: ({ conversationId: refConversationId, turnId: refTurnId }) =>
			runtimeStateStore.getTurnEventLogPath(refConversationId, refTurnId),
	});
	const resolvedTurnId = turnId ?? await findOnlyTurnEventLogId(runtimeStateStore, conversationId);
	if (!resolvedTurnId) {
		return {
			events: [],
			validation: { ok: false, errors: ["No turn event log was written."] },
			summary: reader.summarize([]),
		};
	}
	const events = await reader.readTurn({ conversationId, turnId: resolvedTurnId });
	return {
		events,
		validation: reader.validateOrder(events),
		summary: reader.summarize(events),
	};
}

async function findOnlyTurnEventLogId(runtimeStateStore, conversationId) {
	const turnsRoot = path.join(runtimeStateStore.getConversationRuntimeRoot(conversationId), "turns");
	try {
		const files = await fs.readdir(turnsRoot);
		const jsonlFiles = files.filter((file) => file.endsWith(".jsonl")).sort();
		return jsonlFiles.length > 0 ? jsonlFiles[jsonlFiles.length - 1].slice(0, -".jsonl".length) : "";
	} catch (error) {
		if (error && typeof error === "object" && error.code === "ENOENT") {
			return "";
		}
		throw error;
	}
}

function createFakeApprovalService(decisions) {
	const requests = [];
	let index = 0;
	return {
		requests,
		async requestApproval(request) {
			requests.push({ ...request });
			const decision = decisions[index] ?? "allow";
			index += 1;
			if (decision === "deny") {
				return {
					allowed: false,
					persisted: false,
					viaRule: false,
					reason: "User denied tool call.",
				};
			}
			return {
				allowed: true,
				persisted: decision === "allow_always",
				viaRule: false,
				reason: decision === "allow_always" ? "Saved allow rule." : "Allowed once.",
			};
		},
	};
}

function createFakeSoulStore() {
	return {
		async getSoul() {
			return {
				name: "Harness Agent",
				summary: "Scripted test agent.",
				description: "Runs deterministic Agent Runtime Harness scenarios.",
				rolePrompt: "Complete the scripted vault task.",
				tonePreset: "calm",
				tonePrompt: "",
				behaviorRules: [],
				antiPatterns: [],
			};
		},
	};
}

function createFakeProjectBoundaryService({ projectRoot, normalizePath }) {
	const normalizedRoot = normalizePath(projectRoot ?? "");
	const activeProject = normalizedRoot
		? { id: "project", projectId: "project", slug: "project", name: "Project" }
		: null;
	return {
		getActiveProject: () => activeProject,
		getActiveProjectRoot: () => normalizedRoot,
		getProjectRoot: () => normalizedRoot,
		isWithinProject: (_project, targetPath) => {
			if (!normalizedRoot) {
				return true;
			}
			const normalizedTarget = normalizePath(targetPath);
			return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
		},
	};
}

function createFakeWorkspaceAccessService({ denyReadPaths, denyWritePaths, normalizePath }) {
	const deniesRead = denyReadPaths.map((item) => normalizePath(item));
	const deniesWrite = denyWritePaths.map((item) => normalizePath(item));
	const isDenied = (targetPath, denyList) => {
		const normalizedTarget = normalizePath(targetPath);
		return denyList.some((prefix) => normalizedTarget === prefix || normalizedTarget.startsWith(`${prefix}/`));
	};
	return {
		canReadVaultPath: (targetPath) => !isDenied(targetPath, deniesRead),
		canWriteVaultPath: (targetPath) => !isDenied(targetPath, deniesWrite),
		canReadExternalPath: () => false,
		canWriteExternalPath: () => false,
	};
}

function createFakeActionService(vault, { TFile, TFolder, normalizePath }, options = {}) {
	const failActionPaths = new Set((options.failActionPaths ?? []).map((item) => normalizePath(item)));
	return {
		async execute(action) {
			const targetPath = normalizePath(action.path);
			if (failActionPaths.has(targetPath)) {
				throw new Error(`Synthetic action failure: ${targetPath}`);
			}
			const existing = vault.getAbstractFileByPath(targetPath);
			if (action.type === "delete") {
				if (!(existing instanceof TFile) && !(existing instanceof TFolder)) {
					throw new Error(`Vault path does not exist: ${targetPath}`);
				}
				await vault.delete(existing);
				return;
			}
			if (existing instanceof TFolder) {
				throw new Error(`Target path is a folder: ${targetPath}`);
			}
			if (existing instanceof TFile) {
				await vault.modify(existing, action.content ?? "");
				return;
			}
			await vault.create(targetPath, action.content ?? "");
		},
	};
}

function createFakeInlineEditService() {
	return {
		applyEdits(originalContent, operations) {
			let result = originalContent;
			let appliedCount = 0;
			const failedReasons = [];
			for (const operation of operations) {
				const search = String(operation.search ?? "");
				const replace = String(operation.replace ?? "");
				if (!search || !result.includes(search)) {
					failedReasons.push(`No matching text found: ${search}`);
					continue;
				}
				result = result.replace(search, replace);
				appliedCount += 1;
			}
			return { result, appliedCount, failedReasons };
		},
		computeLineDiff(before, after) {
			if (before === after) {
				return [{ type: "equal", value: before }];
			}
			return [
				{ type: "remove", value: before },
				{ type: "add", value: after },
			];
		},
		formatDiffForModel(segments) {
			return segments.map((segment) => `${segment.type}:${segment.value}`).join("\n");
		},
	};
}

function createFakeWorkbenchStateStore() {
	const editPlans = [];
	return {
		recordEditPlan(record) {
			editPlans.unshift({
				...record,
				items: record.items.map((item) => ({ ...item })),
			});
		},
		getEditPlans() {
			return editPlans.map((record) => ({
				...record,
				items: record.items.map((item) => ({ ...item })),
			}));
		},
		replaceEditPlan(record) {
			const next = {
				...record,
				items: record.items.map((item) => ({ ...item })),
			};
			const existingIndex = editPlans.findIndex((item) => item.id === record.id);
			if (existingIndex >= 0) {
				editPlans.splice(existingIndex, 1, next);
				return;
			}
			editPlans.unshift(next);
		},
		clearEditPlans() {
			editPlans.splice(0, editPlans.length);
		},
	};
}

function createFakeCommandExecService() {
	return {
		async exec(command, args = []) {
			return {
				exitCode: 0,
				stdout: [command, ...args].join(" "),
				stderr: "",
				truncated: false,
				timedOut: false,
			};
		},
	};
}

function createFakeSkillCommandService() {
	return {
		async buildSkillSystemContext(command) {
			return {
				skill: {
					command,
					name: command,
					description: "Fake skill loaded by Agent Runtime Harness.",
				},
				systemContext: `[SkillInvocation]\n${command}`,
			};
		},
	};
}

function createFakeMemoryStore() {
	return {
		async readPromptContext() {
			return "";
		},
		resolvePath(scope) {
			return `memory/${scope}.md`;
		},
		async write(input) {
			return {
				ok: true,
				code: "written",
				scope: input.scope,
				path: `memory/${input.scope}.md`,
				summary: `Updated ${input.scope} memory; applies next turn.`,
				appliesOnNextTurn: true,
			};
		},
	};
}

function extractPendingMutationsFromEditPlans(editPlans) {
	return editPlans.flatMap((record) =>
		record.items
			.filter((item) => item.status === "pending")
			.map((item, index) => ({
				id: `${record.id}-${index}`,
				planId: record.id,
				operation: record.tool,
				targetPath: item.path,
				summary: `${record.tool} ${item.changeType} ${item.path}`,
				status: item.status,
				beforeHash: item.beforeHash,
				proposedHash: item.afterHash,
			})),
	);
}

function normalizeStoredMutation(plan) {
	return {
		id: plan.id,
		operation: plan.operation,
		targetPath: plan.targetPath,
		status: plan.status,
		taskId: plan.taskId,
		traceId: plan.traceId,
		turnId: plan.turnId,
		conversationId: plan.conversationId,
		toolCallId: plan.toolCallId,
		riskLevel: plan.riskLevel,
		summary: plan.summary,
	};
}

function normalizeAgentTask(task) {
	return {
		id: task.id,
		conversationId: task.conversationId,
		turnId: task.turnId,
		agentId: task.agentId,
		mode: task.mode,
		title: task.title,
		status: task.status,
		summary: task.summary,
		failureReason: task.failureReason,
		waitingForApproval: task.waitingForApproval ? { ...task.waitingForApproval } : undefined,
		waitingForUser: task.waitingForUser ? { ...task.waitingForUser } : undefined,
		pendingMutationCount: task.pendingMutationCount,
		changedFileCount: task.changedFileCount,
		availableActions: [...(task.availableActions ?? [])],
		retryOfTaskId: task.retryOfTaskId,
		continueFromTaskId: task.continueFromTaskId,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
	};
}

function normalizeRuntimeActionResult(result, modelDriver) {
	return {
		assistantText: result.assistantText ?? "",
		traces: result.traces ?? [],
		task: result.task ? normalizeAgentTask(result.task) : undefined,
		turnId: result.turnId,
		parseError: result.parseError,
		modelRequests: modelDriver.requests.map(normalizeModelRequest),
	};
}

function normalizePendingMutation(mutation) {
	return {
		id: mutation.id,
		operation: mutation.operation,
		targetPath: mutation.targetPath,
		summary: mutation.summary,
		status: mutation.status ?? "pending",
		...mutation,
	};
}

function normalizeEvents({ progress, runtimeResult, pendingMutations, failure }) {
	const events = [];
	for (const item of progress) {
		if (item.phase === "start") {
			events.push(makeEvent("turn_started", { message: item.message }));
		}
		if (item.phase === "context" && item.contextKey === "compact") {
			events.push(makeEvent("context_built", { message: item.message }));
		}
		if (item.phase === "model_request") {
			events.push(makeEvent("model_requested", { step: item.step, message: item.message }));
		}
		if (item.phase === "model_response") {
			events.push(makeEvent("model_completed", { step: item.step, message: item.message }));
		}
		if (item.phase === "tool_call") {
			events.push(makeEvent("tool_requested", {
				step: item.step,
				tool: item.tool,
				targetPath: item.targetPath,
				message: item.message,
			}));
		}
		if (item.phase === "tool_approval") {
			events.push(makeEvent("tool_approval_requested", {
				step: item.step,
				tool: item.tool,
				message: item.message,
			}));
		}
		if (item.phase === "tool_result") {
			const eventType = item.status === "ok"
				? "tool_completed"
				: item.status === "denied"
					? "tool_denied"
					: "tool_failed";
			events.push(makeEvent(eventType, {
				step: item.step,
				tool: item.tool,
				targetPath: item.targetPath,
				status: item.status,
				summary: item.summary,
				message: item.message,
			}));
		}
		if (item.phase === "fallback") {
			events.push(makeEvent("fallback", { message: item.message }));
		}
		if (item.phase === "error") {
			events.push(makeEvent("turn_failed", { message: item.message }));
		}
	}
	if (runtimeResult.parseError) {
		events.push(makeEvent("parse_error", { message: runtimeResult.parseError }));
	}
	if ((runtimeResult.assistantText ?? "").includes("Maximum tool-iteration limit reached")) {
		events.push(makeEvent("max_tool_iterations", { message: "Maximum tool iteration limit reached." }));
	}
	for (const mutation of pendingMutations) {
		events.push(makeEvent("mutation_planned", {
			id: mutation.id,
			operation: mutation.operation,
			targetPath: mutation.targetPath,
			summary: mutation.summary,
		}));
	}
	if (failure && !events.some((event) => event.type === "turn_failed")) {
		events.push(makeEvent("turn_failed", { message: failure.message }));
	}
	if (!failure) {
		events.push(makeEvent("assistant_final", { text: runtimeResult.assistantText ?? "" }));
	}
	return events;
}

function makeEvent(type, payload = {}) {
	return {
		type,
		at: new Date().toISOString(),
		...payload,
	};
}
