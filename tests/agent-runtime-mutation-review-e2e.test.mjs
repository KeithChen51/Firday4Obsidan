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
				toolPermissionMode: "auto",
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

test("default review mode records a pending write mutation without changing the vault", async () => {
	const result = await runAgentRuntimeScenario(writeScenario({
		reloadPendingMutations: true,
	}));

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 1);
	assert.equal(result.pendingMutations[0].status, "pending");
	assert.equal(result.pendingMutations[0].operation, "write");
	assert.equal(result.pendingMutations[0].targetPath, "Project/workspace/a.md");
	assert.equal(result.traces[0].summary, "Write planned Project/workspace/a.md");
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
	assert.match(result.assistantText, /not applied/i);
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

test("default review mode records a pending edit mutation without changing the vault", async () => {
	const result = await runAgentRuntimeScenario({
		name: "reviewable edit mutation",
		files: {
			"Project/workspace/a.md": "hello old world",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "auto",
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

test("default review mode records a high-risk pending delete mutation without deleting the file", async () => {
	const result = await runAgentRuntimeScenario({
		name: "reviewable delete mutation",
		files: {
			"Project/workspace/a.md": "keep me until apply",
		},
		settings: {
			agentRuntime: {
				toolPermissionMode: "auto",
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

test("tool denial does not create a pending mutation plan", async () => {
	const result = await runAgentRuntimeScenario({
		name: "denied write mutation",
		files: {
			"Project/workspace/a.md": "original",
		},
		approvals: ["deny"],
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
			{ assistant: "Could not prepare the update because permission was denied." },
		],
	});

	assert.deepEqual(result.files, { "Project/workspace/a.md": "original" });
	assert.equal(result.pendingMutations.length, 0);
	assert.equal(result.storedMutations.length, 0);
	assert.equal(result.turnEventSummary.mutations.planned, 0);
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
	assert.match(result.assistantText, /not applied/i);
	assert.match(result.assistantText, /review/i);
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
