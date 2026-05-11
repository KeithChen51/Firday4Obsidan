/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const planPath = path.join(projectRoot, "src/core/mutations/MutationPlan.ts");
const applierPath = path.join(projectRoot, "src/core/mutations/MutationApplier.ts");
const storePath = path.join(projectRoot, "src/core/mutations/MutationPlanStore.ts");

async function loadModules() {
	const [planModule, applierModule, storeModule] = await Promise.all([
		jiti.import(planPath),
		jiti.import(applierPath),
		jiti.import(storePath),
	]);
	return {
		createMutationPlan: planModule.createMutationPlan,
		MutationApplier: applierModule.MutationApplier,
		MutationPlanStore: storeModule.MutationPlanStore,
	};
}

function createMemoryMutationVault(initialFiles = {}) {
	const files = new Map(Object.entries(initialFiles));
	const failures = new Set();
	return {
		files,
		failures,
		adapter: {
			async read(filePath) {
				return files.has(filePath) ? files.get(filePath) : null;
			},
			async write(filePath, content) {
				if (failures.has(filePath)) {
					throw new Error(`Synthetic write failure: ${filePath}`);
				}
				files.set(filePath, content);
			},
			async delete(filePath) {
				files.delete(filePath);
			},
		},
	};
}

test("MutationApplier applies write plans only after review", async () => {
	const { createMutationPlan, MutationApplier } = await loadModules();
	const vault = createMemoryMutationVault({ "Project/workspace/a.md": "old" });
	const applier = new MutationApplier(vault.adapter);
	const plan = createMutationPlan({
		id: "plan-1",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/workspace/a.md",
		before: "old",
		after: "new",
		summary: "Write review",
	});

	assert.equal(vault.files.get("Project/workspace/a.md"), "old");
	const result = await applier.apply(plan);

	assert.equal(result.status, "applied");
	assert.equal(result.plan.status, "applied");
	assert.equal(vault.files.get("Project/workspace/a.md"), "new");
});

test("MutationApplier rejects plans without changing files", async () => {
	const { createMutationPlan, MutationApplier } = await loadModules();
	const vault = createMemoryMutationVault({ "Project/workspace/a.md": "old" });
	const applier = new MutationApplier(vault.adapter);
	const plan = createMutationPlan({
		id: "plan-1",
		agentId: "agent",
		operation: "edit",
		targetPath: "Project/workspace/a.md",
		before: "old",
		after: "new",
		summary: "Edit review",
	});

	const result = await applier.reject(plan);

	assert.equal(result.status, "rejected");
	assert.equal(result.plan.status, "rejected");
	assert.equal(vault.files.get("Project/workspace/a.md"), "old");
});

test("MutationApplier marks before snapshot mismatches as conflicted and leaves files unchanged", async () => {
	const { createMutationPlan, MutationApplier } = await loadModules();
	const vault = createMemoryMutationVault({ "Project/workspace/a.md": "old" });
	const applier = new MutationApplier(vault.adapter);
	const plan = createMutationPlan({
		id: "plan-1",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/workspace/a.md",
		before: "old",
		after: "new",
		summary: "Write review",
	});

	vault.files.set("Project/workspace/a.md", "external change");
	const result = await applier.apply(plan);

	assert.equal(result.status, "conflicted");
	assert.equal(result.plan.status, "conflicted");
	assert.equal(result.reasonCode, "before_snapshot_mismatch");
	assert.deepEqual(result.reasonDetail, {
		code: "before_snapshot_mismatch",
		path: "Project/workspace/a.md",
	});
	assert.doesNotMatch(result.reason ?? "", /Before snapshot mismatch/i);
	assert.equal(vault.files.get("Project/workspace/a.md"), "external change");
});

test("MutationApplier rejects path traversal and absolute paths before writing", async () => {
	const { createMutationPlan, MutationApplier } = await loadModules();
	const vault = createMemoryMutationVault({});
	const applier = new MutationApplier(vault.adapter);
	const traversalPlan = createMutationPlan({
		id: "plan-traversal",
		agentId: "agent",
		operation: "write",
		targetPath: "../outside.md",
		before: "",
		after: "outside",
		summary: "Traversal write",
	});
	const absolutePlan = createMutationPlan({
		id: "plan-absolute",
		agentId: "agent",
		operation: "write",
		targetPath: "C:/outside.md",
		before: "",
		after: "outside",
		summary: "Absolute write",
	});

	const traversal = await applier.apply(traversalPlan);
	const absolute = await applier.apply(absolutePlan);

	assert.equal(traversal.status, "failed");
	assert.equal(traversal.reasonCode, "invalid_path");
	assert.equal(absolute.status, "failed");
	assert.equal(absolute.reasonCode, "invalid_path");
	assert.equal(vault.files.size, 0);
});

test("MutationApplier supports caller path policy and keeps rejected paths unchanged", async () => {
	const { createMutationPlan, MutationApplier } = await loadModules();
	const vault = createMemoryMutationVault({});
	const applier = new MutationApplier(vault.adapter, {
		validatePath: (filePath) => filePath.startsWith("Project/workspace/") || "Outside workspace",
	});
	const plan = createMutationPlan({
		id: "plan-raw",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/raw/a.md",
		before: "",
		after: "raw",
		summary: "Raw write",
	});

	const result = await applier.apply(plan);

	assert.equal(result.status, "failed");
	assert.equal(result.reasonCode, "invalid_path");
	assert.equal(result.reasonDetail?.detail, "Outside workspace");
	assert.equal(vault.files.has("Project/raw/a.md"), false);
});

test("MutationApplier prevents duplicate apply attempts", async () => {
	const { createMutationPlan, MutationApplier } = await loadModules();
	const vault = createMemoryMutationVault({ "Project/workspace/a.md": "old" });
	const applier = new MutationApplier(vault.adapter);
	const plan = createMutationPlan({
		id: "plan-1",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/workspace/a.md",
		before: "old",
		after: "new",
		summary: "Write review",
	});

	const applied = await applier.apply(plan);
	const duplicate = await applier.apply(applied.plan);

	assert.equal(applied.status, "applied");
	assert.equal(duplicate.status, "failed");
	assert.equal(duplicate.reasonCode, "not_pending");
	assert.equal(vault.files.get("Project/workspace/a.md"), "new");
});

test("MutationApplier returns structured apply failures without marking the plan applied", async () => {
	const { createMutationPlan, MutationApplier } = await loadModules();
	const vault = createMemoryMutationVault({ "Project/workspace/a.md": "old" });
	vault.failures.add("Project/workspace/a.md");
	const applier = new MutationApplier(vault.adapter);
	const plan = createMutationPlan({
		id: "plan-1",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/workspace/a.md",
		before: "old",
		after: "new",
		summary: "Write review",
	});

	const result = await applier.apply(plan);

	assert.equal(result.status, "failed");
	assert.equal(result.plan.status, "pending");
	assert.equal(result.reasonCode, "apply_exception");
	assert.match(result.reasonDetail?.detail ?? "", /Synthetic write failure/);
	assert.equal(vault.files.get("Project/workspace/a.md"), "old");
});

test("MutationApplier applies patch-backed persisted plans without full before or after bodies", async () => {
	const { createMutationPlan, MutationApplier, MutationPlanStore } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-mutation-applier-"));
	const persistedStorePath = path.join(root, "mutation-plans.json");
	const before = [
		"intro",
		"private vault context line one",
		"replace-this-sensitive-marker",
		"private vault context line two",
	].join("\n");
	const after = before.replace("replace-this-sensitive-marker", "safe replacement");
	const store = new MutationPlanStore({ storePath: persistedStorePath, maxPersistedContentChars: 24 });
	const plan = createMutationPlan({
		id: "plan-patch",
		agentId: "agent",
		operation: "edit",
		targetPath: "Project/workspace/private.md",
		before,
		after,
		summary: "Patch-backed edit",
	});
	await store.save(plan);
	const reloaded = await new MutationPlanStore({
		storePath: persistedStorePath,
		maxPersistedContentChars: 24,
	}).get("plan-patch");
	const vault = createMemoryMutationVault({ "Project/workspace/private.md": before });
	const applier = new MutationApplier(vault.adapter);

	assert.ok(reloaded, "expected persisted plan to reload");
	const result = await applier.apply(reloaded);

	assert.equal(result.status, "applied");
	assert.equal(vault.files.get("Project/workspace/private.md"), after);
});

test("MutationApplier applies large blob-backed persisted plans after reload", async () => {
	const { createMutationPlan, MutationApplier, MutationPlanStore } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-mutation-applier-blob-"));
	const persistedStorePath = path.join(root, "mutation-plans.json");
	const before = "old";
	const after = `large proposed body\n${"private proposed line\n".repeat(40)}END`;
	const store = new MutationPlanStore({ storePath: persistedStorePath, maxPersistedContentChars: 24 });
	const plan = createMutationPlan({
		id: "plan-blob",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/workspace/large.md",
		before,
		after,
		summary: "Blob-backed write",
	});
	await store.save(plan);

	const persistedJson = await fs.readFile(persistedStorePath, "utf8");
	assert.doesNotMatch(persistedJson, /private proposed line/);

	const reloaded = await new MutationPlanStore({
		storePath: persistedStorePath,
		maxPersistedContentChars: 24,
	}).get("plan-blob");
	const vault = createMemoryMutationVault({ "Project/workspace/large.md": before });
	const applier = new MutationApplier(vault.adapter);

	assert.ok(reloaded, "expected persisted blob-backed plan to reload");
	const result = await applier.apply(reloaded);

	assert.equal(result.status, "applied");
	assert.equal(vault.files.get("Project/workspace/large.md"), after);
});
