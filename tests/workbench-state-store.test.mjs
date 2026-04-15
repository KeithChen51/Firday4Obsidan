/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/features/workbench/WorkbenchStateStore.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("workbench state store records and replaces sync reports", async () => {
	const mod = await loadModule();
	const store = new mod.WorkbenchStateStore();
	store.recordSyncReport({
		projectSlug: "alpha",
		recordedAt: "2026-01-01T00:00:00.000Z",
		result: {
			success: true,
			projectSlug: "alpha",
			pulledFiles: [],
			pushedFiles: [],
			conflicts: [],
		},
	});
	assert.equal(store.getSyncReports().length, 1);
	store.setSyncReports([]);
	assert.equal(store.getSyncReports().length, 0);
});

test("workbench state store stores one-shot project editor request", async () => {
	const mod = await loadModule();
	const store = new mod.WorkbenchStateStore();
	store.setProjectEditorRequest({ mode: "edit", projectId: "project-alpha" });
	const request = store.consumeProjectEditorRequest();
	assert.equal(request?.mode, "edit");
	assert.equal(request?.projectId, "project-alpha");
	assert.equal(store.consumeProjectEditorRequest(), null);
});

test("workbench state store keeps conflict proposals and quality report", async () => {
	const mod = await loadModule();
	const store = new mod.WorkbenchStateStore();
	store.recordConflictProposal({
		projectSlug: "alpha",
		filePath: "src/app.ts",
		markdown: "# Fix Proposal",
		recommendedStrategy: "ours",
		recordedAt: "2026-01-01T00:00:00.000Z",
		status: "pending",
	});
	store.recordConflictProposal({
		projectSlug: "alpha",
		filePath: "src/app.ts",
		markdown: "# Fix Proposal v2",
		recommendedStrategy: "theirs",
		recordedAt: "2026-01-01T00:01:00.000Z",
		status: "applied",
		appliedStrategy: "theirs",
	});
	store.setQualityReport("# Quality Report");
	assert.equal(store.getConflictProposals().length, 1);
	assert.equal(store.getConflictProposals()[0]?.status, "applied");
	assert.equal(store.getConflictProposals()[0]?.appliedStrategy, "theirs");
	assert.equal(store.getQualityReport(), "# Quality Report");
});

test("workbench state store records edit plans", async () => {
	const mod = await loadModule();
	const store = new mod.WorkbenchStateStore();
	store.recordEditPlan({
		id: "plan-1",
		agentId: "agent-1",
		tool: "write",
		recordedAt: "2026-01-01T00:00:00.000Z",
		items: [{ path: "a.md", before: "a0", after: "a1", status: "applied", changeType: "update" }],
	});
	store.replaceEditPlan({
		id: "plan-1",
		agentId: "agent-1",
		tool: "write",
		recordedAt: "2026-01-01T00:02:00.000Z",
		items: [{ path: "a.md", before: "a0", after: "a1", status: "accepted", changeType: "update" }],
	});
	assert.equal(store.getEditPlans().length, 1);
	assert.equal(store.getEditPlans()[0]?.items[0]?.status, "accepted");
});

test("workbench state store keeps last sync status snapshot per project", async () => {
	const mod = await loadModule();
	const store = new mod.WorkbenchStateStore();
	store.recordSyncStatusSnapshot({
		projectSlug: "alpha",
		stage: "pulling",
		message: "Pulling latest changes",
		recordedAt: "2026-01-01T00:00:00.000Z",
	});
	store.recordSyncStatusSnapshot({
		projectSlug: "alpha",
		stage: "offline",
		message: "Remote unreachable",
		recordedAt: "2026-01-01T00:01:00.000Z",
	});
	assert.equal(store.getSyncStatusSnapshots().length, 1);
	assert.equal(store.getSyncStatusSnapshots()[0]?.stage, "offline");
	assert.equal(store.getSyncStatusSnapshots()[0]?.message, "Remote unreachable");
});

test("workbench state store replaces per-project sync conflicts while preserving other projects", async () => {
	const mod = await loadModule();
	const store = new mod.WorkbenchStateStore();
	store.replaceProjectSyncConflicts("alpha", [
		{
			projectId: "alpha",
			projectSlug: "alpha",
			filePath: "src/a.ts",
			conflictType: "content",
			localSnippet: "a-local",
			remoteSnippet: "a-remote",
			mergedSnippet: "<<<<<<< HEAD",
			markdown: "# Fix Proposal",
			recommendedStrategy: "manual",
			status: "pending",
			recordedAt: "2026-04-15T12:00:00.000Z",
		},
	]);
	store.replaceProjectSyncConflicts("beta", [
		{
			projectId: "beta",
			projectSlug: "beta",
			filePath: "src/b.ts",
			conflictType: "content",
			localSnippet: "b-local",
			remoteSnippet: "b-remote",
			mergedSnippet: "<<<<<<< HEAD",
			markdown: "# Fix Proposal",
			recommendedStrategy: "manual",
			status: "deferred",
			recordedAt: "2026-04-15T12:01:00.000Z",
		},
	]);

	store.replaceProjectSyncConflicts("alpha", [
		{
			projectId: "alpha",
			projectSlug: "alpha",
			filePath: "src/c.ts",
			conflictType: "content",
			localSnippet: "c-local",
			remoteSnippet: "c-remote",
			mergedSnippet: "<<<<<<< HEAD",
			markdown: "# Fix Proposal",
			recommendedStrategy: "ours",
			status: "pending",
			recordedAt: "2026-04-15T12:02:00.000Z",
		},
	]);

	assert.deepEqual(
		store.getSyncConflicts("alpha").map((item) => item.filePath),
		["src/c.ts"],
	);
	assert.deepEqual(
		store.getSyncConflicts("beta").map((item) => item.filePath),
		["src/b.ts"],
	);
});
