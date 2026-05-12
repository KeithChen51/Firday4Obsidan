/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const loopControlPath = path.join(projectRoot, "src/core/agent-kernel/AgentLoopControl.ts");

function makeTrace(overrides = {}) {
	return {
		runId: overrides.runId ?? "tool-run",
		step: overrides.step ?? 1,
		tool: overrides.tool ?? "read",
		scope: overrides.scope ?? "vault",
		targetPath: overrides.targetPath ?? "Project/workspace/a.md",
		approved: true,
		approvalReason: "No approval required",
		persistedRule: false,
		viaRule: false,
		status: overrides.status ?? "ok",
		ok: overrides.ok ?? true,
		summary: overrides.summary ?? "Read Project/workspace/a.md",
		...overrides,
	};
}

function makeResult({ tool = "read", status = "ok", data, error, recovery, trace = {}, payloadTrace } = {}) {
	const ok = status === "ok";
	return {
		trace: makeTrace({
			tool,
			status,
			ok,
			summary: ok ? `Read ${trace.targetPath ?? "Project/workspace/a.md"}` : error ?? "Tool failed.",
			error: ok ? undefined : error,
			...trace,
		}),
		payload: {
			ok,
			tool,
			status,
			...(data === undefined ? {} : { data }),
			...(error ? { error, failureClass: "invalid_input" } : {}),
			...(recovery ? { recovery } : {}),
			...(payloadTrace ? { trace: payloadTrace } : {}),
		},
		modelResultText: `TOOL_RESULT ${JSON.stringify({ ok, tool, status })}`,
	};
}

test("AgentLoopControl exports loop decision and stop reason primitives", async () => {
	const {
		AGENT_LOOP_DECISION_KINDS,
		AGENT_LOOP_STOP_REASONS,
		createAgentLoopDecision,
	} = await jiti.import(loopControlPath);

	assert.deepEqual(AGENT_LOOP_DECISION_KINDS, ["continue", "final", "safe_stop"]);
	assert.deepEqual(AGENT_LOOP_STOP_REASONS, [
		"no_progress",
		"repetition",
		"budget_exhausted",
		"permission_wait",
		"cancelled",
		"emergency_fuse",
	]);
	assert.deepEqual(createAgentLoopDecision("continue"), { kind: "continue" });
	assert.deepEqual(createAgentLoopDecision("safe_stop", { reason: "repetition" }), {
		kind: "safe_stop",
		reason: "repetition",
	});
});

test("createToolInvocationFingerprint is stable across argument order and includes result semantics", async () => {
	const { createToolInvocationFingerprint } = await jiti.import(loopControlPath);
	const first = createToolInvocationFingerprint(
		{ name: "read", args: { path: "workspace/a.md", options: { beta: true, alpha: 1 } } },
		makeResult({
			data: { content: "alpha", metadata: { lines: 1, tags: ["x"] } },
			payloadTrace: { targetPath: "Project/workspace/a.md" },
		}),
	);
	const second = createToolInvocationFingerprint(
		{ name: "read", args: { options: { alpha: 1, beta: true }, path: "workspace/a.md" } },
		makeResult({
			data: { metadata: { tags: ["x"], lines: 1 }, content: "alpha" },
			payloadTrace: { resolvedPath: "Project/workspace/a.md" },
		}),
	);

	assert.equal(first.invocationIdentity, second.invocationIdentity);
	assert.equal(first.resultIdentity, second.resultIdentity);
	assert.equal(first.tool, "read");
	assert.equal(first.resolvedTarget, "Project/workspace/a.md");
	assert.equal(first.status, "ok");
	assert.match(first.resultDigest, /^fnv1a32:/);
	assert.match(first.resultIdentity, /^read:\{/);
	assert.match(first.resultIdentity, /target=Project\/workspace\/a\.md/);
	assert.match(first.resultIdentity, /status=ok/);
	assert.match(first.resultIdentity, /digest=fnv1a32:/);
});

test("AgentLoopControlTracker detects repeated failed invocations by normalized identity", async () => {
	const { AgentLoopControlTracker } = await jiti.import(loopControlPath);
	const tracker = new AgentLoopControlTracker();
	const failedResult = makeResult({
		status: "failed",
		error: "Vault file was not found.",
		trace: { status: "failed", ok: false, targetPath: "workspace/missing.md" },
	});

	tracker.recordResult({ name: "read", args: { path: "workspace/missing.md", options: { beta: true, alpha: 1 } } }, failedResult);
	const repetition = tracker.beforeInvocation({
		name: "read",
		args: { options: { alpha: 1, beta: true }, path: "workspace/missing.md" },
	});

	assert.equal(repetition?.kind, "repeated_failed_invocation");
	assert.equal(repetition.stopReason, "repetition");
	assert.equal(repetition.fingerprint.invocationIdentity, "read:{\"options\":{\"alpha\":1,\"beta\":true},\"path\":\"workspace/missing.md\"}");
	assert.equal(repetition.previous.result.payload.error, "Vault file was not found.");
});

test("AgentLoopControlTracker identifies ignored recovery suggestions and preserves recovery metadata", async () => {
	const { AgentLoopControlTracker } = await jiti.import(loopControlPath);
	const tracker = new AgentLoopControlTracker();
	const recovery = {
		recoverable: true,
		retryable: false,
		code: "vault_file_not_found",
		message: "A likely active-project path exists.",
		suggestedArgs: { path: "Project/workspace/missing.md" },
		candidatePaths: ["Project/workspace/missing.md"],
	};

	tracker.recordResult(
		{ name: "read", args: { path: "workspace/missing.md" } },
		makeResult({
			status: "failed",
			error: "Vault file was not found.",
			recovery,
			trace: { status: "failed", ok: false, targetPath: "workspace/missing.md" },
		}),
	);
	const repetition = tracker.beforeInvocation({ name: "read", args: { path: "workspace/missing.md" } });

	assert.equal(repetition?.kind, "ignored_recovery_suggestion");
	assert.equal(repetition.stopReason, "repetition");
	assert.deepEqual(repetition.recovery?.suggestedArgs, { path: "Project/workspace/missing.md" });
	assert.deepEqual(repetition.recovery?.candidatePaths, ["Project/workspace/missing.md"]);

	recovery.suggestedArgs.path = "mutated";
	recovery.candidatePaths.push("mutated");
	assert.deepEqual(repetition.recovery?.suggestedArgs, { path: "Project/workspace/missing.md" });
	assert.deepEqual(repetition.recovery?.candidatePaths, ["Project/workspace/missing.md"]);
});

test("AgentLoopControlTracker detects unchanged successful read/list/search observations after execution", async () => {
	const { AgentLoopControlTracker } = await jiti.import(loopControlPath);
	const tracker = new AgentLoopControlTracker();
	const tool = { name: "search", args: { query: "loop control", root: "Project" } };
	const firstResult = makeResult({
		tool: "search",
		data: { matches: [{ path: "Project/a.md", line: 1, text: "loop control" }] },
		trace: { tool: "search", targetPath: "Project" },
		payloadTrace: { targetPath: "Project" },
	});
	const secondResult = makeResult({
		tool: "search",
		data: { matches: [{ text: "loop control", line: 1, path: "Project/a.md" }] },
		trace: { tool: "search", targetPath: "Project" },
		payloadTrace: { targetPath: "Project" },
	});

	assert.equal(tracker.recordResult(tool, firstResult), undefined);
	const repetition = tracker.recordResult(tool, secondResult);

	assert.equal(repetition?.kind, "repeated_unchanged_observation");
	assert.equal(repetition.stopReason, "no_progress");
	assert.equal(repetition.fingerprint.status, "ok");
	assert.equal(repetition.fingerprint.resolvedTarget, "Project");
	assert.equal(repetition.previous.result.payload.data.matches[0].path, "Project/a.md");
});
