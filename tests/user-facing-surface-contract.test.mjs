/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

import {
	assertNoBannedOrdinaryTerms,
	collectLeafTextMatches,
} from "./helpers/ordinarySurfaceContract.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const presenterPath = path.join(projectRoot, "src/views/agentUserFacingPresenter.ts");
const planPath = path.join(projectRoot, "src/core/mutations/MutationPlan.ts");
const applierPath = path.join(projectRoot, "src/core/mutations/MutationApplier.ts");
const projectorPath = path.join(projectRoot, "src/core/trajectory/AgentTrajectoryProjector.ts");

async function loadPresenter() {
	return jiti.import(presenterPath);
}

async function loadMutationModules() {
	const [planModule, applierModule] = await Promise.all([
		jiti.import(planPath),
		jiti.import(applierPath),
	]);
	return {
		createMutationPlan: planModule.createMutationPlan,
		MutationApplier: applierModule.MutationApplier,
	};
}

async function loadProjector() {
	return jiti.import(projectorPath);
}

test("user-facing presenter maps task states and actions to ordinary product copy", async () => {
	const {
		formatUserFacingTaskStatus,
		formatUserFacingTaskAction,
		productizeRuntimeText,
	} = await loadPresenter();

	const visibleCopy = [
		formatUserFacingTaskStatus("waiting_for_approval"),
		formatUserFacingTaskStatus("waiting_for_user"),
		formatUserFacingTaskStatus("failed"),
		...["cancel", "continue", "apply", "reject", "resume", "retry"].map((action) =>
			formatUserFacingTaskAction(action).label
		),
		productizeRuntimeText("Waiting for approval"),
		productizeRuntimeText("Waiting for review of 1 pending file change(s)."),
		productizeRuntimeText("Before snapshot mismatch for Project/a.md."),
		productizeRuntimeText("Pending file changes: 1 change(s) prepared but not applied."),
		productizeRuntimeText("原始错误：Error: Request failed, status 503"),
		productizeRuntimeText("Error: net::ERR_CONNECTION_CLOSED"),
		productizeRuntimeText("模型服务或网关暂时不可用（503）。这通常是临时性网络/网关故障，不是协议不兼容。"),
	].join("\n");

	assert.match(visibleCopy, /等待|确认|修改|重试|停止/);
	assertNoBannedOrdinaryTerms(visibleCopy, "presenter output");
});

test("MutationApplier exposes structured reason codes before user-facing copy is rendered", async () => {
	const { createMutationPlan, MutationApplier } = await loadMutationModules();
	const files = new Map([["Project/workspace/a.md", "old"]]);
	const applier = new MutationApplier({
		async read(filePath) {
			return files.get(filePath) ?? null;
		},
		async write(filePath, content) {
			files.set(filePath, content);
		},
		async delete(filePath) {
			files.delete(filePath);
		},
	});
	const plan = createMutationPlan({
		id: "plan-conflict",
		agentId: "agent",
		operation: "write",
		targetPath: "Project/workspace/a.md",
		before: "old",
		after: "new",
		summary: "Write review",
	});

	files.set("Project/workspace/a.md", "external change");
	const result = await applier.apply(plan);

	assert.equal(result.status, "conflicted");
	assert.equal(result.reasonCode, "before_snapshot_mismatch");
	assert.deepEqual(result.reasonDetail, {
		code: "before_snapshot_mismatch",
		path: "Project/workspace/a.md",
	});
	assertNoBannedOrdinaryTerms(result.reason ?? "", "mutation compatibility reason");
});

test("trajectory projector ordinary text does not expose checkpoint or replay controls", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{
			phase: "checkpoint",
			depth: 0,
			message: "Checkpoint saved at context_ready.",
			checkpoint: {
				type: "saved",
				checkpointId: "checkpoint-1",
				boundary: "context_ready",
			},
		},
	]);
	const ordinaryText = [
		snapshot.headline,
		snapshot.summary,
		...snapshot.items.flatMap((item) => [item.title, item.detail]),
		...snapshot.actions.map((action) => action.label),
	].join("\n");

	assertNoBannedOrdinaryTerms(ordinaryText, "trajectory ordinary text");
});

test("trajectory projector hides resume when the latest checkpoint is not auto-resumable", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{
			phase: "checkpoint",
			depth: 0,
			message: "Checkpoint saved at context_ready.",
			checkpoint: {
				type: "saved",
				checkpointId: "checkpoint-safe",
				boundary: "context_ready",
				canAutoResume: true,
			},
		},
		{
			phase: "checkpoint",
			depth: 0,
			message: "Checkpoint saved after tool result.",
			checkpoint: {
				type: "saved",
				checkpointId: "checkpoint-after-tool",
				boundary: "after_tool_result",
				canAutoResume: false,
			},
		},
		{
			phase: "model_retry",
			depth: 0,
			step: 3,
			message: "请求多次未成功，请稍后重试。",
			transport: {
				type: "request_exhausted",
				requestId: "request-1",
				attempt: 6,
				maxAttempts: 6,
				retryable: false,
				channel: "chat_with_tools",
				endpointIndex: 0,
				endpointCount: 1,
			},
		},
	]);

	assert.deepEqual(snapshot.actions.map((action) => action.id), ["retry"]);
});

test("trajectory projector productizes live model-request progress", async () => {
	const { projectRuntimeProgress } = await loadProjector();

	const snapshot = projectRuntimeProgress([
		{
			phase: "model_request",
			depth: 0,
			step: 1,
			message: "Step 1: requesting model decision (native tools)",
		},
	]);
	const ordinaryText = [
		snapshot.headline,
		snapshot.summary,
		...snapshot.items.flatMap((item) => [item.title, item.detail]),
	].join("\n");

	assert.match(ordinaryText, /FRIDAY|理解|整理|处理/);
	assertNoBannedOrdinaryTerms(ordinaryText, "live model-request process text");
});

test("leaf-node scanner reports only visible leaf text matches", () => {
	const child = { textContent: "Waiting for approval", children: [], tagName: "SPAN", className: "leaf" };
	const parent = { textContent: "Wrapper Waiting for approval", children: [child], tagName: "DIV", className: "parent" };
	const root = {
		querySelectorAll() {
			return [parent, child];
		},
	};

	assert.deepEqual(collectLeafTextMatches(root), [
		{ tag: "SPAN", className: "leaf", text: "Waiting for approval" },
	]);
});
