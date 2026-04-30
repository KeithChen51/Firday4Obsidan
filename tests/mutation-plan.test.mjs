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
const storePath = path.join(projectRoot, "src/core/mutations/MutationPlanStore.ts");

async function loadModules() {
	const [planModule, storeModule] = await Promise.all([
		jiti.import(planPath),
		jiti.import(storePath),
	]);
	return {
		createMutationPlan: planModule.createMutationPlan,
		hashMutationContent: planModule.hashMutationContent,
		MutationPlanStore: storeModule.MutationPlanStore,
	};
}

test("createMutationPlan creates a pending reviewable write plan with before and proposed hashes", async () => {
	const { createMutationPlan, hashMutationContent } = await loadModules();

	const plan = createMutationPlan({
		id: "plan-1",
		conversationId: "agent",
		turnId: "turn-1",
		toolCallId: "tool-1",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/workspace/a.md",
		before: "old",
		after: "new",
		summary: "Update note body",
	});

	assert.equal(plan.id, "plan-1");
	assert.equal(plan.conversationId, "agent");
	assert.equal(plan.turnId, "turn-1");
	assert.equal(plan.toolCallId, "tool-1");
	assert.equal(plan.operation, "write");
	assert.equal(plan.targetPath, "Project/workspace/a.md");
	assert.equal(plan.status, "pending");
	assert.equal(plan.riskLevel, "standard");
	assert.equal(plan.beforeHash, hashMutationContent("old"));
	assert.equal(plan.proposedHash, hashMutationContent("new"));
	assert.equal(plan.items.length, 1);
	assert.equal(plan.items[0].status, "pending");
	assert.equal(plan.items[0].beforeHash, hashMutationContent("old"));
	assert.equal(plan.items[0].afterHash, hashMutationContent("new"));
});

test("createMutationPlan marks delete operations as high risk", async () => {
	const { createMutationPlan } = await loadModules();

	const plan = createMutationPlan({
		id: "delete-plan",
		agentId: "agent",
		operation: "delete",
		targetPath: "Project/workspace/a.md",
		before: "existing",
		after: "",
		summary: "Delete note",
	});

	assert.equal(plan.riskLevel, "high");
	assert.equal(plan.status, "pending");
	assert.equal(plan.items[0].changeType, "delete");
});

test("MutationPlanStore saves immutable copies and updates plan status", async () => {
	const { createMutationPlan, MutationPlanStore } = await loadModules();
	const store = new MutationPlanStore();
	const plan = createMutationPlan({
		id: "plan-1",
		agentId: "agent",
		operation: "edit",
		targetPath: "Project/workspace/a.md",
		before: "before",
		after: "after",
		summary: "Edit note",
	});

	await store.save(plan);
	plan.status = "applied";

	const stored = await store.get("plan-1");
	assert.equal(stored?.status, "pending");
	await store.markStatus("plan-1", "rejected");
	assert.equal((await store.get("plan-1"))?.status, "rejected");
	assert.equal((await store.list()).length, 1);
});

test("MutationPlanStore persists plans and supports conversation turn and pending queries", async () => {
	const { createMutationPlan, MutationPlanStore } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-mutation-plans-"));
	const storePath = path.join(root, "mutation-plans.json");
	const firstStore = new MutationPlanStore({ storePath });
	const pending = createMutationPlan({
		id: "plan-pending",
		agentId: "agent",
		conversationId: "agent",
		turnId: "turn-1",
		operation: "write",
		targetPath: "Project/workspace/a.md",
		before: "before",
		after: "after",
		summary: "Persist pending plan",
	});
	const rejected = createMutationPlan({
		id: "plan-rejected",
		agentId: "agent",
		conversationId: "agent",
		turnId: "turn-2",
		operation: "edit",
		targetPath: "Project/workspace/b.md",
		before: "before",
		after: "after",
		summary: "Persist rejected plan",
	});

	await firstStore.save(pending);
	await firstStore.save(rejected);
	await firstStore.markStatus("plan-rejected", "rejected");

	const reloadedStore = new MutationPlanStore({ storePath });
	assert.deepEqual((await reloadedStore.getPending()).map((plan) => plan.id), ["plan-pending"]);
	assert.deepEqual((await reloadedStore.getByTurnId("turn-1")).map((plan) => plan.id), ["plan-pending"]);
	assert.deepEqual(
		(await reloadedStore.getByConversationId("agent")).map((plan) => plan.id).sort(),
		["plan-pending", "plan-rejected"],
	);
});

test("MutationPlanStore persists bounded patch metadata instead of full vault bodies", async () => {
	const { createMutationPlan, MutationPlanStore } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-mutation-privacy-"));
	const storePath = path.join(root, "mutation-plans.json");
	const before = [
		"intro",
		"private vault context line one",
		"private vault context line two",
		"replace-this-sensitive-marker",
		"private vault context line three",
		"outro",
	].join("\n");
	const after = before.replace("replace-this-sensitive-marker", "safe replacement");
	const store = new MutationPlanStore({ storePath, maxPersistedContentChars: 24 });
	const plan = createMutationPlan({
		id: "plan-private",
		agentId: "agent",
		conversationId: "agent",
		turnId: "turn-private",
		operation: "edit",
		targetPath: "Project/workspace/private.md",
		before,
		after,
		summary: "Persist bounded private edit",
	});

	await store.save(plan);

	const raw = await fs.readFile(storePath, "utf8");
	assert.doesNotMatch(raw, /private vault context line one/);
	assert.doesNotMatch(raw, /replace-this-sensitive-marker/);
	assert.match(raw, /safe replacement/);
	assert.match(raw, /proposedPatch/);

	const reloadedStore = new MutationPlanStore({ storePath, maxPersistedContentChars: 24 });
	const reloaded = await reloadedStore.get("plan-private");
	assert.equal(reloaded?.items[0].before, "");
	assert.equal(reloaded?.items[0].after, "");
	assert.equal(reloaded?.items[0].contentStorage?.before, "omitted");
	assert.equal(reloaded?.items[0].contentStorage?.after, "patch");
	assert.equal(reloaded?.items[0].proposedPatch?.insert, "safe replacement");
});

test("MutationPlanStore persists large proposed content in a hidden blob and hydrates it on reload", async () => {
	const { createMutationPlan, MutationPlanStore } = await loadModules();
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-mutation-blob-"));
	const storePath = path.join(root, "mutation-plans.json");
	const before = "short original";
	const after = `large proposed body\n${"private proposed line\n".repeat(40)}END`;
	const store = new MutationPlanStore({ storePath, maxPersistedContentChars: 24 });
	const plan = createMutationPlan({
		id: "plan-blob",
		agentId: "agent",
		conversationId: "agent",
		turnId: "turn-blob",
		operation: "write",
		targetPath: "Project/workspace/large.md",
		before,
		after,
		summary: "Persist large write",
	});

	await store.save(plan);

	const raw = await fs.readFile(storePath, "utf8");
	assert.doesNotMatch(raw, /private proposed line/);
	assert.match(raw, /"after": "blob"/);
	assert.match(raw, /"proposedBlob"/);

	const reloadedStore = new MutationPlanStore({ storePath, maxPersistedContentChars: 24 });
	const reloaded = await reloadedStore.get("plan-blob");
	assert.equal(reloaded?.items[0].before, "");
	assert.equal(reloaded?.items[0].after, after);
	assert.equal(reloaded?.items[0].contentStorage?.before, "omitted");
	assert.equal(reloaded?.items[0].contentStorage?.after, "blob");
	assert.equal(reloaded?.items[0].proposedBlob?.size, after.length);
});
