# FRIDAY Reasoning Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a provider-aware Reasoning Adapter to FRIDAY so reasoning outputs from different models, gateways, and API protocols are normalized into a single `ReasoningArtifact` for Kernel trajectory, replay, and process UI.

**Architecture:** Reasoning must not be passed through the runtime as a loose `reasoningContent: string`, and raw chain-of-thought must not be rendered directly in the user-facing UI. `AIService` collects raw provider reasoning fields, `ReasoningAdapter` normalizes them, decides continuation policy, redacts unsafe data, and creates a visible summary. Kernel receives only safe artifact metadata. UI renders only `visibleSummary` or structured FRIDAY process steps.

**Tech Stack:** TypeScript, Obsidian plugin runtime, OpenAI-compatible Chat Completions, Responses API, DashScope/Bailian, ZenMux, DeepSeek, Anthropic-compatible thinking blocks, node test runner.

---

## Background

FRIDAY currently preserves some reasoning fields, but the implementation is not mature:

- `AIService` only parses `reasoning_content` / `reasoning`.
- The `requestText` path still returns an empty reasoning value, so simple answer turns lose reasoning.
- Kernel `model_response` events only record `hasReasoningContent`, which is not enough for replay or UI.
- UI currently treats `Reasoning` as a fixed phase bucket, not as actual model reasoning.
- Provider continuation rules differ. Naively replaying raw reasoning into the next request can trigger protocol errors or pollute context.

The mature approach is not “show the model raw CoT”. FRIDAY should translate provider reasoning into FRIDAY-owned process information:

```text
provider raw response
  -> ReasoningAdapter.normalize(...)
  -> ReasoningArtifact
  -> Kernel trajectory / replay
  -> FRIDAY's thinking / FRIDAY's work process
```

## Design Principles

1. **User-visible reasoning is FRIDAY's summary, not raw CoT.**
   - Default UI renders only `visibleSummary` or structured process steps.
   - Raw reasoning may only be stored in an isolated debug/dev path.

2. **Reasoning is a provider contract, not one string field.**
   - `reasoning_content`, `reasoning`, `reasoning_details`, Responses `output[type=reasoning]`, and Anthropic `thinking` blocks must all normalize through the adapter.

3. **Continuation policy must be provider-aware.**
   - DeepSeek official docs require removing `reasoning_content` from multi-turn input messages.
   - Bailian/Qwen thinking multi-turn context keeps only `content` and ignores `reasoning_content`.
   - Anthropic extended thinking with tool use requires preserving thinking blocks.
   - ZenMux may require passing back `reasoning` and `reasoning_details`, especially signatures, in some Claude/tool-calling compatibility paths.

4. **Unknown providers default to safe behavior.**
   - Parse when possible.
   - Generate a summary when possible.
   - Do not return unknown raw reasoning to the provider.
   - Do not fail the final answer because of unknown reasoning fields.

5. **Process UI follows FRIDAY's event timeline.**
   - Reasoning is one actual running/completed process step.
   - Do not restore fixed `Context / Reasoning / Tools / Review / Finalize` tabs.

## External Protocol References

- DeepSeek `deepseek-reasoner` returns CoT plus final content, but input messages containing `reasoning_content` return 400. Multi-turn requests should remove that field and keep assistant `content`. Reference: https://api-docs.deepseek.com/guides/reasoning_model
- ZenMux reasoning docs describe Chat Completions `reasoning_effort` / `reasoning`, Responses API `reasoning`, and Anthropic-compatible `thinking`. Reference: https://docs.zenmux.ai/guide/advanced/reasoning.html
- ZenMux Chat Completion docs state that some Claude/tool-calling compatibility paths require the next request to pass back previous assistant `reasoning` and `reasoning_details` fields in full. Reference: https://docs.zenmux.ai/api/openai/create-chat-completion.html
- Alibaba Cloud Model Studio deep thinking docs show `enable_thinking` and streaming `reasoning_content` / `content` deltas. Reference: https://www.alibabacloud.com/help/en/model-studio/deep-thinking
- Alibaba Cloud Model Studio multi-turn docs state that thinking models return `reasoning_content` and `content`, and message history should retain only `content` while ignoring `reasoning_content`. Reference: https://www.alibabacloud.com/help/en/model-studio/multi-round-conversation
- Anthropic extended thinking docs require preserving thinking blocks during tool use and treat signatures as opaque verification fields. Reference: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- OpenAI gpt-oss / Responses reasoning material distinguishes raw CoT from displayable reasoning summaries and describes reasoning items / encrypted reasoning items. Reference: https://developers.openai.com/cookbook/articles/gpt-oss/handle-raw-cot

## Data Model

Create `src/core/llm/ReasoningArtifact.ts`:

```ts
export type ReasoningProvider =
  | "openai"
  | "deepseek"
  | "zenmux"
  | "bailian"
  | "dashscope"
  | "anthropic"
  | "google"
  | "unknown";

export type ReasoningRawFormat =
  | "reasoning_content"
  | "reasoning"
  | "reasoning_details"
  | "responses_reasoning"
  | "anthropic_thinking"
  | "redacted_thinking"
  | "think_tags"
  | "unknown";

export type ReasoningContinuationPolicy =
  | "drop"
  | "preserve_raw"
  | "preserve_signature_only"
  | "provider_managed";

export interface ReasoningArtifact {
  hasReasoning: boolean;
  provider: ReasoningProvider;
  model: string;
  rawFormat: ReasoningRawFormat;
  visibleSummary: string;
  rawReasoning?: string;
  continuationPolicy: ReasoningContinuationPolicy;
  continuationPayload?: unknown;
  metadata: {
    tokenCount?: number;
    encrypted?: boolean;
    redacted?: boolean;
    streamed?: boolean;
    sourceProtocol?: "chat_completions" | "responses" | "dashscope" | "anthropic_messages" | "unknown";
    warnings?: string[];
  };
}
```

Constraints:

- `visibleSummary` is safe for user-facing UI.
- `rawReasoning` must not be persisted to normal replay by default.
- `continuationPayload` is only for the next request builder, not for UI.
- `metadata.warnings` records provider inconsistencies, parsing fallback, and field conflicts.

## Provider Rules

### DeepSeek

Input:

- `choices[].message.reasoning_content`
- `choices[].delta.reasoning_content`

Output:

- `provider: "deepseek"`
- `rawFormat: "reasoning_content"`
- `continuationPolicy: "drop"`
- `visibleSummary`: short summary extracted or generated from raw reasoning

Hard rules:

- Do not append `reasoning_content` to next-turn messages.
- If model id / base URL points to official DeepSeek reasoner, force drop.

### ZenMux

Input:

- `choices[].message.reasoning`
- `choices[].message.reasoning_details`
- Responses `output[type="reasoning"]`
- Anthropic-compatible thinking blocks proxied by ZenMux

Output:

- Chat `reasoning`: default `continuationPolicy: "drop"`
- Chat `reasoning_details` with signature: `preserve_signature_only` or `preserve_raw`, based on parsed field structure
- Responses reasoning summary: prefer provider summary as `visibleSummary`
- Anthropic-compatible thinking: follow Anthropic rules

Hard rules:

- If the provider requires a signature for a second tool-calling turn, preserve the required fields exactly.
- Do not render ZenMux `reasoning_details` in normal UI.

### Bailian / DashScope

Input:

- OpenAI-compatible: `choices[].message.reasoning_content`
- OpenAI-compatible streaming: `choices[].delta.reasoning_content`
- DashScope SDK/API: `output.choices[].message.reasoning_content`

Request parameters:

- `enable_thinking`
- `thinking_budget`
- For OpenAI SDK compatible calls, pass via extra body or this project's equivalent extension mechanism.

Output:

- `provider: "bailian"` or `"dashscope"`
- `rawFormat: "reasoning_content"`
- `continuationPolicy: "drop"`

Hard rules:

- Multi-turn context keeps only assistant `content` and ignores `reasoning_content`.
- Most Bailian deep-thinking models prefer streaming, so stream parsing must support reasoning deltas.

### Anthropic

Input:

- Messages API `content[]` `thinking`
- `redacted_thinking`
- `signature`

Output:

- `provider: "anthropic"`
- `rawFormat: "anthropic_thinking"` or `"redacted_thinking"`
- Tool-use path: `continuationPolicy: "preserve_raw"` or `"preserve_signature_only"`

Hard rules:

- Thinking blocks used for continuation must be preserved exactly, without reordering, rewriting, or summary substitution.
- Normal UI must not render encrypted/redacted thinking.
- `signature` is opaque and must not be parsed.

### OpenAI / Responses

Input:

- Responses `output[]` reasoning items
- reasoning summary
- encrypted reasoning item

Output:

- `provider: "openai"`
- `rawFormat: "responses_reasoning"`
- Prefer provider summary as `visibleSummary`
- Prefer `previous_response_id` or provider-managed state for stateful continuation

Hard rules:

- Do not manually build Chat Completions-style raw CoT history.
- Stateless encrypted reasoning items, when needed, must live in provider-specific continuation payload.

### Think Tags / Local / Unknown

Input:

- `<think>...</think>`
- `thinking`
- `analysis`
- other gateway-specific fields

Output:

- `provider: "unknown"`
- `rawFormat: "think_tags"` or `"unknown"`
- `continuationPolicy: "drop"`

Hard rules:

- Never return unknown raw reasoning to the provider by default.
- Never fail the final answer because reasoning could not be parsed.

## Implementation Tasks

### Task 1: Add ReasoningArtifact types and adapter tests

**Files:**

- Create: `src/core/llm/ReasoningArtifact.ts`
- Create: `src/core/llm/ReasoningAdapter.ts`
- Test: `tests/reasoning-adapter.test.mjs`

**Step 1: Write failing tests**

Cover:

- DeepSeek `reasoning_content` -> `drop`
- ZenMux `reasoning` -> visible summary
- ZenMux `reasoning_details.signature` -> continuation payload
- Bailian streaming delta -> `drop`
- Anthropic `thinking` + `signature` -> preserve policy
- Responses reasoning summary -> visible summary
- unknown fields -> no throw, drop

**Step 2: Implement the minimal adapter**

Implement:

```ts
normalizeReasoningArtifact(input: {
  provider?: ReasoningProvider;
  model?: string;
  sourceProtocol?: ReasoningArtifact["metadata"]["sourceProtocol"];
  body?: unknown;
  message?: unknown;
  delta?: unknown;
  responseOutput?: unknown;
}): ReasoningArtifact;
```

**Step 3: Run tests**

```powershell
node --test tests/reasoning-adapter.test.mjs
```

### Task 2: Update AIService return structures

**Files:**

- Modify: `src/services/AIService.ts`
- Modify: `src/services/AIServiceModelDriverAdapter.ts`
- Modify: `src/core/agent-kernel/ModelDriverPort.ts`
- Test: `tests/agent-kernel-model-driver.test.mjs`
- Test: `tests/native-tool-call-history-regression.test.mjs`

**Requirements:**

- `chat` must no longer be limited to returning a string, or a new internal `chatDetailed` must let requestText receive `ReasoningArtifact`.
- `chatWithTools` returns `reasoningArtifact`.
- Keep compatibility wrappers to avoid a broad calling-site rewrite in one step.
- `toOpenAIMessages` must stop blindly writing `reasoning_content`; request building must use continuation policy.
- Unknown provider defaults to not returning raw reasoning.

**Acceptance:**

- requestText path preserves reasoning.
- chatWithTools path preserves reasoning metadata.
- DeepSeek/Bailian do not return `reasoning_content`.
- ZenMux/Anthropic signature continuation is test-covered.

### Task 3: Add Kernel event / replay support

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/turn-replay-reader.test.mjs`
- Test: `tests/agent-trajectory-projector.test.mjs`

**Requirements:**

- `model_response` event payload records:
  - `hasReasoning`
  - `reasoningProvider`
  - `reasoningRawFormat`
  - `reasoningContinuationPolicy`
  - `reasoningVisibleSummary`
  - `reasoningWarnings`
- Do not persist `rawReasoning` into normal replay.
- Replay can rebuild a reasoning step from safe summary only.

**Acceptance:**

- replay summary can restore `FRIDAY's thinking`.
- raw CoT does not appear in normal replay JSON.
- unknown provider reasoning does not break replay.

### Task 4: Connect visible reasoning summary to process UI

**Files:**

- Modify: `src/views/agentProcessPanelViewModel.ts`
- Modify: `src/views/agentTrajectoryRenderer.ts`
- Modify: `src/views/DailyBoardView.ts`
- Test: `tests/agent-process-panel-view-model.test.mjs`
- Test: `tests/daily-board-agent-trajectory-ui.test.mjs`

**Requirements:**

- Reasoning renders as a progressive timeline step, not a fixed tab.
- Collapsed state:

```text
FRIDAY's thinking 8s
```

- Expanded state:

```text
* Understanding task
  - Analyzed the user's goal and available context
```

- In tool/file tasks, reasoning may be rendered as an action within a step:

```text
* Read context
  - Decided to inspect the current workspace first
  - Read workspace/FRIDAY intro.md
```

**Hard UI prohibitions:**

- Do not render raw CoT.
- Do not restore a `Reasoning` tab.
- Do not restore fixed `Context / Reasoning / Tools / Review / Finalize` phase tabs.

### Task 5: Add provider settings and capability mapping

**Files:**

- Modify: `src/core/llm/LlmSettingsResolver.ts`
- Modify: settings schema file
- Modify: settings UI file
- Test: `tests/llm-settings-resolver.test.mjs` or equivalent new test

**Requirements:**

- provider config supports:
  - `reasoning.enabled`
  - `reasoning.effort`
  - `reasoning.maxTokens`
  - `reasoning.summary`
  - `reasoning.enableThinking`
  - `reasoning.thinkingBudget`
  - `reasoning.showRawInDebug`
- map settings to provider request fields:
  - ZenMux Chat: `reasoning_effort` or `reasoning`
  - ZenMux Responses: `reasoning`
  - Bailian/DashScope: `enable_thinking`, `thinking_budget`
  - Anthropic: `thinking`
  - Unknown: send no provider-specific reasoning params

**Acceptance:**

- Users can enable/disable thinking.
- Unknown OpenAI-compatible gateways do not receive unsupported provider-specific fields.
- Defaults are conservative and do not break existing non-reasoning models.

### Task 6: Integration verification

Run:

```powershell
node --test tests/reasoning-adapter.test.mjs tests/agent-kernel-model-driver.test.mjs tests/native-tool-call-history-regression.test.mjs tests/turn-replay-reader.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-process-panel-view-model.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
npm run lint
npm test
git diff --check
```

Manual checks:

- ZenMux deepseekV4pro: `FRIDAY's thinking` summary appears; raw CoT is not rendered.
- Bailian Qwen thinking: `enable_thinking` works, streaming reasoning delta is collected, multi-turn history returns only `content`.
- Normal non-reasoning model: no empty reasoning UI appears.
- Tool-call task: reasoning appears as an actual running/completed timeline step; fixed phase tabs do not appear.

## Acceptance Criteria

PASS requires all of the following:

- Unified `ReasoningArtifact` exists.
- requestText and chatWithTools both preserve reasoning artifacts.
- DeepSeek/Bailian do not return raw `reasoning_content` by default.
- ZenMux/Anthropic signature/continuation payload is preserved.
- Kernel event/replay records safe reasoning metadata.
- UI renders only `visibleSummary`, not raw CoT.
- Fixed `Reasoning` tab is gone.
- Unknown providers do not fail and default to drop.
- Full tests, lint, and diff check pass.

FAIL conditions:

- Reasoning is still passed around as a raw `string`.
- Only `reasoning_content` / `reasoning` are supported.
- requestText still loses reasoning.
- Normal UI renders raw CoT.
- DeepSeek/Bailian raw `reasoning_content` is appended to next-turn messages.
- ZenMux/Anthropic required signature continuation is lost.

