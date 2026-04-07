export type TaskStatus = "todo" | "in_progress" | "completed" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TaskFrontmatter {
	type: "task";
	taskId: string;
	projectId: string;
	parentTaskId: string;
	title: string;
	status: TaskStatus;
	priority: TaskPriority;
	dueDate: string;
	tags: string[];
	assignee: string;
	aiGenerated: boolean;
	description: string;
	createdAt: string;
	updatedAt: string;
	completedAt: string;
}

export interface TaskData extends TaskFrontmatter {
	filePath: string;
	body: string;
}

export interface TaskFilter {
	status?: TaskStatus[];
	priority?: TaskPriority[];
	assignee?: string;
	dueBefore?: string;
	dueAfter?: string;
}

export interface TaskCreateInput {
	title: string;
	projectId: string;
	parentTaskId?: string;
	priority?: TaskPriority;
	dueDate?: string;
	tags?: string[];
	assignee?: string;
	description?: string;
	status?: TaskStatus;
	aiGenerated?: boolean;
	body?: string;
}

export interface DailyTaskReference {
	taskId: string;
	title: string;
	filePath: string;
	checked: boolean;
}

export interface DailyNoteData {
	date: string;
	filePath: string;
	taskReferences: DailyTaskReference[];
	rawContent: string;
}
