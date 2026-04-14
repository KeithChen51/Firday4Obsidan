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
	store.setProjectEditorRequest({ mode: "edit", projectSlug: "alpha" });
	const request = store.consumeProjectEditorRequest();
	assert.equal(request?.mode, "edit");
	assert.equal(request?.projectSlug, "alpha");
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
