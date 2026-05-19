/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

import { runAgentRuntimeScenario } from "./helpers/fakeAgentRuntime.mjs";

function writeScenario(overrides = {}) {
	return {
		name: "reviewable write mutation",
		files: {
			"Project/workspace/a.md": "original",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
				},
			},
			{ assistant: "Prepared the update for review." },
		],
		...overrides,
	};
}

test("standard review mode records a pending write mutation without changing the vault", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		reloadPendingMutations: true,
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].status, "pending");
	assert.equal(result.pendingMutations[0].operation, "write");
	assert.equal(result.pendingMutations[0].targetPath, "Project/workspace/a.md");
	assert.equal(result.traces[0].summary, "已准备文件更新，确认后才会写入 Obsidian：Project/workspace/a.md");
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	assert.equal(result.turnEventSummary.mutations.applied, 0);
	assert.deepEqual(result.storedMutations.map((plan) => plan.id), [result.pendingMutations[0].planId]);
	assert.deepEqual(result.reloadedPendingMutations.map((plan) => plan.planId), [result.pendingMutations[0].planId]);
	const planned = result.turnEvents.find((event) => event.type === "mutation_planned");
	assert.ok(planned, "persisted replay should contain mutation_planned");
	assert.equal(planned.payload.status, "planned");
	assert.equal(planned.payload.operation, "write");
	assert.equal(planned.payload.targetPath, "Project/workspace/a.md");
	assert.equal(typeof planned.payload.beforeHash, "string");
	assert.equal(typeof planned.payload.proposedHash, "string");
	assert.equal(planned.payload.summary, "已准备文件更新，确认后才会写入 Obsidian：Project/workspace/a.md");
	assert.match(result.assistantText, /确认后才会写入 Obsidian/);
});

test("native write mutation records the model tool call id for review correlation", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		modelSteps: [
			{
				tool: {
					id: "native-call-123",
					name: "write",
					args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
				},
			},
			{ assistant: "Prepared the update for review." },
		],
	}));

	assert.equal(result.storedMutations.length, 1);
	assert.equal(result.storedMutations[0].toolCallId, "native-call-123");
	const planned = result.turnEvents.find((event) => event.type === "mutation_planned");
	assert.equal(planned?.payload.toolCallId, "native-call-123");
});

test("accepting a reviewed mutation applies the file write and records replay event", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		afterTurnActions: ["acceptFirstEditPlan"],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "changed" });
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.applied, 1);
	assert.ok(result.turnEvents.some((event) => event.type === "mutation_applied"));
	assert.deepEqual(result.storedMutations.map((plan) => plan.status), ["applied"]);
});

test("accepting a large reviewed mutation after reload applies the hidden persisted proposal", async () => {
	const proposedContent = `changed\n${Array.from({ length: 260 }, () => "large proposed line").join("\n")}`;
	const result = await runAgentRuntimeScenario(writeScenario({
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: proposedContent, mode: "update" },
				},
			},
			{ assistant: "Prepared the large update for review." },
		],
		afterTurnActions: ["reloadPendingMutations", "acceptFirstEditPlan"],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": proposedContent });
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.applied, 1);
	assert.ok(result.turnEvents.some((event) => event.type === "mutation_applied"));
	assert.deepEqual(result.storedMutations.map((plan) => plan.status), ["applied"]);
});

test("rejecting a reviewed mutation leaves the file unchanged and records replay event", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		afterTurnActions: ["rejectFirstEditPlan"],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.rejected, 1);
	assert.ok(result.turnEvents.some((event) => event.type === "mutation_rejected"));
	assert.deepEqual(result.storedMutations.map((plan) => plan.status), ["rejected"]);
});

test("accepting after an external edit marks the mutation conflicted and preserves current file content", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		afterTurnActions: [
			{ type: "modifyFile", path: "Project/workspace/a.md", content: "external change" },
			"acceptFirstEditPlan",
		],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "external change" });
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.conflicted, 1);
	assert.ok(result.turnEvents.some((event) => event.type === "mutation_conflicted"));
	assert.deepEqual(result.storedMutations.map((plan) => plan.status), ["conflicted"]);
});

test("autoApproved mutation mode applies writes immediately after planning", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		settings: {
			agentRuntime: {
				requireWriteConfirmation: false,
				toolPermissionMode: "auto",
				fileMutationMode: "autoApproved",
			},
		},
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "changed" });
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	assert.equal(result.turnEventSummary.mutations.applied, 1);
});

test("write confirmation requirement overrides autoApproved mutation mode", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		settings: {
			agentRuntime: {
				requireWriteConfirmation: true,
				toolPermissionMode: "auto",
				fileMutationMode: "autoApproved",
			},
		},
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.approvalRequests.length, 0);
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	assert.equal(result.turnEventSummary.mutations.applied, 0);
	assert.ok(!result.turnEvents.some((event) => event.type === "mutation_applied"));
});

test("auto permission keeps ordinary file writes pending when mutation review is enabled", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		settings: {
			agentRuntime: {
				requireWriteConfirmation: true,
				toolPermissionMode: "auto",
				fileMutationMode: "review",
			},
		},
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.approvalRequests.length, 0);
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].operation, "write");
	assert.equal(result.pendingMutations[0].targetPath, "Project/workspace/a.md");
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	assert.equal(result.turnEventSummary.mutations.applied, 0);
	assert.ok(!result.turnEvents.some((event) => event.type === "mutation_applied"));
});

test("standard review write creates one mutation review without a separate tool approval", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		approvals: ["deny"],
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.approvalRequests.length, 0);
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].operation, "write");
	assert.equal(result.turnEventSummary.approvals.requested, 0);
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	assert.equal(result.turnEventSummary.mutations.applied, 0);
	assert.ok(!result.turnEvents.some((event) => event.type === "tool_approval_requested"));
});

test("standard review mode records a pending edit mutation without changing the vault", async () => {
	const result = await runAgentRuntimeScenario({
		name: "reviewable edit mutation",
		files: {
			"Project/workspace/a.md": "hello old world",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "edit",
					args: {
						path: "Project/workspace/a.md",
						edits: [{ search: "old", replace: "new" }],
					},
				},
			},
			{ assistant: "Prepared the edit for review." },
		],
	});

	assert.deepEqual(result.files, { "Project/workspace/a.md": "hello old world" });
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].operation, "edit");
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	const planned = result.turnEvents.find((event) => event.type === "mutation_planned");
	assert.equal(planned?.payload.operation, "edit");
	assert.equal(planned?.payload.targetPath, "Project/workspace/a.md");
});

test("standard review mode records a high-risk pending delete mutation without deleting the file", async () => {
	const result = await runAgentRuntimeScenario({
		name: "reviewable delete mutation",
		files: {
			"Project/workspace/a.md": "keep me until apply",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "delete",
					args: { path: "Project/workspace/a.md" },
				},
			},
			{ assistant: "Prepared the delete for review." },
		],
	});

	assert.deepEqual(result.files, { "Project/workspace/a.md": "keep me until apply" });
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].operation, "delete");
	const planned = result.turnEvents.find((event) => event.type === "mutation_planned");
	assert.equal(planned?.payload.operation, "delete");
	assert.equal(planned?.payload.riskLevel, "high");
});

test("standard review delete creates one high-risk mutation review without a separate tool approval", async () => {
	const result = await runAgentRuntimeScenario({
		name: "standard review delete mutation",
		files: {
			"Project/workspace/a.md": "original",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "delete",
					args: { path: "Project/workspace/a.md" },
				},
			},
			{ assistant: "Could not prepare the deletion because permission was denied." },
		],
	});

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.approvalRequests.length, 0);
	assert.equal(result.turnEventSummary.approvals.requested, 0);
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].operation, "delete");
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	assert.ok(!result.turnEvents.some((event) => event.type === "tool_approval_requested"));
});

test("standard review Obsidian structure writes create mutation review without a separate tool approval", async () => {
	const result = await runAgentRuntimeScenario({
		name: "standard review canvas apply mutation",
		files: {},
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "canvas_apply",
					args: {
						path: "Project/workspace/relations.canvas",
						mode: "create",
						nodes: [
							{ id: "a", type: "text", text: "A", x: 0, y: 0, width: 240, height: 120 },
							{ id: "b", type: "text", text: "B", x: 360, y: 0, width: 240, height: 120 },
						],
						edges: [
							{ id: "a-to-b", fromNode: "a", toNode: "b" },
						],
					},
				},
			},
			{ assistant: "Prepared the canvas for review." },
		],
	});

	assert.equal(result.approvalRequests.length, 0);
	assert.equal(result.turnEventSummary.approvals.requested, 0);
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].operation, "canvas_apply");
	assert.equal(result.pendingMutations[0].targetPath, "Project/workspace/relations.canvas");
	assert.equal(result.turnEventSummary.mutations.planned, 1);
	assert.ok(!result.turnEvents.some((event) => event.type === "tool_approval_requested"));
});

test("standard review create write edit and delete summaries stay prepared until review is applied", async () => {
	const cases = [
		{
			name: "create",
			files: {},
			tool: {
				name: "write",
				args: { path: "Project/workspace/new.md", content: "created", mode: "create" },
			},
			expected: "已准备文件创建，确认后才会写入 Obsidian：Project/workspace/new.md",
		},
		{
			name: "write",
			files: { "Project/workspace/a.md": "original" },
			tool: {
				name: "write",
				args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
			},
			expected: "已准备文件更新，确认后才会写入 Obsidian：Project/workspace/a.md",
		},
		{
			name: "edit",
			files: { "Project/workspace/edit.md": "hello old world" },
			tool: {
				name: "edit",
				args: { path: "Project/workspace/edit.md", edits: [{ search: "old", replace: "new" }] },
			},
			expected: "已准备文件更新，确认后才会写入 Obsidian：Project/workspace/edit.md",
		},
		{
			name: "delete",
			files: { "Project/workspace/delete.md": "remove me after review" },
			tool: {
				name: "delete",
				args: { path: "Project/workspace/delete.md" },
			},
			expected: "已准备文件删除，确认后才会写入 Obsidian：Project/workspace/delete.md",
		},
	];

	for (const item of cases) {
		const result = await runAgentRuntimeScenario({
			name: `reviewable ${item.name} mutation`,
			files: item.files,
			settings: {
				agentRuntime: {
					toolPermissionMode: "standard",
					fileMutationMode: "review",
				},
			},
			modelSteps: [
				{ tool: item.tool },
				{ assistant: "Prepared the file change for review." },
			],
		});

		const planned = result.turnEvents.find((event) => event.type === "mutation_planned");
		assert.equal(result.approvalRequests.length, 0, `${item.name} should not request separate tool approval`);
		assert.equal(result.turnEventSummary.approvals.requested, 0, `${item.name} should only use mutation review`);
		assert.equal(result.turnEventSummary.mutations.applied, 0, `${item.name} should not count pending review as applied`);
		assert.equal(result.traces[0].summary, item.expected);
		assert.equal(result.storedMutations[0]?.summary, item.expected);
		assert.equal(planned?.payload.summary, item.expected);
		assert.equal(result.task?.summary, "已准备好 1 个待应用的文件修改，确认后才会写入 Obsidian。");
		assert.equal(result.task?.waitingForApproval?.summary, item.expected);
		for (const summary of [
			result.traces[0].summary,
			result.storedMutations[0]?.summary ?? "",
			String(planned?.payload.summary ?? ""),
			result.task?.summary ?? "",
			result.task?.waitingForApproval?.summary ?? "",
		]) {
			assert.doesNotMatch(summary, /\b(completed|applied|created|modified|deleted)\b/i, `${item.name} summary should not imply completion`);
			assert.doesNotMatch(summary, /已创建|已修改|已删除/, `${item.name} summary should not use completed Chinese mutation language`);
			assert.match(summary, /确认后才会写入 Obsidian/, `${item.name} summary should keep review-first wording`);
		}
	}
});

test("high-risk non-file approval progress describes the consequence instead of raw tool names", async () => {
	const result = await runAgentRuntimeScenario({
		name: "exec approval wording",
		files: {},
		agentMode: "debug",
		settings: {
			agentRuntime: {
				toolPermissionMode: "standard",
				fileMutationMode: "review",
				enableExecTool: true,
			},
		},
		modelSteps: [
			{
				tool: {
					name: "exec",
					args: { command: "git", args: ["status"] },
				},
			},
			{ assistant: "Checked the local status." },
		],
	});

	assert.equal(result.approvalRequests.length, 1);
	assert.match(result.approvalRequests[0].description, /run a local command/i);
	assert.doesNotMatch(result.approvalRequests[0].description, /\bexec\b|exec\(/i);
	const approvalEvents = result.events.filter((event) => event.type === "tool_approval_requested");
	assert.ok(approvalEvents.length >= 1);
	for (const event of approvalEvents) {
		const text = String(event.message ?? event.summary ?? "");
		assert.match(text, /local command/i);
		assert.doesNotMatch(text, /\bexec\b|工具权限|tool approval/i);
	}
});

test("strict protection rejects ordinary file writes without creating review work", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		settings: {
			agentRuntime: {
				toolPermissionMode: "strict",
				fileMutationMode: "review",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
				},
			},
			{ assistant: "Switch execution mode before editing files." },
		],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.approvalRequests.length, 0);
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.storedMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.planned, 0);
	assert.equal(result.traces[0].status, "denied");
});

test("apply failure records mutation_apply_failed and keeps the plan pending", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		failActionPaths: ["Project/workspace/a.md"],
		afterTurnActions: ["acceptFirstEditPlan"],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].status, "pending");
	assert.equal(result.turnEventSummary.mutations.applyFailed, 1);
	assert.ok(result.turnEvents.some((event) => event.type === "mutation_apply_failed"));
	assert.deepEqual(result.storedMutations.map((plan) => plan.status), ["pending"]);
});

test("accepting an already reviewed mutation does not transition a completed task to failed", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		afterTurnActions: ["acceptFirstEditPlan", "acceptFirstEditPlan"],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "changed" });
	assert.deepEqual(result.storedMutations.map((plan) => plan.status), ["applied"]);
	assert.equal(result.tasks.at(-1)?.status, "completed");
	assert.doesNotMatch(JSON.stringify(result), /Invalid AgentTask transition/);
});

test("final answer does not imply review-first writes were already applied", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		modelSteps: [
			{
				tool: {
					name: "write",
					args: { path: "Project/workspace/a.md", content: "changed", mode: "update" },
				},
			},
			{ assistant: "I wrote the update." },
		],
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 1);
	assert.match(result.assistantText, /确认后才会写入 Obsidian/);
});

test("autoApproved folder delete is refused instead of bypassing mutation review", async () => {
	const result = await runAgentRuntimeScenario({
		name: "folder delete remains disabled",
		files: {
			"Project/workspace/a.md": "keep",
			"Project/workspace/nested/b.md": "keep nested",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "auto",
				fileMutationMode: "autoApproved",
			},
		},
		modelSteps: [
			{
				tool: {
					name: "delete",
					args: { path: "Project/workspace" },
				},
			},
			{ assistant: "Folder delete is not available." },
		],
	});

	assert.deepEqual(result.files, {
		"Project/workspace/a.md": "keep",
		"Project/workspace/nested/b.md": "keep nested",
	});
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.storedMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.applied, 0);
	assert.equal(result.traces[0].status, "failed");
	assert.match(result.traces[0].error, /Folder delete cannot be represented/);
});
