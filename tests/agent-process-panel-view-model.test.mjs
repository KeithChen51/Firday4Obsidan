/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const viewModelPath = path.join(projectRoot, "src/views/agentProcessPanelViewModel.ts");

async function loadViewModel() {
	return jiti.import(viewModelPath);
}

test("buildAgentProcessPanelViewModel classifies simple live answers as lightweight thinking", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Agent is reasoning",
		summary: "Thinking through the answer.",
		items: [
			makeItem({
				id: "model-1",
				kind: "model",
				title: "Model step 1",
				detail: "Thinking through the answer.",
				status: "running",
			}),
		],
	}));

	assert.equal(view.mode, "simple_thinking");
	assert.equal(view.header.headline, "FRIDAY is thinking");
	assert.equal(view.stepGroups.length, 0);
	assert.equal(view.evidence.length, 0);
	assert.equal(view.mutations.length, 0);
	assert.equal(view.recovery, null);
});

test("buildAgentProcessPanelViewModel exposes running task focus summary and cancel action", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Agent is using a tool",
		summary: "Reading project notes.",
		items: [
			makeItem({ id: "context", kind: "context", title: "Loaded project rules", status: "ok" }),
			makeItem({ id: "tool", kind: "tool", title: "Read Notes/today.md", detail: "Reading project notes.", status: "running", tool: "read", targetPath: "Notes/today.md", step: 2 }),
		],
		actions: [
			{ id: "cancel", label: "Cancel", enabled: true, targetId: "task-1" },
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.current?.title, "Read Notes/today.md");
	assert.match(view.header.summary, /Reading project notes/);
	assert.equal(view.actions[0]?.id, "cancel");
	assert.equal(view.actions[0]?.enabled, true);
	assert.equal(view.evidence[0]?.label, "Notes/today.md");
});

test("buildAgentProcessPanelViewModel prioritizes waiting approval state and action reasons", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "waiting_for_approval",
		headline: "Waiting for approval",
		summary: "Approve write.",
		items: [
			makeItem({ id: "approval", kind: "approval", title: "Approval required", detail: "Approve write.", status: "waiting", tool: "write", targetPath: "Notes/today.md" }),
		],
		actions: [
			{ id: "approve", label: "Approve", enabled: false, reason: "Use the approval controls.", targetId: "approval" },
			{ id: "reject", label: "Reject", enabled: false, reason: "Use the approval controls.", targetId: "approval" },
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.status.key, "waiting_for_approval");
	assert.equal(view.status.tone, "waiting");
	assert.equal(view.current?.kind, "approval");
	assert.equal(view.actions[0]?.reason, "Use the approval controls.");
});

test("buildAgentProcessPanelViewModel exposes retryable failure recovery", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "failed",
		headline: "Agent failed",
		summary: "Tool failed.",
		failure: {
			class: "tool",
			message: "grep failed.",
			retryable: true,
			recoverable: true,
		},
		items: [
			makeItem({ id: "failure", kind: "failure", title: "Run failed", detail: "grep failed.", status: "failed" }),
		],
		actions: [
			{ id: "retry", label: "Retry", enabled: true, targetId: "task-1" },
		],
	}));

	assert.equal(view.status.tone, "failed");
	assert.equal(view.recovery?.title, "Recovery available");
	assert.match(view.recovery?.summary ?? "", /grep failed/);
	assert.equal(view.recovery?.retryable, true);
	assert.equal(view.actions[0]?.id, "retry");
});

test("buildAgentProcessPanelViewModel renders transport retry without checkpoint resume claims", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		headline: "Reconnecting to model",
		summary: "Model request retry scheduled after HTTP 504; attempt 1/4; backoff 700ms",
		items: [
			makeItem({
				id: "transport",
				kind: "transport",
				title: "Model transport",
				detail: "Model request retry scheduled after HTTP 504; attempt 1/4; backoff 700ms",
				status: "running",
				rawEventType: "retry_scheduled",
				step: 3,
			}),
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.equal(view.status.tone, "reconnecting");
	assert.equal(view.current?.kind, "transport");
	assert.match(view.header.summary, /attempt 1\/4/);
	assert.match(view.header.summary, /700ms/);
	assert.doesNotMatch(JSON.stringify(view), /checkpoint|resume/i);
});

test("buildAgentProcessPanelViewModel exposes completed replay summary and evidence strip", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "completed",
		headline: "Agent finished",
		summary: "Created a sourced answer.",
		privacy: { redacted: true, source: "replay" },
		items: [
			makeItem({ id: "read", kind: "tool", title: "read Notes/A.md", detail: "Read note.", status: "ok", tool: "read", targetPath: "Notes/A.md", step: 1 }),
			makeItem({ id: "final", kind: "final", title: "Final response", detail: "Created a sourced answer.", status: "ok" }),
		],
	}));

	assert.equal(view.mode, "completed_replay");
	assert.equal(view.header.label, "Completed");
	assert.equal(view.evidence[0]?.label, "Notes/A.md");
	assert.equal(view.timeline.at(-1)?.kind, "final");
});

test("buildAgentProcessPanelViewModel exposes mutation conflict and apply failure strips", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "failed",
		mutations: [
			{ id: "m1", event: "conflicted", operation: "edit", targetPath: "Notes/A.md", status: "conflicted", summary: "External edit found.", reason: "File changed." },
			{ id: "m2", event: "apply_failed", operation: "write", targetPath: "Notes/B.md", status: "failed", summary: "Write failed.", reason: "Permission denied." },
		],
		items: [
			makeItem({ id: "mutation-1", kind: "mutation", title: "edit Notes/A.md", detail: "External edit found.", status: "failed", targetPath: "Notes/A.md" }),
		],
	}));

	assert.equal(view.mutations.length, 2);
	assert.deepEqual(view.mutations.map((item) => item.event), ["conflicted", "apply_failed"]);
	assert.equal(view.mutations[0]?.tone, "failed");
	assert.equal(view.recovery?.title, "Review required");
});

test("buildAgentProcessPanelViewModel groups context tools evidence and mutations into steps", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		status: "running",
		items: [
			makeItem({ id: "ctx", kind: "context", title: "Loaded memory", detail: "Memory context.", status: "ok", rawEventType: "memory" }),
			makeItem({ id: "model", kind: "model", title: "Model step 1", detail: "Deciding next step.", status: "ok", step: 1 }),
			makeItem({ id: "tool", kind: "tool", title: "Search project", detail: "Found matches.", status: "ok", tool: "search", targetPath: "Notes", step: 1 }),
			makeItem({ id: "mutation", kind: "mutation", title: "edit Notes/A.md", detail: "Prepared edit.", status: "waiting", targetPath: "Notes/A.md", step: 2 }),
		],
		mutations: [
			{ id: "m1", event: "planned", operation: "edit", targetPath: "Notes/A.md", status: "pending", summary: "Prepared edit.", reason: "" },
		],
	}));

	assert.equal(view.mode, "stepped_process");
	assert.ok(view.stepGroups.length >= 3);
	assert.ok(view.stepGroups.some((group) => group.key === "context"));
	assert.ok(view.stepGroups.some((group) => group.items.some((item) => item.kind === "tool")));
	assert.ok(view.stepGroups.some((group) => group.items.some((item) => item.kind === "mutation")));
});

test("buildAgentProcessPanelViewModel truncates long timelines deterministically", async () => {
	const { buildAgentProcessPanelViewModel } = await loadViewModel();

	const view = buildAgentProcessPanelViewModel(makeSnapshot({
		items: Array.from({ length: 8 }, (_, index) => makeItem({
			id: `item-${index + 1}`,
			kind: "tool",
			title: `Item ${index + 1}`,
			status: "ok",
			step: index + 1,
		})),
	}), { maxExpandedItems: 4 });

	assert.equal(view.timeline.length, 4);
	assert.deepEqual(view.timeline.map((item) => item.title), ["Item 5", "Item 6", "Item 7", "Item 8"]);
	assert.equal(view.overflowCount, 4);
});

function makeSnapshot(overrides = {}) {
	return {
		identity: { turnId: "turn-1", taskId: "task-1", traceId: "trace-1", conversationId: "conversation-1" },
		status: "completed",
		headline: "Agent finished",
		summary: "Done.",
		stages: ["context", "reasoning", "tools", "review", "finalize"].map((key) => ({
			key,
			label: key,
			status: "pending",
			itemIds: [],
		})),
		items: [],
		actions: [],
		mutations: [],
		privacy: { redacted: true, source: "live" },
		...overrides,
	};
}

function makeItem(overrides = {}) {
	return {
		id: overrides.id ?? "item",
		kind: overrides.kind ?? "tool",
		title: overrides.title ?? "Item",
		detail: overrides.detail ?? "",
		status: overrides.status ?? "ok",
		...overrides,
	};
}
