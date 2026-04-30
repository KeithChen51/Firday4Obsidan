# Agent Kernel Maturity Implementation Plan

> **Superseded by:** `docs/plans/2026-04-30-agent-harness-product-maturity.md`.
> This file remains useful as a lower-level implementation reference, but the latest execution order is Harness first, then ToolRegistry/Policy/EventLog/Mutation Review, then product task lifecycle. AI agents should read the Harness/Product maturity plan first to avoid stale sequencing.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move FRIDAY from a feature-heavy Obsidian AI plugin toward a mature, reliable Agent runtime before adding complex Wiki, RAG, background automation, MCP, or multi-agent features.

**Architecture:** Treat the Agent runtime as the product core. Consolidate tool definitions into one registry, persist every turn as replayable events, route write operations through plan-review-apply, harden capability policy, and add realistic runtime tests with fake model responses. Keep Wiki and other add-on features gated until the kernel passes maturity checks.

**Tech Stack:** TypeScript, Obsidian plugin APIs, Node test runner (`node --test`), esbuild, existing FRIDAY services under `src/core`, `src/services`, `src/platform`, and tests under `tests/*.mjs`.

---

## Principles

- Do not add new complex Agent-facing features during this plan.
- Do not broaden tool surface until the registry, policy, and audit path are stable.
- Prefer mature Agent behavior over flashy UI: deterministic tool contracts, replayable execution, reviewable edits, scoped permissions, and failure recovery.
- Use obsidian-yolo only as a reference for concepts: `AgentToolGateway`, local file tools, apply review, context compaction, and tool boundary filtering. Do not copy its broad feature scope.
- Keep releases safe: every milestone must pass existing tests and add at least one behavioral test that would fail under the current runtime.

## Milestone 0: Freeze The Add-On Surface

### Task 1: Add Runtime Maturity Gate Documentation

**Files:**
- Create: `docs/plans/agent-kernel-maturity-gates.md`
- Modify: `CHANGELOG.md`

**Step 1: Write the gate document**

Create `docs/plans/agent-kernel-maturity-gates.md`:

```markdown
# Agent Kernel Maturity Gates

FRIDAY will not add new Agent-facing Wiki, RAG, MCP, background automation, multi-agent, cron, or external tool marketplace features until these gates are true:

1. Tool definitions have a single registry source.
2. Runtime turns are persisted as replayable step events.
3. File writes go through plan-review-apply unless explicit auto mode is enabled.
4. Permission policy is capability-based and tested.
5. Context compaction is token-aware and preserves tool boundaries.
6. Fake-model Agent E2E tests cover read, write, deny, retry, context overflow, and recovery paths.

Existing hidden or disabled code may remain, but it must not become user-facing until these gates pass.
```

**Step 2: Add changelog note**

Add an unreleased note to `CHANGELOG.md`:

```markdown
- Documented Agent Kernel maturity gates and paused new Agent-facing add-on surfaces until the runtime is hardened.
```

**Step 3: Verify**

Run:

```powershell
npm test -- --test-name-pattern "agent|runtime|tool|context"
```

Expected: existing matching tests pass, or the command fails only because Node's test runner does not support the extra pattern in this repo. If unsupported, run:

```powershell
node --test tests/agent-runtime-*.test.mjs tests/execution-*.test.mjs tests/tool-*.test.mjs tests/context-assembler.test.mjs
```

**Step 4: Commit**

```powershell
git add docs/plans/agent-kernel-maturity-gates.md CHANGELOG.md
git commit -m "docs: define agent kernel maturity gates"
```

---

## Milestone 1: Single Tool Registry

### Task 2: Create A First-Class Tool Registry

**Files:**
- Create: `src/core/tools/ToolRegistry.ts`
- Modify: `src/platform/tools/ToolManifestCatalog.ts`
- Test: `tests/tool-registry.test.mjs`

**Step 1: Write the failing test**

Create `tests/tool-registry.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

const modulePath = "../src/core/tools/ToolRegistry.ts";

test("tool registry exposes one canonical record per runtime tool", async () => {
	const mod = await import(modulePath);
	const registry = mod.createDefaultToolRegistry({ wikiEnabled: false, execEnabled: false });
	const tools = registry.list();
	const names = tools.map((tool) => tool.name);
	assert.deepEqual([...new Set(names)], names);
	assert.ok(registry.get("read"));
	assert.ok(registry.get("write"));
	assert.equal(registry.get("compile_wiki"), null);
	assert.equal(registry.get("exec"), null);
});

test("tool registry derives native tool schemas from canonical definitions", async () => {
	const mod = await import(modulePath);
	const registry = mod.createDefaultToolRegistry({ wikiEnabled: true, execEnabled: true });
	const nativeTools = registry.toNativeToolDefinitions();
	const read = nativeTools.find((tool) => tool.name === "read");
	assert.ok(read);
	assert.equal(read.parameters.type, "object");
	assert.ok(nativeTools.some((tool) => tool.name === "compile_wiki"));
	assert.ok(nativeTools.some((tool) => tool.name === "exec"));
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/tool-registry.test.mjs
```

Expected: FAIL because `src/core/tools/ToolRegistry.ts` does not exist.

**Step 3: Implement minimal registry**

Create `src/core/tools/ToolRegistry.ts` with:

```ts
import type { ToolDefinition } from "../../types/tools";

export type ToolCapability =
	| "skill.load"
	| "filesystem.list"
	| "filesystem.read"
	| "filesystem.search"
	| "filesystem.write"
	| "filesystem.patch"
	| "filesystem.delete"
	| "memory.write"
	| "knowledge.compile"
	| "system.exec";

export type ToolRisk = "read" | "write" | "delete" | "exec";

export interface RuntimeToolRecord {
	name: string;
	capability: ToolCapability;
	risk: ToolRisk;
	primary: boolean;
	description: string;
	parameters: ToolDefinition["parameters"];
	relatedSkillCommand?: string;
	featureFlag?: "wiki" | "exec";
}

export interface ToolRegistryOptions {
	wikiEnabled: boolean;
	execEnabled: boolean;
	disabledTools?: string[];
	allowedTools?: string[];
}

export class ToolRegistry {
	constructor(private readonly records: RuntimeToolRecord[]) {}

	list(): RuntimeToolRecord[] {
		return [...this.records];
	}

	get(name: string): RuntimeToolRecord | null {
		const normalized = name.trim().toLowerCase();
		return this.records.find((record) => record.name === normalized) ?? null;
	}

	toNativeToolDefinitions(): ToolDefinition[] {
		return this.records.map((record) => ({
			name: record.name,
			description: record.description,
			parameters: record.parameters,
		}));
	}
}

export function createDefaultToolRegistry(options: ToolRegistryOptions): ToolRegistry {
	const disabled = new Set((options.disabledTools ?? []).map((item) => item.trim().toLowerCase()).filter(Boolean));
	const allowed = options.allowedTools?.length
		? new Set(options.allowedTools.map((item) => item.trim().toLowerCase()).filter(Boolean))
		: null;
	const records = DEFAULT_RUNTIME_TOOLS.filter((record) => {
		if (record.featureFlag === "wiki" && !options.wikiEnabled) return false;
		if (record.featureFlag === "exec" && !options.execEnabled) return false;
		if (disabled.has(record.name)) return false;
		if (allowed && !allowed.has(record.name)) return false;
		return true;
	});
	return new ToolRegistry(records);
}

export const DEFAULT_RUNTIME_TOOLS: RuntimeToolRecord[] = [
	{
		name: "use_skill",
		capability: "skill.load",
		risk: "read",
		primary: true,
		description: "Load full instructions for a skill before continuing.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string", description: "Skill command from SkillCatalog." },
				reason: { type: "string", description: "Why this skill matches the task." },
			},
			required: ["command"],
			additionalProperties: false,
		},
	},
	{
		name: "ls",
		capability: "filesystem.list",
		risk: "read",
		primary: true,
		description: "List files and folders in a Vault-relative or approved external path.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				recursive: { type: "boolean", default: false },
				maxEntries: { type: "number", default: 120 },
			},
			additionalProperties: false,
		},
	},
	{
		name: "read",
		capability: "filesystem.read",
		risk: "read",
		primary: true,
		description: "Read file content from Vault or an approved external path.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				maxChars: { type: "number", default: 10000 },
			},
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "grep",
		capability: "filesystem.search",
		risk: "read",
		primary: true,
		description: "Search text using a regex pattern.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				pattern: { type: "string" },
				flags: { type: "string", default: "i" },
				maxMatches: { type: "number", default: 40 },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	{
		name: "search_text",
		capability: "filesystem.search",
		risk: "read",
		primary: true,
		description: "Search text using plain keywords.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				query: { type: "string" },
				maxMatches: { type: "number", default: 40 },
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
	{
		name: "glob",
		capability: "filesystem.search",
		risk: "read",
		primary: true,
		description: "Find files by glob pattern.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				pattern: { type: "string" },
				maxMatches: { type: "number", default: 80 },
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
	{
		name: "memory",
		capability: "memory.write",
		risk: "write",
		primary: true,
		description: "Persist durable memory facts for future turns.",
		parameters: {
			type: "object",
			properties: {
				action: { type: "string", enum: ["add", "replace", "remove"] },
				scope: { type: "string", enum: ["global", "project"] },
				content: { type: "string" },
				old_text: { type: "string" },
			},
			required: ["action", "scope"],
			additionalProperties: false,
		},
	},
	{
		name: "write",
		capability: "filesystem.write",
		risk: "write",
		primary: true,
		description: "Create or update a Vault file.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				content: { type: "string" },
				mode: { type: "string", enum: ["create", "update", "upsert"] },
			},
			required: ["path", "content"],
			additionalProperties: false,
		},
	},
	{
		name: "edit",
		capability: "filesystem.patch",
		risk: "write",
		primary: true,
		description: "Apply targeted edits to a Vault file.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				edits: {
					type: "array",
					items: {
						type: "object",
						properties: {
							search: { type: "string" },
							replace: { type: "string" },
							description: { type: "string" },
						},
						required: ["search", "replace"],
						additionalProperties: false,
					},
				},
			},
			required: ["path", "edits"],
			additionalProperties: false,
		},
	},
	{
		name: "delete",
		capability: "filesystem.delete",
		risk: "delete",
		primary: false,
		description: "Delete a Vault file or folder.",
		parameters: {
			type: "object",
			properties: { path: { type: "string" } },
			required: ["path"],
			additionalProperties: false,
		},
	},
	{
		name: "compile_wiki",
		capability: "knowledge.compile",
		risk: "write",
		primary: true,
		relatedSkillCommand: "compile-wiki",
		featureFlag: "wiki",
		description: "Compile project raw files into Wiki artifacts.",
		parameters: {
			type: "object",
			properties: {
				mode: { type: "string", enum: ["all", "paths"] },
				path: { type: "string" },
				paths: { type: "array", items: { type: "string" } },
			},
			additionalProperties: false,
		},
	},
	{
		name: "exec",
		capability: "system.exec",
		risk: "exec",
		primary: false,
		featureFlag: "exec",
		description: "Run an approved shell command.",
		parameters: {
			type: "object",
			properties: {
				command: { type: "string" },
				args: { type: "array", items: { type: "string" } },
				cwd: { type: "string" },
			},
			required: ["command"],
			additionalProperties: false,
		},
	},
];
```

**Step 4: Run test to verify it passes**

Run:

```powershell
node --test tests/tool-registry.test.mjs
```

Expected: PASS.

**Step 5: Replace manifest derivation**

Modify `src/platform/tools/ToolManifestCatalog.ts` to derive `TOOL_MANIFESTS` from `DEFAULT_RUNTIME_TOOLS`, preserving the existing `ToolManifest` shape.

**Step 6: Commit**

```powershell
git add src/core/tools/ToolRegistry.ts src/platform/tools/ToolManifestCatalog.ts tests/tool-registry.test.mjs
git commit -m "refactor: centralize runtime tool registry"
```

### Task 3: Make AgentRuntimeService Use The Registry For Native Tools

**Files:**
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/native-tool-registry-regression.test.mjs`

**Step 1: Write the failing test**

Create `tests/native-tool-registry-regression.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

test("agent runtime derives native tools from ToolRegistry", () => {
	const source = fs.readFileSync(runtimePath, "utf8");
	assert.match(source, /createDefaultToolRegistry/);
	assert.doesNotMatch(source, /const tools: ToolDefinition\[\] = \[/);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/native-tool-registry-regression.test.mjs
```

Expected: FAIL because `AgentRuntimeService` still defines native tools inline.

**Step 3: Implement registry usage**

In `src/services/AgentRuntimeService.ts`, import `createDefaultToolRegistry` and replace `buildNativeToolDefinitions` body with registry construction:

```ts
private buildNativeToolDefinitions(settings: FridaySettings, allowedTools: Set<string> | null): ToolDefinition[] {
	const registry = createDefaultToolRegistry({
		wikiEnabled: WIKI_FEATURE_ENABLED,
		execEnabled: settings.agentRuntime.enableExecTool,
		disabledTools: [...this.buildDisabledToolSet()],
		allowedTools: allowedTools ? [...allowedTools] : undefined,
	});
	return registry.toNativeToolDefinitions();
}
```

**Step 4: Run targeted tests**

Run:

```powershell
node --test tests/tool-registry.test.mjs tests/native-tool-registry-regression.test.mjs tests/tool-manifest-capability.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/services/AgentRuntimeService.ts tests/native-tool-registry-regression.test.mjs
git commit -m "refactor: derive native tool schemas from registry"
```

---

## Milestone 2: Durable Turn Event Log

### Task 4: Add Replayable Turn Event Store

**Files:**
- Create: `src/core/execution/TurnEventLog.ts`
- Modify: `src/services/RuntimeStateStore.ts`
- Test: `tests/turn-event-log.test.mjs`

**Step 1: Write the failing test**

Create `tests/turn-event-log.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("turn event log appends and reads replayable jsonl events", async () => {
	const { TurnEventLog } = await import("../src/core/execution/TurnEventLog.ts");
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "friday-turn-log-"));
	const log = new TurnEventLog(root);
	await log.append({
		turnId: "turn-1",
		sequence: 1,
		type: "model_request",
		createdAt: "2026-04-30T00:00:00.000Z",
		payload: { messages: 3 },
	});
	await log.append({
		turnId: "turn-1",
		sequence: 2,
		type: "tool_result",
		createdAt: "2026-04-30T00:00:01.000Z",
		payload: { tool: "read", ok: true },
	});
	const events = await log.readTurn("turn-1");
	assert.equal(events.length, 2);
	assert.equal(events[0].type, "model_request");
	assert.equal(events[1].payload.tool, "read");
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/turn-event-log.test.mjs
```

Expected: FAIL because `TurnEventLog.ts` does not exist.

**Step 3: Implement event log**

Create `src/core/execution/TurnEventLog.ts`:

```ts
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type TurnEventType =
	| "turn_started"
	| "context_built"
	| "model_request"
	| "model_response"
	| "tool_call"
	| "tool_approval"
	| "tool_result"
	| "turn_completed"
	| "turn_failed";

export interface TurnEventRecord {
	turnId: string;
	sequence: number;
	type: TurnEventType;
	createdAt: string;
	payload: Record<string, unknown>;
}

export class TurnEventLog {
	constructor(private readonly root: string) {}

	async append(event: TurnEventRecord): Promise<void> {
		await mkdir(this.root, { recursive: true });
		const filePath = this.getTurnPath(event.turnId);
		let current = "";
		try {
			current = await readFile(filePath, "utf8");
		} catch {
			current = "";
		}
		const next = `${current}${JSON.stringify(event)}\n`;
		await writeFile(filePath, next, "utf8");
	}

	async readTurn(turnId: string): Promise<TurnEventRecord[]> {
		try {
			const raw = await readFile(this.getTurnPath(turnId), "utf8");
			return raw
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean)
				.map((line) => JSON.parse(line) as TurnEventRecord);
		} catch {
			return [];
		}
	}

	private getTurnPath(turnId: string): string {
		return path.join(this.root, `${this.sanitize(turnId)}.jsonl`);
	}

	private sanitize(value: string): string {
		return value.replace(/[^a-zA-Z0-9_.-]/g, "-");
	}
}
```

**Step 4: Add runtime store path**

Modify `src/services/RuntimeStateStore.ts`:

```ts
getTurnEventsRoot(): string {
	return this.localStateRootService.resolveVault("runtime", "turn-events");
}
```

Add this directory to `ensureBaseLayout()`.

**Step 5: Run test to verify it passes**

Run:

```powershell
node --test tests/turn-event-log.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/core/execution/TurnEventLog.ts src/services/RuntimeStateStore.ts tests/turn-event-log.test.mjs
git commit -m "feat: add durable turn event log"
```

### Task 5: Persist Runtime Model And Tool Events

**Files:**
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/agent-runtime-turn-events-regression.test.mjs`

**Step 1: Write the failing test**

Create `tests/agent-runtime-turn-events-regression.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const runtimePath = path.join(projectRoot, "src/services/AgentRuntimeService.ts");

test("agent runtime records durable turn events around model and tool execution", () => {
	const source = fs.readFileSync(runtimePath, "utf8");
	assert.match(source, /TurnEventLog/);
	assert.match(source, /appendTurnEvent/);
	assert.match(source, /type:\s*"model_request"/);
	assert.match(source, /type:\s*"model_response"/);
	assert.match(source, /type:\s*"tool_call"/);
	assert.match(source, /type:\s*"tool_result"/);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/agent-runtime-turn-events-regression.test.mjs
```

Expected: FAIL.

**Step 3: Wire TurnEventLog into AgentRuntimeService**

In `AgentRuntimeService` constructor:

```ts
this.turnEventLog = new TurnEventLog(this.runtimeStateStore.getTurnEventsRoot());
```

Add helper:

```ts
private turnEventSequence = 0;

private async appendTurnEvent(
	turnId: string,
	type: TurnEventType,
	payload: Record<string, unknown>,
): Promise<void> {
	try {
		await this.turnEventLog.append({
			turnId,
			sequence: ++this.turnEventSequence,
			type,
			createdAt: new Date().toISOString(),
			payload,
		});
	} catch {
		// Runtime must keep responding even if durable diagnostics fail.
	}
}
```

Reset `turnEventSequence = 0` at the start of `runTurn`.

**Step 4: Add event append points**

Append:

- `turn_started` after gate passes.
- `context_built` after `buildSystemPrompt`.
- `model_request` before `aiService.chat` or `chatWithTools`.
- `model_response` after model returns.
- `tool_call` before `executeTool`.
- `tool_result` after `executeTool`.
- `turn_completed` before normal return.
- `turn_failed` in catch path.

Keep payloads compact: counts, tool names, target paths, statuses, and truncated errors. Do not persist full API keys or full prompts yet.

**Step 5: Run targeted tests**

Run:

```powershell
node --test tests/turn-event-log.test.mjs tests/agent-runtime-turn-events-regression.test.mjs tests/execution-plane-regression.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/services/AgentRuntimeService.ts tests/agent-runtime-turn-events-regression.test.mjs
git commit -m "feat: persist runtime turn events"
```

---

## Milestone 3: Plan-Review-Apply For Writes

### Task 6: Split File Mutation Planning From Applying

**Files:**
- Create: `src/core/editor/MutationPlan.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Modify: `src/services/AgentActionService.ts`
- Test: `tests/mutation-plan.test.mjs`

**Step 1: Write the failing test**

Create `tests/mutation-plan.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

test("mutation plan records before and after content without applying by itself", async () => {
	const mod = await import("../src/core/editor/MutationPlan.ts");
	const plan = mod.createMutationPlan({
		agentId: "soul-1",
		tool: "write",
		path: "Project/workspace/test.md",
		before: "",
		after: "hello",
		changeType: "create",
	});
	assert.equal(plan.status, "pending_review");
	assert.equal(plan.items[0].path, "Project/workspace/test.md");
	assert.equal(plan.items[0].changeType, "create");
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/mutation-plan.test.mjs
```

Expected: FAIL because `MutationPlan.ts` does not exist.

**Step 3: Implement MutationPlan**

Create `src/core/editor/MutationPlan.ts`:

```ts
export type MutationChangeType = "create" | "update" | "delete";
export type MutationPlanStatus = "pending_review" | "applied" | "rejected" | "failed";

export interface MutationPlanItem {
	path: string;
	before: string;
	after: string;
	changeType: MutationChangeType;
}

export interface MutationPlan {
	id: string;
	agentId: string;
	tool: string;
	createdAt: string;
	status: MutationPlanStatus;
	items: MutationPlanItem[];
}

export function createMutationPlan(input: {
	agentId: string;
	tool: string;
	path: string;
	before: string;
	after: string;
	changeType: MutationChangeType;
}): MutationPlan {
	return {
		id: `mutation-plan-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
		agentId: input.agentId,
		tool: input.tool,
		createdAt: new Date().toISOString(),
		status: "pending_review",
		items: [
			{
				path: input.path,
				before: input.before,
				after: input.after,
				changeType: input.changeType,
			},
		],
	};
}
```

**Step 4: Add review mode setting**

Add an Agent runtime setting:

```ts
fileMutationMode: "review" | "direct";
```

Default should be `"review"` unless existing tests require legacy compatibility. If needed, keep runtime default as `"direct"` for one release but expose `"review"` as the recommended setting.

**Step 5: Route write/edit/delete through plan**

In `toolWrite`, `toolEdit`, and `toolDelete`, build a `MutationPlan` first. If `fileMutationMode === "review"`, record the plan and return a tool result that tells the model the mutation is pending review. If `direct`, apply immediately as today.

**Step 6: Run targeted tests**

Run:

```powershell
node --test tests/mutation-plan.test.mjs tests/approval-queue.test.mjs tests/edit-plan.test.mjs
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src/core/editor/MutationPlan.ts src/services/AgentRuntimeService.ts src/services/AgentActionService.ts src/types/settings.ts tests/mutation-plan.test.mjs
git commit -m "feat: introduce reviewable mutation plans"
```

### Task 7: Add Apply And Reject Actions For Pending Mutation Plans

**Files:**
- Modify: `src/features/workbench/WorkbenchStateStore.ts`
- Modify: `src/views/DailyBoardView.ts`
- Test: `tests/mutation-plan-apply-regression.test.mjs`

**Step 1: Write the failing test**

Create `tests/mutation-plan-apply-regression.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

test("workbench exposes pending mutation plan lifecycle", () => {
	const source = fs.readFileSync(path.join(projectRoot, "src/features/workbench/WorkbenchStateStore.ts"), "utf8");
	assert.match(source, /recordMutationPlan/);
	assert.match(source, /markMutationPlanApplied/);
	assert.match(source, /markMutationPlanRejected/);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/mutation-plan-apply-regression.test.mjs
```

Expected: FAIL.

**Step 3: Add lifecycle methods**

Add `recordMutationPlan`, `getPendingMutationPlans`, `markMutationPlanApplied`, and `markMutationPlanRejected` to `WorkbenchStateStore`.

**Step 4: Add UI affordance**

In `DailyBoardView`, show pending mutation plans near the runtime execution details with:

- target path
- change type
- summary
- Apply
- Reject

Keep UI minimal and Obsidian-native.

**Step 5: Run tests**

```powershell
node --test tests/mutation-plan-apply-regression.test.mjs tests/daily-board-ui-regression.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/features/workbench/WorkbenchStateStore.ts src/views/DailyBoardView.ts tests/mutation-plan-apply-regression.test.mjs
git commit -m "feat: review and apply agent mutation plans"
```

---

## Milestone 4: Capability Policy And Exec Hardening

### Task 8: Replace Tool Mode Branches With Capability Policy

**Files:**
- Modify: `src/core/security/policy-resolver/types.ts`
- Modify: `src/core/security/policy-resolver/PolicyMatrix.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/capability-policy.test.mjs`

**Step 1: Write the failing test**

Create `tests/capability-policy.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

test("capability policy can deny exec while allowing read tools", async () => {
	const mod = await import("../src/core/security/policy-resolver/PolicyMatrix.ts");
	const rows = mod.buildCapabilityPolicyMatrix({
		mode: "standard",
		disabledCapabilities: ["system.exec"],
	});
	assert.equal(rows.find((row) => row.capability === "filesystem.read")?.effect, "allow");
	assert.equal(rows.find((row) => row.capability === "system.exec")?.effect, "deny");
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/capability-policy.test.mjs
```

Expected: FAIL.

**Step 3: Implement capability matrix**

Add a capability-level policy builder that accepts:

```ts
{
	mode: "auto" | "standard" | "strict";
	disabledCapabilities: string[];
	projectOverrides?: PolicyRule[];
}
```

Map:

- `filesystem.list/read/search`: allow in all modes unless disabled.
- `memory.write`: allow or ask depending on product decision; keep allow for current compatibility.
- `filesystem.write/patch`: ask in standard, allow in auto, deny in strict.
- `filesystem.delete`: ask in standard, allow in auto, deny in strict.
- `system.exec`: ask in standard only when `enableExecTool` and command allowlist pass; deny in strict.

**Step 4: Use capabilities from ToolRegistry**

When resolving tool policy, load the tool record and resolve by `record.capability`, not only by `tool:${name}`.

**Step 5: Run tests**

```powershell
node --test tests/capability-policy.test.mjs tests/policy-resolver-core.test.mjs tests/policy-matrix.test.mjs tests/execution-gate.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/core/security/policy-resolver src/services/AgentRuntimeService.ts tests/capability-policy.test.mjs
git commit -m "refactor: resolve agent permissions by capability"
```

### Task 9: Convert Exec From Blocklist To Allowlist

**Files:**
- Modify: `src/services/CommandExecService.ts`
- Modify: `src/types/settings.ts`
- Modify: `src/settings/FridaySettingTab.ts`
- Test: `tests/command-exec-allowlist.test.mjs`

**Step 1: Write the failing test**

Create `tests/command-exec-allowlist.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

test("command exec service uses an allowlist before running commands", () => {
	const source = fs.readFileSync(path.join(projectRoot, "src/services/CommandExecService.ts"), "utf8");
	assert.match(source, /allowedCommands/);
	assert.match(source, /checkAllowlist/);
	assert.doesNotMatch(source, /checkBlocklist\(fullCommand/);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/command-exec-allowlist.test.mjs
```

Expected: FAIL.

**Step 3: Add settings**

Add:

```ts
allowedCommands: string[];
```

Default:

```ts
["git", "npm", "node"]
```

Do not include shell builtins by default.

**Step 4: Implement allowlist check**

In `CommandExecService.exec`, before spawn:

```ts
this.checkAllowlist(command, settings.agentRuntime.allowedCommands);
```

Only exact command names should match. Do not match full command strings with regex.

**Step 5: Preserve blockedCommands as secondary deny**

After allowlist passes, keep `blockedCommands` as a secondary deny layer for compatibility.

**Step 6: Run tests**

```powershell
node --test tests/command-exec-allowlist.test.mjs tests/global-git-user-settings-regression.test.mjs
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src/services/CommandExecService.ts src/types/settings.ts src/settings/FridaySettingTab.ts tests/command-exec-allowlist.test.mjs
git commit -m "fix: require allowlisted commands for agent exec"
```

---

## Milestone 5: Token-Aware Context And Tool Boundary Hygiene

### Task 10: Add Token Budget Adapter

**Files:**
- Create: `src/core/context/TokenBudget.ts`
- Modify: `src/core/context/ContextAssembler.ts`
- Test: `tests/token-budget.test.mjs`

**Step 1: Write the failing test**

Create `tests/token-budget.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

test("token budget falls back to approximate counts without external tokenizer", async () => {
	const mod = await import("../src/core/context/TokenBudget.ts");
	const budget = mod.createTokenBudget({ maxTokens: 100 });
	assert.ok(budget.count("hello world") > 0);
	assert.equal(budget.isOverBudget("x ".repeat(500)), true);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/token-budget.test.mjs
```

Expected: FAIL.

**Step 3: Implement approximate adapter**

Create `TokenBudget.ts`:

```ts
export interface TokenBudget {
	maxTokens: number;
	count(text: string): number;
	isOverBudget(text: string): boolean;
}

export function createTokenBudget(input: { maxTokens: number }): TokenBudget {
	const maxTokens = Math.max(1, input.maxTokens);
	return {
		maxTokens,
		count(text: string): number {
			return Math.ceil((text || "").length / 4);
		},
		isOverBudget(text: string): boolean {
			return this.count(text) > maxTokens;
		},
	};
}
```

This is intentionally simple. Later, swap in a real tokenizer behind the same interface.

**Step 4: Update ContextAssembler summary**

Have `ContextAssembler` report both `usedChars` and `estimatedTokens`. Preserve existing `used` for compatibility until all UI references are migrated.

**Step 5: Run tests**

```powershell
node --test tests/token-budget.test.mjs tests/context-assembler.test.mjs tests/prompt-context-engine.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/core/context/TokenBudget.ts src/core/context/ContextAssembler.ts tests/token-budget.test.mjs
git commit -m "feat: add token-aware context budget adapter"
```

### Task 11: Add Tool Boundary Filtering Before Model Requests

**Files:**
- Create: `src/core/context/ToolBoundaryFilter.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/tool-boundary-filter.test.mjs`

**Step 1: Write the failing test**

Create `tests/tool-boundary-filter.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";

test("tool boundary filter removes orphan tool messages", async () => {
	const mod = await import("../src/core/context/ToolBoundaryFilter.ts");
	const messages = [
		{ role: "user", content: "hi" },
		{ role: "tool", content: "orphan", toolCallId: "missing" },
		{ role: "assistant", content: "ok" },
	];
	const filtered = mod.filterToolBoundaries(messages);
	assert.deepEqual(filtered.map((item) => item.role), ["user", "assistant"]);
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/tool-boundary-filter.test.mjs
```

Expected: FAIL.

**Step 3: Implement filter**

Create `ToolBoundaryFilter.ts`:

```ts
import type { ChatMessage } from "../../services/AIService";

export function filterToolBoundaries(messages: ChatMessage[]): ChatMessage[] {
	const output: ChatMessage[] = [];
	const pendingToolCallIds = new Set<string>();
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const call of message.toolCalls ?? []) {
				if (call.id) pendingToolCallIds.add(call.id);
			}
			output.push(message);
			continue;
		}
		if (message.role === "tool") {
			if (message.toolCallId && pendingToolCallIds.has(message.toolCallId)) {
				output.push(message);
				pendingToolCallIds.delete(message.toolCallId);
			}
			continue;
		}
		output.push(message);
	}
	return output;
}
```

**Step 4: Use filter before model requests**

Apply it in both prompt and native mode before calling `aiService.chat` or `chatWithTools`.

**Step 5: Run tests**

```powershell
node --test tests/tool-boundary-filter.test.mjs tests/native-tool-call-history-regression.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/core/context/ToolBoundaryFilter.ts src/services/AgentRuntimeService.ts tests/tool-boundary-filter.test.mjs
git commit -m "fix: filter invalid tool-message boundaries"
```

---

## Milestone 6: Fake-Model Agent E2E Harness

### Task 12: Add Scripted Fake Model Runtime Tests

**Files:**
- Create: `tests/helpers/fakeAgentRuntime.mjs`
- Create: `tests/agent-runtime-e2e.test.mjs`

**Step 1: Write the failing test**

Create `tests/agent-runtime-e2e.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import test from "node:test";
import { createFakeRuntimeHarness } from "./helpers/fakeAgentRuntime.mjs";

test("agent can read evidence and produce final answer", async () => {
	const harness = await createFakeRuntimeHarness({
		files: { "Project/workspace/a.md": "alpha" },
		modelSteps: [
			{ tool: { name: "read", args: { path: "Project/workspace/a.md" } } },
			{ assistant: "The file says alpha." },
		],
	});
	const result = await harness.run("read a.md");
	assert.match(result.assistantText, /alpha/);
	assert.equal(result.traces[0].tool, "read");
	assert.equal(result.traces[0].status, "ok");
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test tests/agent-runtime-e2e.test.mjs
```

Expected: FAIL because helper does not exist.

**Step 3: Implement fake harness**

Create a minimal harness that stubs:

- `AIService.chatWithTools`
- `AIService.chat`
- Obsidian `Vault` read/write/list surface
- settings provider
- approval service

Use scripted `modelSteps` to return one tool call and then one final answer.

**Step 4: Add second E2E for write review**

Add:

```js
test("agent write request creates a pending mutation plan in review mode", async () => {
	const harness = await createFakeRuntimeHarness({
		settings: { fileMutationMode: "review" },
		files: {},
		modelSteps: [
			{ tool: { name: "write", args: { path: "draft.md", content: "hello", mode: "create" } } },
			{ assistant: "I prepared the draft for review." },
		],
	});
	const result = await harness.run("create draft.md");
	assert.equal(result.traces[0].tool, "write");
	assert.match(result.traces[0].summary, /pending/i);
});
```

**Step 5: Run tests**

```powershell
node --test tests/agent-runtime-e2e.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add tests/helpers/fakeAgentRuntime.mjs tests/agent-runtime-e2e.test.mjs
git commit -m "test: add fake-model agent runtime e2e harness"
```

---

## Milestone 7: Product Gate Cleanup

### Task 13: Keep Wiki And Add-Ons Explicitly Gated

**Files:**
- Modify: `src/constants/wikiFeature.ts`
- Modify: `src/settings/FridaySettingTab.ts`
- Modify: `src/services/AgentRuntimeService.ts`
- Test: `tests/agent-kernel-gates-regression.test.mjs`

**Step 1: Write the failing test**

Create `tests/agent-kernel-gates-regression.test.mjs`:

```js
/* eslint-env node */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

test("wiki feature remains disabled until agent kernel gates are met", () => {
	const source = fs.readFileSync(path.join(projectRoot, "src/constants/wikiFeature.ts"), "utf8");
	assert.match(source, /WIKI_FEATURE_ENABLED\s*=\s*false/);
});

test("agent runtime does not expose compile_wiki while wiki feature is disabled", () => {
	const runtime = fs.readFileSync(path.join(projectRoot, "src/services/AgentRuntimeService.ts"), "utf8");
	assert.match(runtime, /WIKI_FEATURE_ENABLED/);
});
```

**Step 2: Run test**

```powershell
node --test tests/agent-kernel-gates-regression.test.mjs
```

Expected: PASS initially. This test is a guard.

**Step 3: Add user-facing settings copy**

In settings, mark disabled Wiki/RAG/automation surfaces as "planned after Agent Kernel hardening" rather than showing them as nearly available.

**Step 4: Run UI-related tests**

```powershell
node --test tests/agent-kernel-gates-regression.test.mjs tests/wiki-feature-disabled.test.mjs tests/settings-project-ui-regression.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/constants/wikiFeature.ts src/settings/FridaySettingTab.ts tests/agent-kernel-gates-regression.test.mjs
git commit -m "chore: keep add-on features gated behind agent kernel maturity"
```

---

## Completion Criteria

The plan is complete when:

- `ToolRegistry` is the single source for runtime tool schema, manifest, and native tool definitions.
- `AgentRuntimeService` records replayable durable turn events.
- File mutation tools can run in review mode without immediately modifying files.
- Capability policy controls tools by capability, not only by tool name.
- `exec` requires an allowlisted command before blocklist checks.
- Context assembly reports estimated token usage and filters invalid tool-message boundaries.
- Fake-model E2E tests cover at least read, write-review, deny, and tool failure flows.
- Wiki remains disabled and product copy reflects that the Agent Kernel comes first.

## Final Verification

Run:

```powershell
npm test
```

Expected: TypeScript compile, production build, release generation, and all tests pass.

If full `npm test` is too slow during development, run targeted groups after each milestone and full `npm test` before merge.

## Execution Handoff

Plan complete and saved to `docs/plans/2026-04-30-agent-kernel-maturity.md`. Two execution options:

1. **Subagent-Driven (this session)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Parallel Session (separate)** - Open a new session with `executing-plans`, batch execution with checkpoints.

Which approach?
