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

test("renderAgentTrajectoryCard collapsed view shows headline and last three trajectory items", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			headline: "Agent finished",
			items: Array.from({ length: 5 }, (_, index) => makeItem(index + 1)),
		}),
		variant: "live",
		expanded: false,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /Agent finished/);
	assert.doesNotMatch(root.textContent, /Item 1(?![0-9])/);
	assert.doesNotMatch(root.textContent, /Item 2(?![0-9])/);
	assert.match(root.textContent, /Item 3/);
	assert.match(root.textContent, /Item 4/);
	assert.match(root.textContent, /Item 5/);
	assert.equal(root.countByClass("friday-runtime-card-collapsed"), 1);
	assert.equal(root.countByClass("friday-runtime-pill"), 3);
});

test("renderAgentTrajectoryCard expanded view shows stage rail and latest ten timeline items", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			items: Array.from({ length: 12 }, (_, index) => makeItem(index + 1)),
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.equal(root.countByClass("friday-runtime-stage-rail"), 1);
	assert.equal(root.countByClass("friday-runtime-stage"), 5);
	assert.equal(root.countByClass("friday-runtime-entry"), 10);
	assert.doesNotMatch(root.textContent, /Item 1(?![0-9])/);
	assert.doesNotMatch(root.textContent, /Item 2(?![0-9])/);
	assert.match(root.textContent, /Item 12/);
	assert.equal(root.countByClass("friday-ai-runtime-preview"), 1);
});

test("renderAgentTrajectoryCard exposes waiting approval state visually", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "waiting_for_approval",
			headline: "Waiting for approval",
			summary: "Approve write.",
			items: [
				{
					id: "approval-1",
					kind: "approval",
					title: "Approval required",
					detail: "Approve write.",
					status: "waiting",
					tool: "write",
					targetPath: "Notes/today.md",
				},
			],
		}),
		variant: "live",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /Waiting for approval/);
	assert.match(root.textContent, /Approval required/);
	assert.ok(root.hasClassInTree("is-waiting"));
});

test("renderAgentTrajectoryCard exposes failed snapshot failure summary", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
			status: "failed",
			headline: "Agent failed",
			summary: "Runtime failed.",
			failure: {
				class: "tool",
				message: "grep failed.",
				retryable: true,
				recoverable: true,
			},
			items: [
				{
					id: "failure-1",
					kind: "failure",
					title: "Run failed",
					detail: "grep failed.",
					status: "failed",
				},
			],
		}),
		variant: "completed",
		expanded: true,
		onToggle: () => {},
		translate,
		renderAssistantAvatar: (containerEl) => containerEl.createDiv({ cls: "avatar", text: "A" }),
	});

	assert.match(root.textContent, /Agent failed/);
	assert.match(root.textContent, /grep failed/);
	assert.ok(root.hasClassInTree("is-failed"));
});

test("renderAgentTrajectoryCard renders trajectory actions without deciding availability", async () => {
	const { renderAgentTrajectoryCard } = await loadRenderer();
	const root = new FakeElement("div");
	const calls = [];

	renderAgentTrajectoryCard({
		containerEl: root,
		snapshot: makeSnapshot({
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

	assert.match(root.textContent, /Retry/);
	assert.match(root.textContent, /Apply/);
	assert.equal(root.countByClass("friday-runtime-action"), 2);
	assert.equal(root.findByClass("is-retry")?.disabled, false);
	assert.equal(root.findByClass("is-apply")?.disabled, true);
	root.findByClass("is-retry")?.onclick?.();
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
			status: key === "review" ? "pending" : "ok",
			itemIds: [],
		})),
		items: [makeItem(1)],
		actions: [],
		mutations: [],
		privacy: { redacted: true, source: "live" },
		...overrides,
	};
}

function makeItem(index) {
	return {
		id: `item-${index}`,
		kind: index % 2 === 0 ? "tool" : "model",
		title: `Item ${index}`,
		detail: `Detail ${index}`,
		status: "ok",
		step: index,
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
