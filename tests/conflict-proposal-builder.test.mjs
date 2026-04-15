/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/core/extensions/ConflictProposalBuilder.ts");
const conflictServiceModulePath = path.join(projectRoot, "src/features/sync/ConflictResolutionService.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

async function loadConflictServiceModule() {
	return jiti.import(conflictServiceModulePath);
}

test("conflict proposal builder returns markdown and recommended strategy", async () => {
	const mod = await loadModule();
	const proposal = mod.buildConflictProposal({
		filePath: "src/app.ts",
		localSnippet: "const mode = 'safe';",
		remoteSnippet: "const mode = 'safe';",
	});

	assert.equal(proposal.recommendedStrategy, "ours");
	assert.equal(proposal.markdown.includes("# Fix Proposal"), true);
});

test("conflict resolution service builds sorted conflict records and preserves deferred leftovers", async () => {
	const mod = await loadConflictServiceModule();
	const service = new mod.ConflictResolutionService();
	const project = {
		projectId: "alpha",
		projectName: "Alpha",
		boundaryPath: "Projects/alpha",
		gitState: "git_remote_bound",
		slug: "alpha",
		groupId: "default-group",
		projectRootPath: "Projects/alpha",
		localPath: "",
		gitRemote: "https://example.com/demo.git",
		autoSync: true,
		lastSyncAt: "",
	};

	const records = service.buildRecords({
		project,
		recordedAt: "2026-04-15T12:00:00.000Z",
		conflicts: [
			{
				filePath: "src/z-last.ts",
				localSnippet: "",
				remoteSnippet: "remote only",
				mergedSnippet: "<<<<<<< HEAD",
				snapshotPath: "snapshots/z-last.md",
			},
			{
				filePath: "src/a-first.ts",
				localSnippet: "const local = true;",
				remoteSnippet: "const remote = true;",
				mergedSnippet: "<<<<<<< HEAD",
				snapshotPath: "snapshots/a-first.md",
			},
		],
		previous: [
			{
				projectId: "alpha",
				projectSlug: "alpha",
				filePath: "src/z-last.ts",
				conflictType: "content",
				localSnippet: "",
				remoteSnippet: "remote only",
				mergedSnippet: "<<<<<<< HEAD",
				snapshotPath: "snapshots/z-last.md",
				markdown: "# Old Proposal",
				recommendedStrategy: "theirs",
				status: "deferred",
				recordedAt: "2026-04-15T11:59:00.000Z",
			},
		],
	});

	assert.deepEqual(records.map((item) => item.filePath), ["src/a-first.ts", "src/z-last.ts"]);
	assert.equal(records[0]?.status, "pending");
	assert.equal(records[1]?.status, "deferred");
	assert.equal(records[1]?.recommendedStrategy, "theirs");
	assert.match(records[0]?.markdown ?? "", /# Fix Proposal/);
	assert.equal(records[0]?.conflictType, "content");
});

test("conflict resolution service updates proposal markdown without dropping record status", async () => {
	const mod = await loadConflictServiceModule();
	const service = new mod.ConflictResolutionService();
	const updated = service.attachProposal(
		{
			projectId: "alpha",
			projectSlug: "alpha",
			filePath: "src/app.ts",
			conflictType: "content",
			localSnippet: "const local = true;",
			remoteSnippet: "const remote = true;",
			mergedSnippet: "<<<<<<< HEAD",
			markdown: "# Fix Proposal",
			recommendedStrategy: "manual",
			status: "deferred",
			recordedAt: "2026-04-15T12:00:00.000Z",
		},
		{
			markdown: "# Updated Proposal",
			recommendedStrategy: "ours",
		},
	);

	assert.equal(updated.status, "deferred");
	assert.equal(updated.recommendedStrategy, "ours");
	assert.equal(updated.markdown, "# Updated Proposal");
});
