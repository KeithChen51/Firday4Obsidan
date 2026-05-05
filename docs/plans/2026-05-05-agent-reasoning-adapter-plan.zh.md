# FRIDAY Reasoning Adapter 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 为 FRIDAY 增加一层 provider-aware Reasoning Adapter，把不同模型、网关和 API 协议返回的推理信息规范化为统一的 `ReasoningArtifact`，供 Kernel trajectory、replay 和过程 UI 使用。

**架构：** Reasoning 不再作为 `reasoningContent: string` 在运行链路里散传，也不再直接进入用户可见 UI。`AIService` 负责采集 provider 原始推理字段，`ReasoningAdapter` 负责归一化、脱敏、续传策略判断和可见摘要生成，Kernel 只接收安全的 artifact metadata，UI 只展示 `visibleSummary` 或结构化思路步骤。

**技术栈：** TypeScript、Obsidian plugin runtime、OpenAI-compatible Chat Completions、Responses API、DashScope/百炼、ZenMux、DeepSeek、Anthropic-compatible thinking blocks、node test runner。

---

## 背景

FRIDAY 现在已经开始接收部分 reasoning 字段，但实现还不成熟：

- `AIService` 只解析 `reasoning_content` / `reasoning`，没有统一 artifact。
- `requestText` 路径仍会把 reasoning 置空，简单回答链路会丢推理信息。
- Kernel `model_response` 事件只记录 `hasReasoningContent`，不能供 replay/UI 复原。
- UI 里的 `Reasoning` 仍是固定阶段分类，不等同于模型真实推理过程。
- 不同 provider 对 reasoning 的多轮续传规则不同，直接拼回 messages 会导致协议错误或上下文污染。

成熟做法不是“把模型返回的 raw CoT 显示出来”，而是把它转成 FRIDAY 自己的可解释过程：

```text
provider raw response
  -> ReasoningAdapter.normalize(...)
  -> ReasoningArtifact
  -> Kernel trajectory / replay
  -> FRIDAY 的思路 / FRIDAY 的工作过程
```

## 设计原则

1. **用户可见内容永远是 FRIDAY 的摘要，不是 raw CoT。**
   - 默认 UI 只显示 `visibleSummary` 或结构化步骤。
   - raw reasoning 只允许进入 debug/dev 隔离存储，不能进入普通 replay。

2. **Reasoning 是 provider contract，不是单一字符串字段。**
   - `reasoning_content`、`reasoning`、`reasoning_details`、Responses `output[type=reasoning]`、Anthropic `thinking` block 都必须通过 adapter 归一化。

3. **续传策略必须 provider-aware。**
   - DeepSeek 官方要求多轮请求移除 `reasoning_content`。
   - 百炼/Qwen thinking 多轮上下文只保留 `content`，忽略 `reasoning_content`。
   - Anthropic extended thinking tool-use 需要原样保留 thinking blocks。
   - ZenMux 在部分 Claude/工具调用兼容路径要求回传 `reasoning` 和 `reasoning_details`，尤其 signature。

4. **Unknown provider 默认保守。**
   - 可解析就生成 summary。
   - 不明确的 raw reasoning 不回传。
   - 不因为未知字段导致最终回答失败。

5. **过程 UI 以 FRIDAY timeline 为准。**
   - reasoning 只是渐进式过程中的一个已发生/正在发生步骤。
   - 不恢复固定 `Context / Reasoning / Tools / Review / Finalize` tabs。

## 外部协议依据

- DeepSeek `deepseek-reasoner` 返回 CoT 和最终答案，但官方说明如果 input messages 包含 `reasoning_content` 会返回 400，因此多轮请求应移除该字段，只保留 assistant `content`。参考：https://api-docs.deepseek.com/guides/reasoning_model
- ZenMux reasoning 文档说明 Chat Completions 可用 `reasoning_effort` 或 `reasoning`，Responses API 用 `reasoning` 控制 effort/summary，Anthropic 兼容路径用 `thinking`。参考：https://docs.zenmux.ai/guide/advanced/reasoning.html
- ZenMux Chat Completion 文档说明 Claude Opus 兼容场景下，开启 reasoning 的第二轮 tool-calling 请求需要完整回传上一轮 `reasoning` 和 `reasoning_details`。参考：https://docs.zenmux.ai/api/openai/create-chat-completion.html
- 阿里云百炼 deep thinking 文档说明 `enable_thinking` 控制混合思考模式，流式 delta 中返回 `reasoning_content` 和 `content`。参考：https://www.alibabacloud.com/help/en/model-studio/deep-thinking
- 阿里云百炼多轮对话文档说明 thinking models 返回 `reasoning_content` 和 `content`，更新 messages 时只保留 `content` 并忽略 `reasoning_content`。参考：https://www.alibabacloud.com/help/en/model-studio/multi-round-conversation
- Anthropic extended thinking 文档说明 tool use 场景必须把 thinking blocks 原样传回 API，并且 thinking signature 是不透明验证字段。参考：https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- OpenAI gpt-oss / Responses reasoning 资料区分 raw CoT 和可显示的 reasoning summary，并说明 Responses API 有 reasoning items / encrypted reasoning items 等机制。参考：https://developers.openai.com/cookbook/articles/gpt-oss/handle-raw-cot

## 数据模型

新增 `src/core/llm/ReasoningArtifact.ts`：

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

约束：

- `visibleSummary` 必须可直接进入用户 UI。
- `rawReasoning` 默认不写入普通 replay。
- `continuationPayload` 只给下一轮 request builder 使用，不给 UI 使用。
- `metadata.warnings` 用于记录 provider 不一致、字段冲突、fallback 解析等情况。

## Provider 规则

### DeepSeek

输入：

- `choices[].message.reasoning_content`
- `choices[].delta.reasoning_content`

输出：

- `provider: "deepseek"`
- `rawFormat: "reasoning_content"`
- `continuationPolicy: "drop"`
- `visibleSummary`: 从 raw reasoning 抽取或生成短摘要

硬规则：

- 不把 `reasoning_content` 拼回下一轮 messages。
- 如果 model id / base URL 指向 DeepSeek 官方 reasoner，强制 drop。

### ZenMux

输入：

- `choices[].message.reasoning`
- `choices[].message.reasoning_details`
- Responses `output[type="reasoning"]`
- Anthropic-compatible thinking blocks proxied by ZenMux

输出：

- Chat `reasoning`: `continuationPolicy` 默认 `drop`
- Chat `reasoning_details` with signature: `continuationPolicy: "preserve_signature_only"` 或 `preserve_raw`，取决于 adapter 对字段结构的判断
- Responses reasoning summary: `visibleSummary` 优先使用 provider summary
- Anthropic-compatible thinking: 按 Anthropic 规则处理

硬规则：

- tool-calling second turn 如果 provider 明确要求 signature，必须保留完整 required fields。
- 不把 ZenMux 的 `reasoning_details` 展示给普通 UI。

### Bailian / DashScope

输入：

- OpenAI-compatible: `choices[].message.reasoning_content`
- OpenAI-compatible streaming: `choices[].delta.reasoning_content`
- DashScope SDK/API: `output.choices[].message.reasoning_content`

请求参数：

- `enable_thinking`
- `thinking_budget`
- OpenAI SDK 兼容调用中应通过 extra body 或本项目等价扩展参数传入。

输出：

- `provider: "bailian"` 或 `"dashscope"`
- `rawFormat: "reasoning_content"`
- `continuationPolicy: "drop"`

硬规则：

- 多轮上下文只保留 assistant `content`，忽略 `reasoning_content`。
- 百炼深度思考模型大多以流式为主，stream parser 必须支持 reasoning delta。

### Anthropic

输入：

- Messages API `content[]` 中的 `thinking`
- `redacted_thinking`
- `signature`

输出：

- `provider: "anthropic"`
- `rawFormat: "anthropic_thinking"` 或 `"redacted_thinking"`
- tool-use 场景：`continuationPolicy: "preserve_raw"` 或 `"preserve_signature_only"`

硬规则：

- thinking blocks 必须原样保留给 API 续传，不能重排、改写、摘要化后回传。
- 普通用户 UI 不展示 encrypted/redacted thinking。
- `signature` 是 opaque field，不能解析。

### OpenAI / Responses

输入：

- Responses `output[]` 中的 reasoning item
- reasoning summary
- encrypted reasoning item

输出：

- `provider: "openai"`
- `rawFormat: "responses_reasoning"`
- 优先使用 provider summary 作为 `visibleSummary`
- API stateful continuation 优先交给 `previous_response_id` 或 provider-managed state

硬规则：

- 不用 Chat Completions 风格硬拼 raw CoT。
- stateless 模式下如需要 encrypted reasoning item，应由 provider-specific continuation payload 处理。

### Think Tags / Local / Unknown

输入：

- `<think>...</think>`
- `thinking`
- `analysis`
- 其他网关自定义字段

输出：

- `provider: "unknown"`
- `rawFormat: "think_tags"` 或 `"unknown"`
- `continuationPolicy: "drop"`

硬规则：

- 永不默认回传未知 raw reasoning。
- 不因为无法解析而中断回答。

## 实施任务

### Task 1: 建立 ReasoningArtifact 类型与 adapter 单测

**Files:**

- Create: `src/core/llm/ReasoningArtifact.ts`
- Create: `src/core/llm/ReasoningAdapter.ts`
- Test: `tests/reasoning-adapter.test.mjs`

**Step 1: 写失败测试**

覆盖：

- DeepSeek `reasoning_content` -> `drop`
- ZenMux `reasoning` -> visible summary
- ZenMux `reasoning_details.signature` -> continuation payload
- Bailian streaming delta -> `drop`
- Anthropic `thinking` + `signature` -> preserve policy
- Responses reasoning summary -> visible summary
- unknown fields -> no throw, drop

**Step 2: 实现最小 adapter**

实现纯函数：

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

**Step 3: 运行测试**

```powershell
node --test tests/reasoning-adapter.test.mjs
```

### Task 2: 改造 AIService 返回结构

**Files:**

- Modify: `src/services/AIService.ts`
- Modify: `src/services/AIServiceModelDriverAdapter.ts`
- Modify: `src/core/agent-kernel/ModelDriverPort.ts`
- Test: `tests/agent-kernel-model-driver.test.mjs`
- Test: `tests/native-tool-call-history-regression.test.mjs`

**要求：**

- `chat` 不再只返回 string，或新增内部 `chatDetailed`，使 requestText 路径能拿到 `ReasoningArtifact`。
- `chatWithTools` 返回 `reasoningArtifact`。
- 保留兼容层，避免一次性改爆调用方。
- `toOpenAIMessages` 不再盲目写 `reasoning_content`；改由 continuation policy 决定。
- provider 未知时默认不回传 raw reasoning。

**验收：**

- requestText 路径不再丢 reasoning。
- chatWithTools 路径不丢 reasoning metadata。
- DeepSeek/Bailian 不回传 `reasoning_content`。
- ZenMux/Anthropic signature continuation 有测试覆盖。

### Task 3: Kernel event / replay 支持 reasoning artifact

**Files:**

- Modify: `src/core/agent-kernel/AgentLoopController.ts`
- Modify: `src/core/agent-kernel/contracts/AgentTurnEvent.ts`
- Modify: `src/core/runtime/TurnReplayReader.ts`
- Modify: `src/core/trajectory/AgentTrajectory.ts`
- Modify: `src/core/trajectory/AgentTrajectoryProjector.ts`
- Test: `tests/turn-replay-reader.test.mjs`
- Test: `tests/agent-trajectory-projector.test.mjs`

**要求：**

- `model_response` event payload 记录：
  - `hasReasoning`
  - `reasoningProvider`
  - `reasoningRawFormat`
  - `reasoningContinuationPolicy`
  - `reasoningVisibleSummary`
  - `reasoningWarnings`
- 不把 `rawReasoning` 写进普通 replay。
- replay 能重建 reasoning step，但只能用 safe summary。

**验收：**

- replay summary 能恢复 `FRIDAY 的思路`。
- raw CoT 不出现在普通 replay JSON。
- unknown provider reasoning 不导致 replay 失败。

### Task 4: 过程 UI 接入 visible reasoning summary

**Files:**

- Modify: `src/views/agentProcessPanelViewModel.ts`
- Modify: `src/views/agentTrajectoryRenderer.ts`
- Modify: `src/views/DailyBoardView.ts`
- Test: `tests/agent-process-panel-view-model.test.mjs`
- Test: `tests/daily-board-agent-trajectory-ui.test.mjs`

**要求：**

- reasoning 作为 progressive timeline step，而不是 fixed tab。
- 折叠态显示：

```text
FRIDAY 的思路 8s
```

- 展开态显示：

```text
● 理解任务
  - 分析了用户目标和当前上下文
```

- 工具/文件任务中 reasoning 可以作为步骤中的动作：

```text
✓ 读取上下文
  - 判断需要先读取当前工作区
  - 读取 workspace/FRIDAY 介绍.md
```

**硬性 UI 禁止项：**

- 不渲染 raw CoT。
- 不恢复 `Reasoning` tab。
- 不恢复 `Context / Reasoning / Tools / Review / Finalize` 固定阶段。

### Task 5: Provider 设置与能力探测

**Files:**

- Modify: `src/core/llm/LlmSettingsResolver.ts`
- Modify: settings schema 所在文件
- Modify: settings UI 所在文件
- Test: `tests/llm-settings-resolver.test.mjs` 或新增对应测试

**要求：**

- provider config 支持：
  - `reasoning.enabled`
  - `reasoning.effort`
  - `reasoning.maxTokens`
  - `reasoning.summary`
  - `reasoning.enableThinking`
  - `reasoning.thinkingBudget`
  - `reasoning.showRawInDebug`
- 针对 provider 映射实际请求字段：
  - ZenMux Chat: `reasoning_effort` 或 `reasoning`
  - ZenMux Responses: `reasoning`
  - Bailian/DashScope: `enable_thinking`, `thinking_budget`
  - Anthropic: `thinking`
  - Unknown: 不发送 provider-specific reasoning 参数

**验收：**

- 用户可在设置中打开/关闭 thinking。
- 未知 OpenAI-compatible 网关不会收到不支持的 provider-specific 参数。
- 默认值保守，不破坏现有非 reasoning 模型。

### Task 6: 集成验收

运行：

```powershell
node --test tests/reasoning-adapter.test.mjs tests/agent-kernel-model-driver.test.mjs tests/native-tool-call-history-regression.test.mjs tests/turn-replay-reader.test.mjs tests/agent-trajectory-projector.test.mjs tests/agent-process-panel-view-model.test.mjs tests/daily-board-agent-trajectory-ui.test.mjs
npm run lint
npm test
git diff --check
```

手动检查：

- ZenMux deepseekV4pro：能看到 `FRIDAY 的思路` 摘要，不显示 raw CoT。
- 百炼 Qwen thinking：`enable_thinking` 生效，streaming reasoning delta 被采集，多轮只回传 `content`。
- 普通非 reasoning 模型：不出现空 reasoning UI。
- 工具调用任务：reasoning 作为 timeline 中已发生/正在发生的步骤，不出现固定 tab。

## 验收标准

PASS 必须同时满足：

- 新增统一 `ReasoningArtifact`。
- requestText 和 chatWithTools 都能保留 reasoning artifact。
- DeepSeek/Bailian 默认不回传 raw `reasoning_content`。
- ZenMux/Anthropic signature/continuation payload 不丢。
- Kernel event/replay 记录 safe reasoning metadata。
- UI 只显示 `visibleSummary`，不显示 raw CoT。
- 不再出现固定 `Reasoning` tab。
- 未知 provider 不报错，默认 drop。
- 全量测试、lint、diff check 通过。

FAIL 条件：

- 仍把 reasoning 当作一个 `string` 到处传。
- 仍只支持 `reasoning_content` / `reasoning` 两个字段。
- requestText 路径仍丢 reasoning。
- 普通 UI 显示 raw CoT。
- 把 DeepSeek/Bailian raw `reasoning_content` 拼回下一轮 messages。
- 丢失 ZenMux/Anthropic 需要的 signature continuation。

