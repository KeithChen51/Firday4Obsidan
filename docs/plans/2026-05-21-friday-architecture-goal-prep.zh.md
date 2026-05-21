# FRIDAY 架构债治理 goal 准备计划

> **给 Codex / Claude 的执行要求：** 执行本计划时必须先使用 `superpowers:executing-plans`，并按任务逐项推进。

**目标：** 用分阶段、可验证的方式降低 FRIDAY 的架构债，把 `DailyBoardView.ts` 中的非渲染逻辑抽出，并把 `FridaySettingTab.ts` 拆成更聚焦、可测试的模块，同时保持用户可见行为不变。

**架构原则：** 保留现有 Agent Kernel v2 和服务边界，不重写运行时。`DailyBoardView` 应逐步退回到视图外壳：负责 Obsidian View 生命周期、页面切换、DOM 挂载和事件绑定；composer、mention、审批、对话入口等逻辑逐步委托给独立模块。`FridaySettingTab` 应退回到设置页路由器：负责当前 tab/section 状态和 section 委托；LLM、Soul、项目、同步、官方内容、更新等具体设置逻辑逐步拆到 section 模块。

**技术栈：** Obsidian 插件、TypeScript、esbuild、Node test runner、`jiti` 加载 TS 测试、现有 `npm test`、`npm run build`、`npm run lint`。

---

## goal 命令交接

后续使用 `goal` 时，建议使用下面这段目标描述：

```text
在 C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload 中，按照 docs/plans/2026-05-21-friday-architecture-goal-prep.zh.md 分任务治理 FRIDAY 架构债。先只执行 Recommended First Goal Slice，也就是 Task -1 到 Task 2。先在隔离 git worktree 中工作，不要直接在本地主 checkout 中做架构拆分；保持现有行为，用 TDD 做每个 extraction，保护本地主 checkout，不做 broad rewrite。
```

建议附带的执行约束：

- 开始前先读本计划、`AGENTS.md` 和本计划引用的 FRIDAY 既有架构文档。
- 实施前必须重新执行 Task -1 和 Task 0，因为该仓库仍在活跃变化，本计划中的行数和文件状态可能过期。
- 默认在隔离 git worktree 中执行架构拆分；本地主 checkout 只作为最终集成目标。
- 优先使用项目内 `.worktrees/<branch-name>`，因为当前 `.gitignore` 已忽略 `.worktrees/`；如果 Codex App 已经分配了托管 worktree，也可以使用托管路径，但必须报告实际路径。
- worktree 分支名使用 `codex/` 前缀，例如 `codex/friday-architecture-slice-1`。
- 在本地主 checkout 和 worktree 中分别确认 `git rev-parse --show-toplevel`、`git branch --show-current`、`git status --short --untracked-files=all`。
- 保留本地主 checkout 和 worktree 中所有已有改动，不覆盖用户修改。
- 在 worktree 完成 slice 并且用户要求集成前，不要修改本地主 checkout。
- 不执行 `reset`、`checkout`、`clean`，也不要清理生成物。
- 不允许多个 worker 同时编辑 `src/views/DailyBoardView.ts`。
- 每个 refactor slice 必须小到可以单独 review。
- 除非用户明确要求，不提交 commit；如进入集成流程，应先提交 worktree 分支，再按用户确认回并到本地主 checkout。

## worktree 执行模式

本轮架构拆分应该采用 worktree-first 模式：

- 本地主 checkout：`C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload`，只用于读取现状、保留用户本地改动、最终回并。
- 默认工作区：`C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload\.worktrees\friday-architecture-slice-1`。
- 默认分支：`codex/friday-architecture-slice-1`。
- 如果 Codex App 已经给本任务创建了 `C:\Users\Keith\.codex\worktrees\...` 这类托管 worktree，可以使用该路径，但必须在开始编辑前明确写出实际 worktree 路径。

这样做的目的不是增加流程，而是降低三类风险：

- 防止架构拆分污染用户当前本地主 checkout。
- 防止测试或 build 生成物把 source diff 搅在一起。
- 让后续回并可以按 commit、merge、验证的顺序处理，而不是在一个 dirty checkout 里同时解耦和集成。

集成回本地主 checkout 时应另开一个明确阶段：

- 先确认 worktree 分支 diff 和验证结果。
- 再确认本地主 checkout 的 dirty files，必要时先让用户决定是否提交或暂缓这些本地改动。
- 回并后运行 `npm test`、`npm run build`、`git diff --check`，并检查是否出现 release artifacts 或 plugin artifacts 的生成物变化。
- 不把 stale source-shape test 当成产品回归；先对比当前代码契约，再决定修测试还是修生产代码。

## 当前证据快照

2026-05-21 的初始快照：

```text
src/views/DailyBoardView.ts                   6200 lines, 45 imports, 274 private methods, 47 render methods
src/settings/FridaySettingTab.ts              4326 lines, 26 imports, 146 private methods, 34 render methods
src/views/agentProcessPanelViewModel.ts       3384 lines
src/views/agentTrajectoryRenderer.ts          1038 lines
src/core/agent-kernel/AgentLoopController.ts  3114 lines
src/services/AgentRuntimeService.ts           3933 lines
```

用户后续改动后的最新复查快照，仍为 2026-05-21：

```text
git status --short --untracked-files=all      no output
git diff --name-only HEAD                     no output
src/views/DailyBoardView.ts                   6181 lines, 45 imports, 273 private methods, 46 render methods
src/settings/FridaySettingTab.ts              4366 lines, 26 imports, 146 private methods, 34 render methods
src/views/agentProcessPanelViewModel.ts       3384 lines
src/views/agentTrajectoryRenderer.ts           847 lines
src/core/agent-kernel/AgentLoopController.ts  3114 lines
src/services/AgentRuntimeService.ts           3933 lines
```

更新后的判断：

- `agentTrajectoryRenderer.ts` 已从 1038 行降到 847 行，renderer 层压力低于初始判断。
- `DailyBoardView.ts` 仍有 6181 行，仍持有 mention 分类、mention 过滤、用户消息 segment 构造等非渲染逻辑。
- `FridaySettingTab.ts` 从 4326 行增至 4366 行，仍把 LLM、Soul、项目、同步、官方内容、插件更新等 section 逻辑集中在一个类里。
- 因此，核心架构债判断仍成立，但优先级应更新：先处理 `DailyBoardView` 中最容易 TDD 抽离的逻辑，再处理 `FridaySettingTab` 的 section 拆分。

`AGENTS.md` 明确说：超过约 200-300 行的文件应考虑拆成更小、更聚焦的模块，每个文件应有清晰的单一职责。

相关既有设计约束：

- `docs/plans/2026-05-08-friday-document-context-entrypoints-design.zh.md` 指出，当前对话发起逻辑集中在 `DailyBoardView`，为了支持文档内入口，应把“发起任务”的能力拆出视图层。
- `docs/plans/2026-05-04-agent-trajectory-projection-plan.zh.md` 指出，Daily Board 应渲染 `AgentTrajectorySnapshot`，而不是自己解释 `RuntimeProgressEvent.phase`。
- `docs/specs/2026-05-10-friday-agent-ux-harness-reset-spec.zh.md` 明确警告：不要让多个 subagent 同时编辑 `DailyBoardView.ts`。
- 当前回归测试里存在针对 `DailyBoardView.ts` 和 `FridaySettingTab.ts` 私有方法结构的 source-shape assertion。抽离逻辑时必须同步迁移测试，不能为了通过测试把逻辑留在旧 monolith 里。

## 非目标

- 不重新设计 FRIDAY 的用户体验。
- 不替换 Agent Kernel v2、`AgentLoopController` 或 `AgentRuntimeService`。
- 不修改 manifest identity、命令 ID、settings schema、release version 或存储格式。
- 不把调高 `maxToolIterations` 之类的运行时参数当作架构治理。
- 不主动重新生成 release artifacts；如果验证命令导致它们变化，只报告，不静默回滚。
- 不为了追求行数而制造空壳 wrapper 文件。

## 目标边界

`DailyBoardView.ts` 应保留：

- Obsidian `ItemView` 生命周期。
- 顶层页面切换。
- DOM 挂载点和事件绑定。
- 调用 renderer、controller、presenter 的外壳逻辑。

`DailyBoardView.ts` 应逐步委托：

- mention suggestion 过滤和文件类型分类。
- 用户消息 UI segment 构造。
- composer queue 和发送按钮状态。
- conversation ingress payload 创建。
- approval 和 mutation review 的 view model。
- sync conflict proposal 的 view model。

`FridaySettingTab.ts` 应保留：

- Obsidian `PluginSettingTab` 生命周期。
- 当前 section 选择状态。
- 对 section renderer 的委托。

`FridaySettingTab.ts` 应逐步委托：

- LLM / model / provider 设置。
- Soul 管理、Soul Lab、Soul editor。
- 项目注册和 Git 检测 UI。
- sync 与 ignore-manager UI。
- 官方内容和插件更新 UI。

## Task -1：创建或确认隔离 worktree

**文件：**

- 读取：`.gitignore`
- 读取：`AGENTS.md`

**步骤 1：确认本地主 checkout 状态**

在 `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload` 运行：

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short --untracked-files=all
git check-ignore -q .worktrees; if ($LASTEXITCODE -eq 0) { ".worktrees ignored" } else { ".worktrees not ignored" }
```

预期：

- repo root 指向 `C:\Own Docm\Coding\Friday - Ob\Firday4Obsidan-upload`。
- `.worktrees` 已被 ignore。当前复查显示 `.gitignore` 已包含 `.worktrees/`。
- 如果本地主 checkout 有 dirty files，只记录并报告，不修改、不清理。

**步骤 2：创建或复用 worktree**

如果 Codex App 已经创建了托管 worktree，优先确认并使用那个路径。否则在项目内创建：

```powershell
git worktree add ".worktrees/friday-architecture-slice-1" -b "codex/friday-architecture-slice-1"
```

进入 worktree 后运行：

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short --untracked-files=all
```

预期：

- repo root 指向 `.worktrees/friday-architecture-slice-1` 或 Codex 托管 worktree。
- 当前分支是 `codex/friday-architecture-slice-1`，或用户明确指定的 `codex/` 分支。
- 开始编辑前 worktree 状态清楚；如果不是 clean，先报告原因。

**步骤 3：安装依赖并跑基线**

在 worktree 中运行：

```powershell
npm install
npm test
```

预期：依赖可安装，基线测试结果被记录。若测试失败，先报告失败项，不要继续 refactor。

## Task 0：基线与安全检查

**文件：**

- 读取：`AGENTS.md`
- 读取：`docs/plans/2026-05-21-friday-architecture-goal-prep.zh.md`
- 读取：`src/views/DailyBoardView.ts`
- 读取：`src/settings/FridaySettingTab.ts`

**步骤 1：记录工作树状态**

运行：

```powershell
git status --short --untracked-files=all
```

预期：报告现有 dirty files。没有输出也可以接受。不要 reset，不要 clean，不要 checkout。

**步骤 2：记录文件体量基线**

运行：

```powershell
$targets = @('src\views\DailyBoardView.ts','src\settings\FridaySettingTab.ts','src\views\agentProcessPanelViewModel.ts','src\views\agentTrajectoryRenderer.ts')
$rows = foreach ($target in $targets) {
  $content = Get-Content -LiteralPath $target
  [PSCustomObject]@{
    File=$target
    Lines=$content.Count
    Imports=($content | Select-String '^import ').Count
    PrivateMethods=($content | Select-String '^\s*private\s+(async\s+)?[a-zA-Z0-9_]+\(').Count
  }
}
$rows | Format-Table -AutoSize
```

预期：只把结果作为基线，不要因为行数本身失败。

## Task 1：抽出 mention suggestion 分类逻辑

**文件：**

- 新建：`src/views/mentionSuggestions.ts`
- 新建：`tests/mention-suggestions.test.mjs`
- 修改：`src/views/DailyBoardView.ts`
- 如受影响则修改：`tests/daily-board-ui-regression.test.mjs`

**步骤 1：先写失败测试**

创建 `tests/mention-suggestions.test.mjs`，验证新的独立模块不依赖 `DailyBoardView` 也能完成文件类型分类和 mentionable 文件过滤：

```js
/* eslint-env node */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const jiti = createJiti(import.meta.url);
const modulePath = path.join(projectRoot, "src/views/mentionSuggestions.ts");

async function loadModule() {
	return jiti.import(modulePath);
}

test("根据 Obsidian 文件元数据分类 mention 文件类型", async () => {
	const mod = await loadModule();

	assert.equal(mod.getMentionFileTypeIcon({ extension: "md" }), "markdown");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "canvas" }), "canvas");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "ts" }), "code");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "TXT" }), "note");
	assert.equal(mod.getMentionFileTypeIcon({ extension: "png" }), "note");
});

test("过滤可作为 mention 上下文的文件", async () => {
	const mod = await loadModule();
	const files = [
		{ path: "Project/a.md", basename: "a", extension: "md" },
		{ path: "Project/code.ts", basename: "code", extension: "ts" },
		{ path: "Project/whiteboard.canvas", basename: "whiteboard", extension: "canvas" },
		{ path: "Project/image.png", basename: "image", extension: "png" },
	];

	assert.deepEqual(
		files.filter((file) => mod.isMentionableFile(file)).map((file) => file.path),
		["Project/a.md", "Project/code.ts", "Project/whiteboard.canvas"],
	);
});
```

**步骤 2：运行测试，确认它按预期失败**

运行：

```powershell
node --test tests/mention-suggestions.test.mjs
```

预期：失败，原因是 `src/views/mentionSuggestions.ts` 尚不存在。

**步骤 3：实现最小代码**

创建 `src/views/mentionSuggestions.ts`：

```ts
import type { MentionFileTypeIconKind } from "./components/MentionDropdown";

interface MentionFileLike {
	extension?: string | null;
}

const CODE_MENTION_FILE_EXTENSIONS = new Set([
	"c",
	"cc",
	"cpp",
	"cs",
	"css",
	"go",
	"h",
	"htm",
	"html",
	"java",
	"js",
	"json",
	"jsx",
	"mjs",
	"py",
	"rs",
	"sh",
	"ts",
	"tsx",
	"xml",
	"yaml",
	"yml",
]);

const NOTE_MENTION_FILE_EXTENSIONS = new Set(["", "txt"]);

export function getMentionFileTypeIcon(file: MentionFileLike): MentionFileTypeIconKind {
	const extension = (file.extension ?? "").toLowerCase();
	if (extension === "md") {
		return "markdown";
	}
	if (extension === "canvas") {
		return "canvas";
	}
	if (CODE_MENTION_FILE_EXTENSIONS.has(extension)) {
		return "code";
	}
	return "note";
}

export function isMentionableFile(file: MentionFileLike): boolean {
	const extension = (file.extension ?? "").toLowerCase();
	return extension === "md"
		|| extension === "canvas"
		|| CODE_MENTION_FILE_EXTENSIONS.has(extension)
		|| NOTE_MENTION_FILE_EXTENSIONS.has(extension);
}
```

修改 `DailyBoardView.ts`：

- 引入 `getMentionFileTypeIcon` 和 `isMentionableFile`。
- 删除本地重复的 `CODE_MENTION_FILE_EXTENSIONS`、`NOTE_MENTION_FILE_EXTENSIONS`。
- 删除本地 `getMentionFileTypeIcon` 和 `isMentionableFile` 方法。
- 把 call site 改为调用新模块。

示例：

```ts
import { getMentionFileTypeIcon, isMentionableFile } from "./mentionSuggestions";
```

```ts
fileTypeIcon: activeFile instanceof TFile ? getMentionFileTypeIcon(activeFile) : "note",
```

```ts
const files = this.app.vault.getFiles().filter((file) => isMentionableFile(file));
```

**步骤 4：运行 focused tests**

运行：

```powershell
node --test tests/mention-suggestions.test.mjs
node --test tests/mention-resolver.test.mjs
```

预期：通过。

## Task 2：抽出用户消息 segment 构造逻辑

**文件：**

- 新建：`src/views/chatMessageSegments.ts`
- 新建：`tests/chat-message-segments.test.mjs`
- 修改：`src/views/DailyBoardView.ts`
- 修改：`tests/daily-board-ui-regression.test.mjs`

**步骤 1：先写失败测试**

创建 `tests/chat-message-segments.test.mjs`，面向一个独立函数测试：

```ts
buildUserMessageSegments({
	snapshot,
	mentionResolution,
	resolution,
	formatSkillDisplayName,
	formatMentionBadgeLabel,
})
```

覆盖这些行为：

- 相邻文本 segment 会合并。
- skill token 会变成 `kind: "skill"` 的 UI token。
- context token 优先使用 mention resolution entry。
- 缺失 resolution entry 时回退到 `formatMentionTokenLabel`。
- 不硬编码 `Skill /xxx` 这种旧显示文案。

**步骤 2：运行测试，确认它按预期失败**

运行：

```powershell
node --test tests/chat-message-segments.test.mjs
```

预期：失败，原因是 `chatMessageSegments.ts` 尚不存在。

**步骤 3：移动现有逻辑**

从 `DailyBoardView.ts` 中只移动这些职责：

- `buildUserMessageSegments`
- `normalizeUserMessageSegments`
- 对 `listMentionComposerParts` 的直接调用
- 对 `restoreMentionComposerDoc` 的直接调用

保留在 `DailyBoardView` 中的内容：

- 翻译函数 `this.t(...)`
- `formatSkillDisplayName`
- `formatMentionBadgeLabel`
- 当前 session / conversation 状态
- DOM 渲染

同时迁移 `tests/daily-board-ui-regression.test.mjs` 里当前直接截取 `DailyBoardView.ts` 私有 `buildUserMessageSegments` block 的断言。新的断言应改为验证：

- `DailyBoardView.ts` 调用了新的 segment builder，并传入 `formatSkillDisplayName`。
- `chatMessageSegments.ts` 不包含硬编码的 `Skill /` fallback。

**步骤 4：运行 focused tests**

运行：

```powershell
node --test tests/chat-message-segments.test.mjs tests/mention-resolver.test.mjs tests/daily-board-ui-regression.test.mjs
```

预期：通过。

## Task 3：抽出 conversation ingress 边界

**文件：**

- 新建：`src/core/chat/ConversationIngressService.ts`
- 新建：`tests/conversation-ingress-service.test.mjs`
- 修改：`src/views/DailyBoardView.ts`

**步骤 1：先写目标 API 的失败测试**

建议目标 API：

```ts
createConversationIngressPayload({
	snapshot,
	activeProject,
	currentFilePath,
	mentionResolution,
	selectedModel,
	selectedPermissionMode,
})
```

覆盖这些行为：

- 空 prompt 在进入 runtime dispatch 前被拒绝。
- mention context 会以结构化 metadata 形式进入 payload。
- active project 与 session identity 不丢失。
- runtime-facing payload 不依赖 DOM，也不依赖 Obsidian `ItemView`。

**步骤 2：逐步迁移逻辑**

从 `DailyBoardView.submitAiPrompt` 中先抽出 payload 构造和校验，不要第一步就移动整个发送流程。

`DailyBoardView` 第一阶段仍然可以负责：

- UI busy state。
- 追加用户/助手消息。
- 调用 `plugin.agentRuntimeService`。
- 会话持久化。

新 service 第一阶段只负责：

- 输入快照整理。
- mention context 组装。
- runtime payload 构造。
- 空输入和基础错误校验。

**步骤 3：运行 focused tests**

运行：

```powershell
node --test tests/conversation-ingress-service.test.mjs tests/agent-runtime-harness-e2e.test.mjs
```

预期：通过。

## Task 4：逐个拆分 settings section

**文件：**

- 新建目录：`src/settings/sections/`
- 新建：`src/settings/sections/LlmSettingsSection.ts`
- 新建：`src/settings/sections/SoulSettingsSection.ts`
- 新建：`src/settings/sections/ProjectSettingsSection.ts`
- 修改：`src/settings/FridaySettingTab.ts`
- 修改：`tests/settings-native-groups-regression.test.mjs`
- 修改：`tests/settings-project-ui-regression.test.mjs`

**步骤 0：先更新 settings 测试策略**

当前多个 settings 测试直接在 `FridaySettingTab.ts` 中匹配私有方法 body，例如：

- `renderLlmSection`
- `renderSoulSection`
- `renderProjectSection`

不要在这些测试还钉死旧结构时开始抽 section。先把测试改成保留行为覆盖，同时允许 section renderer 移到新文件。

推荐测试方向：

- 用户可见安全契约继续做 source assertion。
- 某个 section 被抽出后，该 section 的 body 断言迁移到对应 section 文件。
- `FridaySettingTab.ts` 只保留小断言：当前 tab 会委托到对应 section renderer。
- 不增加大而脆的行数断言。

**步骤 1：先拆 LLM settings**

优先拆这些内容，因为边界比较清楚，并且已经依赖 helper service：

- `renderLlmSection`
- model preset loading helpers
- OpenCode snapshot reading
- connection-test state description

`FridaySettingTab` 保留 section navigation 和 active section 状态。

**步骤 2：再拆 Soul settings**

拆这些内容：

- `renderSoulSection`
- `renderSoulEditorSection`
- `renderSoulLabSection`
- Soul template install/remove helpers

注意：不要在这个 refactor 中修改 Soul 语义、模板内容或 persona 行为。

**步骤 3：再拆 Project settings**

拆这些内容：

- `renderProjectSection`
- `renderProjectEditorCard`
- Git detection UI state
- ignore manager UI

`ProjectEditorService` 仍然是 domain service，不要复制它的逻辑。

**步骤 4：每拆一个 section 后验证**

运行：

```powershell
npm run build
node --test tests/settings-project-ui-regression.test.mjs tests/settings-native-groups-regression.test.mjs tests/agent-model-mode-regression.test.mjs
```

预期：build 成功，focused settings tests 通过。如果 build 造成 release artifacts 改动，报告这些改动，不要静默回滚。

## Task 5：增加架构边界回归检查

**文件：**

- 新建：`tests/architecture-boundary-regression.test.mjs`

**步骤 1：检查具体回归，不检查任意行数**

好的检查：

- `DailyBoardView.ts` 不再定义本地 `CODE_MENTION_FILE_EXTENSIONS`。
- `DailyBoardView.ts` 不再定义本地 `normalizeUserMessageSegments`。
- `DailyBoardView.ts` 不重新引入针对 `RuntimeProgressEvent.phase` 的 process UI 解释逻辑。
- section extraction 开始后，`FridaySettingTab.ts` 应从 `src/settings/sections/` 引入 section renderer。
- 已有 source-shape tests 应指向新的模块 owner，而不是强迫逻辑回到旧 monolith。

避免这些检查：

- 只因为某个文件超过 N 行就失败。
- 只因为 import 数量变化就失败。

**步骤 2：运行检查**

```powershell
node --test tests/architecture-boundary-regression.test.mjs
```

预期：对应 extraction 完成后通过。

## Task 6：完整验证

运行：

```powershell
npm test
npm run build
npm run lint
git diff --stat
git diff --check
```

预期：

- `npm test` exit 0。
- `npm run build` exit 0。
- `npm run lint` 0 errors；如果有既有 warnings，报告具体 warnings。
- `git diff --check` 没有真实 whitespace errors。普通 CRLF/LF warning 要和阻塞性 whitespace error 区分。
- diff 只包含计划中的 source/test 文件，以及 build 导致的 release artifacts。

## 验收标准

- `DailyBoardView.ts` 至少移出三类非渲染职责中的前两类：mention classification 和 user-message segment construction。
- `FridaySettingTab.ts` 开始 section-level extraction，至少有一个真实 section module，且用户可见行为不变。
- runtime、mutation review、model selection、sync 行为仍由 focused tests 覆盖。
- 不修改公开 command ID、manifest 字段、settings schema 或 release version。
- 最终报告必须列出实际运行过的验证命令和结果。

## 推荐的第一个 goal 切片

先只执行 Task -1 到 Task 2。

理由：

- Task -1 把拆分动作放到隔离 worktree 中，避免污染用户当前本地主 checkout。
- 当前代码仍显示 mention classification 和 user-message segment construction 在 `DailyBoardView.ts` 内。
- 这两块可以用 focused tests 证明抽离，不需要先碰 runtime 或 settings。
- Task 2 必须同时迁移 `daily-board-ui-regression`，避免测试套件继续钉死旧的私有方法形态。

Task -1 到 Task 2 完成并通过验证后暂停，重新评估是否进入 conversation ingress 或 settings extraction。当前更可能的下一优先级是 Task 4，因为最新复查显示 `FridaySettingTab.ts` 从 4326 行增加到 4366 行，并且仍集中持有所有 section 逻辑。
