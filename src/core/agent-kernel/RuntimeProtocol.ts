import { parseRuntimeEnvelopeText } from "../orchestrator/RuntimeEnvelopeParser";
import type {
	IntakeComplexity,
	IntakeDecision,
	IntakeRoute,
	PlanRevisionChange,
	PlanTaskStatus,
	PlanVisibility,
	RuntimePlanInstruction,
	RuntimePlanTaskInstruction,
} from "./PlanState";
import {
	getIntakeRouteDefaults,
	inferInteractionRouteFromLegacy,
	isIntakeInteractionRoute,
} from "./PlanState";
import type { RuntimeMutationPlan } from "./contracts";

export interface RuntimeToolCallEnvelope {
	name: string;
	args?: Record<string, unknown>;
}

export interface RuntimeEnvelope {
	type?: string;
	assistant?: string;
	tool?: RuntimeToolCallEnvelope;
	intake?: IntakeDecision;
	plan?: RuntimePlanInstruction;
	mutations?: RuntimeMutationPlan[];
	pendingMutations?: RuntimeMutationPlan[];
}

export const MAX_TOOL_ITERATION_SAFE_SUMMARY = "工具调用次数过多，FRIDAY 已安全停止本轮操作。";
export const MAX_TOOL_ITERATION_SAFE_ASSISTANT_TEXT = `${MAX_TOOL_ITERATION_SAFE_SUMMARY}请缩小任务范围后再试。`;
export const RAW_MAX_TOOL_ITERATION_TEXTS = [
	"Tool iteration limit reached; stopped further tool calls for this turn.",
	"Maximum tool-iteration limit reached",
] as const;
export const MAX_TOOL_ITERATION_MESSAGE = MAX_TOOL_ITERATION_SAFE_SUMMARY;

export function containsRawMaxToolIterationText(text: string): boolean {
	return RAW_MAX_TOOL_ITERATION_TEXTS.some((rawText) => text.includes(rawText));
}

export function parseKernelRuntimeEnvelope(raw: string): RuntimeEnvelope | null {
	const parsed = parseRuntimeEnvelopeText(raw, "friday-runtime");
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const envelope = parsed as RuntimeEnvelope;
	const intake = normalizeRuntimeIntakeDecision((parsed as { intake?: unknown }).intake);
	const plan = normalizeRuntimePlanInstruction((parsed as { plan?: unknown; plan_create?: unknown }).plan ?? (parsed as { plan_create?: unknown }).plan_create);
	const normalized: RuntimeEnvelope = { ...envelope };
	if (intake) {
		normalized.intake = intake;
	} else {
		delete normalized.intake;
	}
	if (plan) {
		normalized.plan = plan;
	} else {
		delete normalized.plan;
	}
	return normalized;
}

export function isResponseEnvelope(envelope: RuntimeEnvelope): boolean {
	return envelope.type === "response" || (!envelope.type && !envelope.tool);
}

export function hasMutationPlans(envelope: RuntimeEnvelope): boolean {
	return envelope.type === "mutation_plan" ||
		Array.isArray(envelope.mutations) ||
		Array.isArray(envelope.pendingMutations);
}

export function extractMutationPlans(envelope: RuntimeEnvelope): RuntimeMutationPlan[] {
	if (Array.isArray(envelope.mutations)) {
		return envelope.mutations;
	}
	if (Array.isArray(envelope.pendingMutations)) {
		return envelope.pendingMutations;
	}
	return [];
}

function normalizeRuntimeIntakeDecision(value: unknown): IntakeDecision | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const complexity = normalizeIntakeComplexity(value.complexity);
	const route = normalizeIntakeRoute(value.route);
	const interactionRoute = isIntakeInteractionRoute(value.interactionRoute)
		? value.interactionRoute
		: complexity || route
			? inferInteractionRouteFromLegacy({
				...(complexity ? { complexity } : {}),
				...(route ? { route } : {}),
				requiresPlan: typeof value.requiresPlan === "boolean" ? value.requiresPlan : undefined,
				shouldShowProcess: typeof value.shouldShowProcess === "boolean" ? value.shouldShowProcess : undefined,
				shouldUseVisiblePlan: typeof value.shouldUseVisiblePlan === "boolean" ? value.shouldUseVisiblePlan : undefined,
			})
			: undefined;
	if (!interactionRoute) {
		return undefined;
	}
	const defaults = getIntakeRouteDefaults(interactionRoute);
	const statement = typeof value.statement === "string" && value.statement.trim()
		? value.statement.trim()
		: typeof value.understanding === "string" && value.understanding.trim()
			? value.understanding.trim()
			: "";
	if (!statement) {
		return undefined;
	}
	return {
		complexity: defaults.complexity,
		route: defaults.route,
		interactionRoute,
		statement,
		requiresPlan: defaults.requiresPlan,
		shouldShowProcess: interactionRoute === "light_task" && typeof value.shouldShowProcess === "boolean"
			? value.shouldShowProcess
			: defaults.shouldShowProcess,
		shouldUseVisiblePlan: defaults.shouldUseVisiblePlan,
		source: "model",
	};
}

function normalizeRuntimePlanInstruction(value: unknown): RuntimePlanInstruction | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const type = value.type;
	if (type !== "plan_create" && type !== "plan_revise" && type !== "plan_skip") {
		return undefined;
	}
	const reason = typeof value.reason === "string" && value.reason.trim()
		? value.reason.trim()
		: undefined;
	if (type === "plan_create") {
		const normalizedTasks = normalizeRuntimePlanTasks(value.tasks);
		const visibility = normalizePlanVisibility(value.visibility);
		return {
			type,
			...(reason ? { reason } : {}),
			...(visibility ? { visibility } : {}),
			...(normalizedTasks.tasks.length > 0 ? { tasks: normalizedTasks.tasks } : {}),
			...(normalizedTasks.malformed ? { tasksMalformed: true } : {}),
		};
	}
	if (type === "plan_skip") {
		return {
			type,
			...(reason ? { reason } : {}),
		};
	}
	const changes = normalizeRuntimePlanRevisionChanges(value.changes);
	const tasks = normalizeRuntimePlanRevisionTasks(value.tasks);
	return {
		type,
		...(reason ? { reason } : {}),
		...(changes.length > 0 ? { changes } : {}),
		...(tasks.length > 0 ? { tasks } : {}),
	};
}

function normalizeRuntimePlanRevisionChanges(value: unknown): PlanRevisionChange[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter(isRecord)
		.map((change) => {
			const type = normalizePlanRevisionChangeType(change.type);
			if (!type) {
				return null;
			}
			const taskId = typeof change.taskId === "string" && change.taskId.trim()
				? change.taskId.trim()
				: undefined;
			const title = typeof change.title === "string" && change.title.trim()
				? change.title.trim()
				: undefined;
			const status = normalizePlanTaskStatus(change.status);
			return {
				type,
				...(taskId ? { taskId } : {}),
				...(title ? { title } : {}),
				...(status ? { status } : {}),
			};
		})
		.filter((change): change is PlanRevisionChange => Boolean(change));
}

function normalizeRuntimePlanTasks(value: unknown): { tasks: RuntimePlanTaskInstruction[]; malformed: boolean } {
	if (!Array.isArray(value)) {
		return { tasks: [], malformed: value !== undefined };
	}
	const tasks = value
		.map(normalizeRuntimePlanTask)
		.filter((task): task is RuntimePlanTaskInstruction => Boolean(task));
	return { tasks, malformed: tasks.length === 0 && value.length > 0 };
}

function normalizeRuntimePlanTask(value: unknown): RuntimePlanTaskInstruction | null {
	if (typeof value === "string") {
		const title = value.trim();
		return title ? { title } : null;
	}
	if (!isRecord(value)) {
		return null;
	}
	const title = typeof value.title === "string" ? value.title.trim() : "";
	if (!title) {
		return null;
	}
	const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
	const status = normalizePlanTaskStatus(value.status);
	const summary = typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : undefined;
	return {
		...(id ? { id } : {}),
		title,
		...(status ? { status } : {}),
		...(summary ? { summary } : {}),
	};
}

function normalizeRuntimePlanRevisionTasks(value: unknown): RuntimePlanTaskInstruction[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter(isRecord)
		.map(normalizeRuntimePlanTask)
		.filter((task): task is RuntimePlanTaskInstruction => Boolean(task));
}

function normalizePlanRevisionChangeType(value: unknown): PlanRevisionChange["type"] | undefined {
	if (
		value === "add" ||
		value === "remove" ||
		value === "rename" ||
		value === "reorder" ||
		value === "status"
	) {
		return value;
	}
	return undefined;
}

function normalizePlanTaskStatus(value: unknown): PlanTaskStatus | undefined {
	if (
		value === "pending" ||
		value === "in_progress" ||
		value === "completed" ||
		value === "skipped" ||
		value === "failed" ||
		value === "blocked"
	) {
		return value;
	}
	return undefined;
}

function normalizePlanVisibility(value: unknown): PlanVisibility | undefined {
	if (
		value === "hidden" ||
		value === "task_bar" ||
		value === "visible" ||
		value === "internal"
	) {
		return value;
	}
	return undefined;
}

function normalizeIntakeComplexity(value: unknown): IntakeComplexity | undefined {
	if (
		value === "simple" ||
		value === "light" ||
		value === "complex" ||
		value === "unclear"
	) {
		return value;
	}
	return undefined;
}

function normalizeIntakeRoute(value: unknown): IntakeRoute | undefined {
	if (value === "answer" || value === "clarify" || value === "plan_and_execute") {
		return value;
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
