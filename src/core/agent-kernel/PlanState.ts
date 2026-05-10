export type IntakeComplexity = "simple" | "light" | "complex" | "unclear";
export type IntakeRoute = "answer" | "clarify" | "plan_and_execute";
export type IntakeDecisionSource = "runtime" | "model" | "fallback";

export interface IntakeDecision {
	complexity: IntakeComplexity;
	route: IntakeRoute;
	statement: string;
	requiresPlan: boolean;
	shouldShowProcess: boolean;
	shouldUseVisiblePlan: boolean;
	source: IntakeDecisionSource;
}

export type PlanVisibility = "hidden" | "task_bar" | "visible" | "internal";
export type PlanTaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed" | "blocked";
export type PlanStateStatus = "pending" | "running" | "completed" | "skipped" | "failed";

export interface PlanTask {
	id: string;
	title: string;
	status: PlanTaskStatus;
	summary?: string;
	startedAt?: string;
	completedAt?: string;
}

export interface PlanState {
	planId: string;
	visibility: PlanVisibility;
	status: PlanStateStatus;
	currentTaskId?: string;
	tasks: PlanTask[];
	createdAt?: string;
	updatedAt?: string;
	completedAt?: string;
}

export type PlanProgressType =
	| "plan_create"
	| "plan_update"
	| "plan_revise"
	| "plan_complete"
	| "plan_skip";

export type PlanRevisionChangeType = "add" | "remove" | "rename" | "reorder" | "status";

export interface PlanRevisionChange {
	type: PlanRevisionChangeType;
	taskId?: string;
	title?: string;
	status?: PlanTaskStatus;
}

export interface RuntimePlanProgress {
	type: PlanProgressType;
	state: PlanState;
	taskId?: string;
	message?: string;
	reason?: string;
	changes?: PlanRevisionChange[];
}

export interface RuntimePlanTaskInstruction {
	id?: string;
	title: string;
	status?: PlanTaskStatus;
	summary?: string;
}

export type RuntimePlanInstruction =
	| RuntimePlanCreateInstruction
	| RuntimePlanReviseInstruction
	| RuntimePlanSkipInstruction;

export interface RuntimePlanCreateInstruction {
	type: "plan_create";
	reason?: string;
	visibility?: PlanVisibility;
	tasks?: RuntimePlanTaskInstruction[];
	tasksMalformed?: boolean;
}

export interface RuntimePlanReviseInstruction {
	type: "plan_revise";
	reason?: string;
	changes?: PlanRevisionChange[];
	tasks?: RuntimePlanTaskInstruction[];
}

export interface RuntimePlanSkipInstruction {
	type: "plan_skip";
	reason?: string;
}

export type CreatePlanTaskInput = string | RuntimePlanTaskInstruction;

export interface CreatePlanStateInput {
	planId: string;
	tasks: CreatePlanTaskInput[];
	now?: string;
	visibility?: PlanVisibility;
}

export interface PlanStateMutationOptions {
	now?: string;
	reason?: string;
}

export function createPlanState(input: CreatePlanStateInput): PlanState {
	const now = input.now ?? new Date().toISOString();
	const planId = input.planId.trim() || "plan";
	const tasks = input.tasks
		.map((task, index) => normalizeCreatePlanTask(task, planId, index, now))
		.filter((task): task is PlanTask => Boolean(task));
	const currentTask = tasks.find((task) => task.status === "in_progress");
	return normalizePlanState({
		planId,
		visibility: input.visibility ?? "task_bar",
		status: tasks.length > 0 ? "running" : "completed",
		...(currentTask ? { currentTaskId: currentTask.id } : {}),
		tasks,
		createdAt: now,
		updatedAt: now,
		...(tasks.length === 0 ? { completedAt: now } : {}),
	});
}

export function completePlanTask(
	state: PlanState,
	taskId: string,
	options: PlanStateMutationOptions = {},
): PlanState {
	return advancePlanTask(state, taskId, "completed", options);
}

export function skipPlanTask(
	state: PlanState,
	taskId: string,
	options: PlanStateMutationOptions = {},
): PlanState {
	return advancePlanTask(state, taskId, "skipped", options);
}

export function failPlanTask(
	state: PlanState,
	taskId: string,
	options: PlanStateMutationOptions = {},
): PlanState {
	const now = options.now ?? new Date().toISOString();
	return normalizePlanState({
		...state,
		status: "failed",
		updatedAt: now,
		tasks: state.tasks.map((task) =>
			task.id === taskId
				? {
					...task,
					status: "failed",
					...(options.reason ? { summary: options.reason } : {}),
					completedAt: now,
				}
				: task.status === "in_progress"
					? { ...task, status: "pending" }
					: task
		),
	});
}

export function revisePlanState(
	state: PlanState,
	input: {
		tasks?: Array<{ id?: string; title: string }>;
		changes?: PlanRevisionChange[];
		reason?: string;
		now?: string;
	},
): PlanState {
	const now = input.now ?? new Date().toISOString();
	const existingById = new Map(state.tasks.map((task) => [task.id, task]));
	if (input.tasks) {
		const tasks = input.tasks
			.map((task, index) => ({
				id: task.id?.trim() || `${state.planId}-${index + 1}`,
				title: task.title.trim(),
			}))
			.filter((task) => task.title.length > 0)
			.map((task): PlanTask => {
				const existing = existingById.get(task.id);
				if (existing) {
					return { ...existing, title: task.title };
				}
				return {
					id: task.id,
					title: task.title,
					status: "pending",
				};
			});
		return normalizePlanState({
			...state,
			status: state.status === "completed" ? "running" : state.status,
			tasks,
			updatedAt: now,
		});
	}
	const tasks = applyRevisionChanges(state, input.changes ?? [], now);
	return normalizePlanState({
		...state,
		status: state.status === "completed" || state.status === "skipped" ? "running" : state.status,
		tasks,
		updatedAt: now,
	});
}

export function completePlanState(
	state: PlanState,
	options: PlanStateMutationOptions = {},
): PlanState {
	const now = options.now ?? new Date().toISOString();
	return {
		...state,
		status: "completed",
		currentTaskId: state.tasks.at(-1)?.id,
		updatedAt: now,
		completedAt: now,
		tasks: state.tasks.map((task) => {
			if (task.status === "blocked") {
				return { ...task };
			}
			return {
				...task,
				status: task.status === "skipped" ? "skipped" : "completed",
				completedAt: task.completedAt ?? now,
			};
		}),
	};
}

export function skipPlanState(
	state: PlanState,
	options: PlanStateMutationOptions = {},
): PlanState {
	const now = options.now ?? new Date().toISOString();
	return {
		...state,
		status: "skipped",
		updatedAt: now,
		completedAt: now,
		tasks: state.tasks.map((task) => ({
			...task,
			status: task.status === "completed" || task.status === "blocked" ? task.status : "skipped",
			...(task.status === "completed" || task.status === "blocked" ? {} : { completedAt: task.completedAt ?? now }),
			...(options.reason && task.status !== "completed" && task.status !== "blocked" ? { summary: options.reason } : {}),
		})),
	};
}

export function normalizePlanState(state: PlanState): PlanState {
	const tasks = state.tasks.map((task) => ({ ...task }));
	const inProgress = tasks.find((task) => task.status === "in_progress");
	const terminal = state.status === "completed" || state.status === "failed" || state.status === "skipped";
	if (!inProgress && !terminal) {
		const next = tasks.find((task) => task.status === "pending");
		if (next) {
			next.status = "in_progress";
			next.startedAt = next.startedAt ?? state.updatedAt;
		}
	}
	let seenRunning = false;
	for (const task of tasks) {
		if (task.status !== "in_progress") {
			continue;
		}
		if (!seenRunning) {
			seenRunning = true;
			continue;
		}
		task.status = "pending";
	}
	const currentTask = tasks.find((task) => task.status === "in_progress") ??
		[...tasks].reverse().find((task) => task.status === "completed" || task.status === "skipped" || task.status === "failed") ??
		tasks[0];
	const allCompleted = tasks.length > 0 && tasks.every((task) => task.status === "completed" || task.status === "skipped");
	return {
		...state,
		status: state.status === "failed"
			? "failed"
			: allCompleted
				? "completed"
				: tasks.length > 0
					? "running"
					: "completed",
		...(currentTask ? { currentTaskId: currentTask.id } : {}),
		tasks,
	};
}

function normalizeCreatePlanTask(
	input: CreatePlanTaskInput,
	planId: string,
	index: number,
	now: string,
): PlanTask | null {
	if (typeof input === "string") {
		const title = input.trim();
		if (!title) {
			return null;
		}
		return {
			id: `${planId}-${index + 1}`,
			title,
			status: index === 0 ? "in_progress" : "pending",
			...(index === 0 ? { startedAt: now } : {}),
		};
	}
	const title = input.title.trim();
	if (!title) {
		return null;
	}
	const status = normalizePlanTaskStatus(input.status, index === 0 ? "in_progress" : "pending");
	return {
		id: input.id?.trim() || `${planId}-${index + 1}`,
		title,
		status,
		...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
		...(status === "in_progress" ? { startedAt: now } : {}),
		...(status === "completed" || status === "skipped" || status === "failed" ? { completedAt: now } : {}),
	};
}

function advancePlanTask(
	state: PlanState,
	taskId: string,
	status: "completed" | "skipped",
	options: PlanStateMutationOptions,
): PlanState {
	const now = options.now ?? new Date().toISOString();
	const target = state.tasks.find((task) => task.id === taskId);
	if (target?.status === "blocked") {
		return normalizePlanState({
			...state,
			updatedAt: now,
		});
	}
	const tasks = state.tasks.map((task) => {
		if (task.id !== taskId) {
			return { ...task };
		}
		return {
			...task,
			status,
			...(options.reason ? { summary: options.reason } : {}),
			completedAt: now,
		};
	});
	const completedIndex = tasks.findIndex((task) => task.id === taskId);
	const next = tasks.slice(completedIndex + 1).find((task) => task.status === "pending");
	if (next) {
		next.status = "in_progress";
		next.startedAt = next.startedAt ?? now;
	}
	return normalizePlanState({
		...state,
		tasks,
		updatedAt: now,
	});
}

function applyRevisionChanges(state: PlanState, changes: PlanRevisionChange[], now: string): PlanTask[] {
	const tasks = state.tasks.map((task) => ({ ...task }));
	let nextGeneratedIndex = tasks.length + 1;
	for (const change of changes) {
		const taskId = change.taskId?.trim();
		if (change.type === "add") {
			const title = change.title?.trim();
			if (!title) {
				continue;
			}
			const id = taskId || `${state.planId}-${nextGeneratedIndex++}`;
			if (tasks.some((task) => task.id === id)) {
				continue;
			}
			tasks.push({
				id,
				title,
				status: normalizePlanTaskStatus(change.status, "pending"),
				...(change.status === "in_progress" ? { startedAt: now } : {}),
			});
			continue;
		}
		if (!taskId) {
			continue;
		}
		const index = tasks.findIndex((task) => task.id === taskId);
		if (index < 0) {
			continue;
		}
		const task = tasks[index]!;
		if (change.type === "remove") {
			tasks.splice(index, 1);
			continue;
		}
		if (change.type === "rename") {
			const title = change.title?.trim();
			if (title) {
				tasks[index] = { ...task, title };
			}
			continue;
		}
		if (change.type === "status") {
			if (task.status === "blocked") {
				continue;
			}
			const status = normalizePlanTaskStatus(change.status, task.status);
			if (status === "in_progress") {
				for (const other of tasks) {
					if (other.id !== taskId && other.status === "in_progress") {
						other.status = "pending";
					}
				}
			}
			tasks[index] = {
				...task,
				status,
				...(status === "in_progress" ? { startedAt: task.startedAt ?? now } : {}),
				...(status === "completed" || status === "skipped" || status === "failed" ? { completedAt: task.completedAt ?? now } : {}),
			};
			continue;
		}
		if (change.type === "reorder") {
			const [moved] = tasks.splice(index, 1);
			if (moved) {
				tasks.push(moved);
			}
		}
	}
	return tasks;
}

function normalizePlanTaskStatus(status: PlanTaskStatus | undefined, fallback: PlanTaskStatus): PlanTaskStatus {
	if (
		status === "pending" ||
		status === "in_progress" ||
		status === "completed" ||
		status === "skipped" ||
		status === "failed" ||
		status === "blocked"
	) {
		return status;
	}
	return fallback;
}
