/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const rendererPath = path.join(projectRoot, "src/views/agentTrajectoryRenderer.ts");
const dailyBoardPath = path.join(projectRoot, "src/views/DailyBoardView.ts");

async function loadRenderer() {
	return jiti.import(rendererPath);
}

test("DailyBoard live process UI is wired to trajectory snapshots instead of runtime execution state", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");

	assert.match(source, /LiveTrajectoryStore/);
	assert.match(source, /AgentTrajectorySnapshot/);
	assert.match(source, /renderAgentTrajectoryCard/);
	assert.match(source, /onAction: \(action\) => this\.handleTrajectoryAction\(snapshot, action\)/);
	assert.match(source, /private handleTrajectoryAction\(\s*snapshot: AgentTrajectorySnapshot,\s*action: AgentTrajectoryAction,/);
	assert.match(source, /private aiRuntimeTrajectoryStore = new LiveTrajectoryStore\(\)/);
	assert.match(source, /private aiRuntimeTrajectorySnapshot: AgentTrajectorySnapshot \| null = null/);
	assert.match(source, /private aiLastCompletedTrajectorySnapshot: AgentTrajectorySnapshot \| null = null/);
	assert.doesNotMatch(source, /private aiRuntimeExecutionState:/);
	assert.doesNotMatch(source, /private buildRuntimeExecutionState\(/);

	const progressMatch = source.match(/private handleRuntimeProgress\(event: RuntimeProgressEvent\): void \{([\s\S]*?)\n\t\}/);
	assert.ok(progressMatch, "handleRuntimeProgress should exist");
	const progressBlock = progressMatch[1] ?? "";
	assert.match(progressBlock, /aiRuntimeTrajectoryStore\.appendProgress\(event\)/);
	assert.doesNotMatch(progressBlock, /switch \(event\.phase\)/);
	assert.doesNotMatch(progressBlock, /buildRuntimeExecutionState/);
});

test("DailyBoard completed process disclosure is rebuilt from replay summary when available", () => {
	const source = fs.readFileSync(dailyBoardPath, "utf8").replace(/\r\n?/g, "\n");

	assert.match(source, /projectReplaySummary/);
	assert.match(source, /readTurnReplaySummary/);
	assert.match(source, /private async buildCompletedTrajectorySnapshot\(/);
	assert.match(source, /const summary = await this\.plugin\.agentRuntimeService\.readTurnReplaySummary/);
	assert.match(source, /return projectReplaySummary\(summary\)/);
	assert.match(source, /this\.aiLastCompletedTrajectorySnapshot = await this\.buildCompletedTrajectorySnapshot\(runtimeResult\)/);
});

test("renderAgentTrajectoryCard uses lightweight thinking for simple live answers", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "running",
			headline: "Agent is reasoning",
			summary: "Thinking through the answer.",
			items: [
				makeItem({ id: "model", kind: "model", title: "Model step 1", detail: "Thinking.", status: "running" }),
			],
		}),
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-thinking"), 1);
	assert.equal(root.countByClass("friday-agent-process"), 0);
	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
	assert.equal(root.countByClass("friday-agent-process-evidence"), 0);
	assert.match(root.textContent, /FRIDAY is thinking/);
});

test("renderAgentTrajectoryCard collapsed process panel shows status current summary action and details toggle", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const calls = [];

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "running",
			headline: "Agent is using a tool",
			summary: "Reading project notes.",
			items: [
				makeItem({ id: "tool", kind: "tool", title: "Read Notes/today.md", detail: "Reading project notes.", status: "running", tool: "read", targetPath: "Notes/today.md", step: 2 }),
			],
			actions: [
				{ id: "cancel", label: "Cancel", enabled: true, targetId: "task-1" },
			],
		}),
		variant: "live",
		expanded: false,
		onToggle: () => calls.push("toggle"),
		onAction: (action) => calls.push(action.id),
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process"), 1);
	assert.equal(root.countByClass("friday-runtime-card"), 0);
	assert.match(root.textContent, /Working/);
	assert.match(root.textContent, /Read Notes\/today\.md/);
	assert.match(root.textContent, /Reading project notes/);
	assert.equal(root.countByClass("friday-agent-process-action"), 1);
	assert.equal(root.findByClass("friday-agent-process-toggle")?.attributes["aria-expanded"], "false");
	root.findByClass("friday-agent-process-toggle")?.onclick?.();
	root.findByClass("friday-agent-process-action")?.onclick?.();
	assert.deepEqual(calls, ["toggle", "cancel"]);
});

test("renderAgentTrajectoryCard expanded process panel shows stages current timeline evidence mutations recovery and actions", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "failed",
			headline: "Agent failed",
			summary: "Write failed.",
			failure: { class: "mutation", message: "Permission denied.", retryable: true, recoverable: true },
			items: [
				makeItem({ id: "context", kind: "context", title: "Loaded project rules", status: "ok" }),
				makeItem({ id: "tool", kind: "tool", title: "Read Notes/A.md", detail: "Read note.", status: "ok", tool: "read", targetPath: "Notes/A.md", step: 1 }),
				makeItem({ id: "mutation", kind: "mutation", title: "write Notes/B.md", detail: "Permission denied.", status: "failed", targetPath: "Notes/B.md", step: 2 }),
			],
			mutations: [
				{ id: "m1", event: "apply_failed", operation: "write", targetPath: "Notes/B.md", status: "failed", summary: "Write failed.", reason: "Permission denied." },
			],
			actions: [
				{ id: "retry", label: "Retry", enabled: true, targetId: "task-1" },
			],
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-stages"), 1);
	assert.equal(root.countByClass("friday-agent-process-current"), 1);
	assert.equal(root.countByClass("friday-agent-process-timeline"), 1);
	assert.equal(root.countByClass("friday-agent-process-evidence"), 1);
	assert.equal(root.countByClass("friday-agent-process-mutations"), 1);
	assert.equal(root.countByClass("friday-agent-process-recovery"), 1);
	assert.equal(root.countByClass("friday-agent-process-step"), 3);
	assert.match(root.textContent, /Notes\/A\.md/);
	assert.match(root.textContent, /Permission denied/);
});

test("renderAgentTrajectoryCard renders Batch M.1 transport retry as reconnecting without checkpoint claims", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
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
		}),
		variant: "live",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.ok(root.hasClassInTree("is-reconnecting"));
	assert.match(root.textContent, /Reconnecting/);
	assert.match(root.textContent, /attempt 1\/4/);
	assert.match(root.textContent, /700ms/);
	assert.doesNotMatch(root.textContent, /checkpoint|resume/i);
});

test("renderAgentTrajectoryCard renders completed replay as collapsed process disclosure", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "completed",
			headline: "Agent finished",
			summary: "Created a sourced answer.",
			privacy: { redacted: true, source: "replay" },
			items: [
				makeItem({ id: "read", kind: "tool", title: "read Notes/A.md", detail: "Read note.", status: "ok", tool: "read", targetPath: "Notes/A.md", step: 1 }),
				makeItem({ id: "final", kind: "final", title: "Final response", detail: "Created a sourced answer.", status: "ok" }),
			],
		}),
		variant: "completed",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process"), 1);
	assert.match(root.textContent, /Completed/);
	assert.match(root.textContent, /Agent finished/);
	assert.equal(root.countByClass("friday-agent-process-stages"), 0);
});

test("renderAgentTrajectoryCard renders trajectory actions without deciding availability", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const calls = [];

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "failed",
			failure: { class: "tool", message: "grep failed.", retryable: true, recoverable: true },
			items: [
				makeItem({ id: "failure", kind: "failure", title: "Run failed", detail: "grep failed.", status: "failed" }),
			],
			actions: [
				{ id: "retry", label: "Retry", enabled: true, targetId: "task-1" },
				{ id: "apply", label: "Apply", enabled: false, reason: "No pending mutation.", targetId: "plan-1" },
			],
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		onAction: (action) => calls.push(action.id),
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-agent-process-action"), 2);
	assert.equal(root.findByClass("is-retry")?.disabled, false);
	assert.equal(root.findByClass("is-apply")?.disabled, true);
	assert.equal(root.findByClass("is-apply")?.attributes.title, "No pending mutation.");
	root.findByClass("is-retry")?.onclick?.();
	root.findByClass("is-apply")?.onclick?.();
	assert.deepEqual(calls, ["retry"]);
});

test("renderAgentTrajectoryCard renders nothing for an empty snapshot", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: null,
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.children.length, 0);
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

function translate(_key, fallback, params = {}) {
	let text = fallback ?? "";
	for (const [key, value] of Object.entries(params)) {
		text = text.replace(`{${key}}`, String(value));
	}
	return text;
}

class FakeElement {
	constructor(tagName, options = {}) {
		this.tagName = tagName;
		this.children = [];
		this.classes = new Set();
		this.attributes = {};
		this.text = "";
		this.onclick = undefined;
		this.disabled = false;
		this.type = "";
		if (typeof options.cls === "string") {
			this.addClasses(options.cls);
		}
		if (typeof options.text === "string") {
			this.text = options.text;
		}
		if (options.attr) {
			this.attributes = { ...options.attr };
		}
	}

	createDiv(options = {}) {
		return this.createChild("div", normalizeOptions(options));
	}

	createEl(tagName, options = {}) {
		return this.createChild(tagName, normalizeOptions(options));
	}

	createSpan(options = {}) {
		return this.createChild("span", normalizeOptions(options));
	}

	addClass(className) {
		this.addClasses(className);
	}

	empty() {
		this.children = [];
		this.text = "";
	}

	setText(text) {
		this.text = text;
	}

	get textContent() {
		return [this.text, ...this.children.map((child) => child.textContent)].filter(Boolean).join(" ");
	}

	countByClass(className) {
		return (this.classes.has(className) ? 1 : 0) +
			this.children.reduce((sum, child) => sum + child.countByClass(className), 0);
	}

	hasClassInTree(className) {
		return this.classes.has(className) || this.children.some((child) => child.hasClassInTree(className));
	}

	findByClass(className) {
		if (this.classes.has(className)) {
			return this;
		}
		for (const child of this.children) {
			const found = child.findByClass(className);
			if (found) {
				return found;
			}
		}
		return null;
	}

	createChild(tagName, options) {
		const child = new FakeElement(tagName, options);
		this.children.push(child);
		return child;
	}

	addClasses(className) {
		for (const item of className.split(/\s+/).filter(Boolean)) {
			this.classes.add(item);
		}
	}
}

function normalizeOptions(options) {
	if (typeof options === "string") {
		return { cls: options };
	}
	return options ?? {};
}
