export type IntakeComplexity = "simple" | "light" | "complex" | "unclear";
export type IntakeRoute = "answer" | "clarify" | "plan_and_execute";
export type IntakeDecisionSource = "runtime" | "model" | "fallback";

export interface IntakeDecision {
	complexity: IntakeComplexity;
	route: IntakeRoute;
	statement: string;
	requiresPlan: boolean;
	source: IntakeDecisionSource;
}

export type PlanVisibility = "hidden" | "task_bar";
export type PlanTaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";
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

export interface RuntimePlanProgress {
	type: PlanProgressType;
	state: PlanState;
	taskId?: string;
	message?: string;
}

export interface CreatePlanStateInput {
	planId: string;
	tasks: string[];
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
		.map((title) => title.trim())
		.filter(Boolean)
		.map((title, index): PlanTask => ({
			id: `${planId}-${index + 1}`,
			title,
			status: index === 0 ? "in_progress" : "pending",
			...(index === 0 ? { startedAt: now } : {}),
		}));
	const currentTask = tasks.find((task) => task.status === "in_progress");
	return {
		planId,
		visibility: input.visibility ?? "task_bar",
		status: tasks.length > 0 ? "running" : "completed",
		...(currentTask ? { currentTaskId: currentTask.id } : {}),
		tasks,
		createdAt: now,
		updatedAt: now,
		...(tasks.length === 0 ? { completedAt: now } : {}),
	};
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
		tasks: Array<{ id?: string; title: string }>;
		now?: string;
	},
): PlanState {
	const now = input.now ?? new Date().toISOString();
	const existingById = new Map(state.tasks.map((task) => [task.id, task]));
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
		tasks: state.tasks.map((task) => ({
			...task,
			status: task.status === "skipped" ? "skipped" : "completed",
			completedAt: task.completedAt ?? now,
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

function advancePlanTask(
	state: PlanState,
	taskId: string,
	status: "completed" | "skipped",
	options: PlanStateMutationOptions,
): PlanState {
	const now = options.now ?? new Date().toISOString();
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
