# FRIDAY Agent UX Live Acceptance Scenarios

> **For acceptance window:** Use `superpowers:executing-plans` or equivalent task-by-task execution. This is an acceptance/audit plan, not a development plan. Do not fix while running these scenarios unless the coordinating window explicitly switches you into a fix task.

**Goal:** 用真实用户路径逐项核验 FRIDAY Agent UX 设计是否已经落地，而不是只证明底层状态、class、store 或 renderer contract 满足脚本条件。

**Architecture:** 每个场景必须从用户可见入口进入：composer 发送消息、点击审批按钮、切换笔记/会话、收起/展开插件、读取真实文件状态。可以在模型服务边界使用 deterministic fake model 来稳定返回，但禁止直接向 `approvalQueue`、`WorkbenchStateStore`、runtime trajectory snapshot、DOM renderer 塞最终状态来证明通过。

**Tech Stack:** Obsidian plugin, TypeScript, Node test runner, esbuild, Obsidian CLI, live Obsidian test vault, screenshot, short DOM eval, file-system verification.

---

## 0. 验收原则

### 0.1 这份计划覆盖什么

覆盖前面已经规划过的 FRIDAY Agent UX 设计：

- 本地即时首响。
- 模型请求开始状态。
- 网络失败、重试、请求耗尽状态。
- 模型 intake 决定简单回答、澄清、轻量任务、完整过程任务。
- 运行中过程面板默认展开。
- 完成后过程面板默认折叠，最终答案成为主内容。
- 工具轨迹默认折叠，只给普通用户看语义化动作。
- 审批态占用底部 composer body，同时保留 composer chrome。
- 审批只有“审批/不审批”级别，不暴露细粒度权限。
- 文件创建、修改、删除必须在用户确认前保持 pending 语言和 pending 文件状态。
- 普通用户界面不暴露 tool、checkpoint、model request、replay、debug、raw reasoning 等工程概念。
- 用户可以不盯着过程面板；切换笔记、切换会话或收起面板时，已开始任务仍应继续。
- 计时刷新、状态刷新不能导致工作过程整体闪烁。

暂不验收：

- 上下文压缩。
- Subagent 产品能力。
- 真后台任务系统重构。
- 工作区隔离。
- 面向高级用户的 replay/debug UI。

### 0.2 什么证据才算有效

每个场景至少产出：

1. 一张或多张 GUI 截图。
2. 一个短 DOM/state eval JSON。
3. 如果涉及文件改动，必须有审批前、审批后或拒绝后的文件系统检查。
4. 如果涉及文案，必须有 banned-term 扫描和截图佐证。

无效证据：

- 只跑 unit test。
- 只检查 class 是否存在。
- 只调用 renderer 或 view private method。
- 直接 `approvalQueue.enqueue(...)` 后截图。
- 直接 `recordEditPlan(...)` 后截图。
- 直接 `rememberCompletedTrajectorySnapshot(...)` 后截图。
- 直接 `handleRuntimeProgress(...)` 注入最终状态后宣称真实链路通过。

可以接受的 deterministic 方式：

- 用测试模型 adapter 固定模型返回。
- 用真实 composer 发送消息进入 agent loop。
- 用真实工具审批服务触发审批。
- 用真实 mutation plan 触发文件改动审核。
- 用真实 Obsidian vault 文件检查写入结果。

## 1. 统一准备步骤

所有场景先执行本节。任何一项失败，先停止验收。

### 1.1 确认工作树、分支和产物

```powershell
$repo = "C:\Users\Keith\.codex\worktrees\ac4c\Firday4Obsidan-upload"
$plugin = "C:\Own Docm\Coding\Friday - Ob\test\.obsidian\plugins\friday-obsidian-plugin"
Set-Location $repo
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse --short HEAD
git status --short
npm run build
Copy-Item -Force -LiteralPath ".\main.js",".\manifest.json",".\styles.css" -Destination $plugin
"main.js","manifest.json","styles.css" | ForEach-Object {
  $src = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $repo $_)).Hash
  $dst = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $plugin $_)).Hash
  [pscustomobject]@{ file = $_; match = ($src -eq $dst); repoHash = $src; pluginHash = $dst }
} | Format-Table -AutoSize
```

通过标准：

- 分支是待验收分支。
- `main.js`、`manifest.json`、`styles.css` 三个 hash 全部一致。
- 如果有 dirty files，必须在验收报告里列出。

### 1.2 Reload 插件并建立证据目录

```powershell
$out = "C:\Own Docm\Coding\Friday - Ob\.tmp\friday-live-ux-acceptance-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force -Path $out | Out-Null
obsidian vault="test" plugin:reload id=friday-obsidian-plugin
obsidian vault="test" dev:errors
obsidian vault="test" dev:screenshot path="$out\00-baseline.png"
```

通过标准：

- `dev:errors` 没有新增错误。
- baseline 截图里 FRIDAY 插件已加载。

### 1.3 使用短 eval，不要长脚本挂住 renderer

每个 `obsidian eval` 尽量少于 40 行。长逻辑拆成多个 eval。示例：

```powershell
obsidian vault="test" eval code="JSON.stringify({title:document.title,text:document.body.innerText.slice(0,500)})"
```

## 2. 通用 DOM 检查片段

验收窗口可以把下面这些短片段复制到每个场景里。不要把它们拼成一个超长 eval。

### 2.1 可见文本快照

```powershell
obsidian vault="test" eval code="JSON.stringify({text:document.body.innerText.slice(0,4000)})"
```

### 2.2 普通用户界面禁词扫描

```powershell
obsidian vault="test" eval code="
const banned=['checkpoint','model_request','model request','raw reasoning','debug','replay','View replay','Tool approval required','Allow once','Allow session','Allow always','Before snapshot mismatch'];
const text=document.body.innerText;
JSON.stringify({hits:banned.filter(x=>text.includes(x))});
"
```

通过标准：`hits` 为空。  
例外：开发者设置页、源码视图、测试说明文档如果在主工作区打开，不算普通用户 FRIDAY 面板。

### 2.3 Composer 审批结构检查

```powershell
obsidian vault="test" eval code="
const composer=document.querySelector('.friday-chat-composer,.friday-composer,.friday-chat-input-shell');
const decision=document.querySelector('.friday-composer-decision-panel');
const text=(composer?.innerText||'').slice(0,2000);
JSON.stringify({
  hasComposer:!!composer,
  hasDecision:!!decision,
  composerText:text,
  hasModelChrome:/模型|model/i.test(text),
  hasSkillChrome:/\\+Skill|Skill/i.test(text),
  hasMentionChrome:/@/.test(text)
});
"
```

通过标准：

- 审批态时 `hasDecision=true`。
- composer 文本里能看到决策信息。
- composer chrome 仍存在，至少不被审批面板完全移除。

### 2.4 过程面板结构检查

```powershell
obsidian vault="test" eval code="
const shell=document.querySelector('.friday-agent-process-shell');
const details=[...document.querySelectorAll('.friday-agent-process-shell details')].map(d=>({open:d.open,text:d.innerText.slice(0,300)}));
JSON.stringify({
  hasShell:!!shell,
  text:(shell?.innerText||'').slice(0,2000),
  details
});
"
```

通过标准按场景判断：运行中应可见且展开；完成后应折叠且不压过最终答案。

## 3. 逐项真实验收场景

### A01. 本地即时首响不是正式 assistant message

目标：用户发送后，FRIDAY 立即给出本地状态，但这个状态不能假装模型已经理解，也不能持久化为正式 assistant 消息。

准备：

- 使用 deterministic fake model，让模型延迟 2-3 秒再返回 direct answer。
- 清空当前测试会话或新建会话。

操作：

1. 在 composer 输入：`请用一句话回答：FRIDAY 当前在做什么？`
2. 点击发送。
3. 发送后 100-300ms 截图：`A01-01-local-first-response.png`。
4. 模型返回后截图：`A01-02-final-answer.png`。
5. 刷新插件或切换会话回来，再截图/DOM：`A01-03-after-reload.png`。

检查：

- 发送后只允许出现 `FRIDAY 正在响应……`。
- 不允许在模型 intake 前出现 `我理解你想要`、`我会`、`已收到并开始处理`。
- 重新加载后，本地首响不应作为 assistant 消息留在历史里。

通过标准：

- 本地首响短暂出现。
- 最终会话历史只包含用户消息和模型最终 assistant 消息。
- 没有把本地首响持久化。

### A02. 模型请求成功发出后才显示“正在理解”

目标：区分本地首响和模型连接成功后的状态。

准备：

- fake model/runtime 发出明确的 request-start 信号后延迟 2 秒返回 intake。

操作：

1. 发送：`请阅读当前笔记标题并告诉我标题是什么。`
2. 发送后立即截图：`A02-01-before-model-start.png`。
3. request-start 后截图：`A02-02-model-started.png`。
4. intake 返回后截图：`A02-03-intake-returned.png`。

检查：

- request-start 前不能显示 `FRIDAY 正在理解你的请求……`。
- request-start 后才显示 `FRIDAY 正在理解你的请求……`。
- intake 返回后切换为模型理解/执行状态。

通过标准：

- 三个状态顺序正确。
- DOM 禁词扫描无 `model_request` / `model request`。

### A03. 网络失败前置态不伪装成模型已开始

目标：如果网络失败发生在 intake 前，用户必须知道消息保留了，但 FRIDAY 还没有开始处理。

准备：

- fake model adapter 模拟请求未成功发出，或 request exhausted before intake。

操作：

1. 发送：`请总结当前笔记。`
2. 截图失败态：`A03-01-network-failed-before-intake.png`。
3. DOM 文本快照。

检查：

- 必须出现：`暂时没能连接到模型。你的消息已保留，但 FRIDAY 还没有开始处理。`
- 不允许出现：`我理解你想要`、`我会`、`正在执行`、`已开始处理`。
- 失败态不能作为模型 assistant 正式回答留在历史里，除非产品明确把它做成系统状态消息。

通过标准：

- 用户能理解是模型连接问题，不是 FRIDAY 卡死。
- 不误导用户模型已经处理。

### A04. 重试/恢复状态用用户语言呈现

目标：模型连接波动时告知用户正在恢复，但不暴露 transport、retry_scheduled 等内部术语。

准备：

- fake model adapter 第一次失败，第二次成功。

操作：

1. 发送：`请列出当前测试库中三个 Markdown 文件。`
2. retry 中截图：`A04-01-retrying.png`。
3. 成功恢复后截图：`A04-02-recovered.png`。
4. DOM 禁词扫描。

检查：

- retry 文案类似：`模型连接不稳定，FRIDAY 正在重试。`
- 恢复后进入正常 intake/执行。
- 不出现 `transport`、`retry_scheduled`、`request_exhausted`。

通过标准：

- 用户知道网络在恢复。
- 成功后任务继续，而不是留下一个错误卡片。

### A05. direct_answer 简单回答不留下重型过程面板

目标：简单问答应由模型自行判断为 direct answer，最终答案优先。

准备：

- fake model 返回 `interactionRoute=direct_answer`。

操作：

1. 发送：`用一句话解释 Obsidian 是什么。`
2. 首响截图。
3. 最终答案截图：`A05-01-direct-answer-final.png`。
4. 过程面板结构检查。

检查：

- 最终答案是主要内容。
- 不应留下展开的多步过程面板。
- 不应出现工具轨迹或计划步骤。

通过标准：

- 简单任务显得轻，不像 coding agent 全流程。

### A06. clarify 只问必要问题，不制造假计划

目标：信息不足时 FRIDAY 应问澄清问题，而不是假装已经规划或执行。

准备：

- fake model 返回 `interactionRoute=clarify`。

操作：

1. 发送：`帮我整理一下那个文档。`
2. 截图：`A06-01-clarify.png`。
3. 过程面板结构检查。

检查：

- assistant 正常问一个必要问题。
- 没有重型过程面板。
- 没有“我已经开始整理”之类假执行。

通过标准：

- 用户只需要回答澄清问题。

### A07. light_task 显示轻量状态，不展示重型计划

目标：读一个文件、查一个标题这类任务可以显示正在做什么，但不能变成复杂计划。

准备：

- 创建测试文件：`UX验收/A07-light-task.md`。
- fake model 或真实 runtime 走 read-only 工具。

操作：

```powershell
obsidian vault="test" create path="UX验收/A07-light-task.md" content="# A07\n这是一个轻量读取任务。" silent overwrite
```

1. 发送：`请读取 UX验收/A07-light-task.md，并告诉我第一行标题。`
2. 运行中截图：`A07-01-light-running.png`。
3. 完成截图：`A07-02-light-final.png`。
4. 过程面板检查。

检查：

- 可以看到语义化动作，如“正在读取相关笔记”。
- 工具细节默认折叠。
- 不展示多步计划大纲。

通过标准：

- 用户知道 FRIDAY 在读文件，但不会被迫关注工具细节。

### A08. task_with_process 运行中默认展开，完成后默认折叠

目标：复杂泛文档任务需要让用户看到“正在做什么”，但完成后过程不抢最终答案。

准备：

- 准备 3 个测试 Markdown 文件。
- fake model 返回 `interactionRoute=task_with_process` 和可见计划，runtime 执行多个 read/search 动作。

操作：

1. 发送：`请阅读 UX验收 文件夹里的三篇笔记，整理出共同主题。`
2. 运行中截图：`A08-01-running-expanded.png`。
3. 中间步骤截图：`A08-02-mid-process.png`。
4. 完成后截图：`A08-03-completed-collapsed.png`。
5. 过程面板结构检查。

检查：

- 运行中过程面板默认展开。
- 当前动作可见。
- 完成后过程面板默认折叠。
- 最终答案比过程面板更突出。

通过标准：

- 符合 Codex/Manus 类“可看但不粘人”的状态展示哲学。

### A09. 工具轨迹默认折叠，只展示产品化动作

目标：普通用户看到“正在读取/正在整理/正在检查”，而不是 raw tool call。

操作：

1. 使用 A08 运行中的复杂任务。
2. 截图默认态：`A09-01-tools-folded-default.png`。
3. 点击展开工具细节后截图：`A09-02-tools-expanded-on-demand.png`。
4. DOM 禁词扫描。

检查：

- 默认态不出现 raw tool name、args、JSON。
- 展开后可以看到更细信息，但仍尽量产品化。
- 不出现 `tool_call`、`tool_result`、`native tools`。

通过标准：

- 用户默认只看到动作摘要。

### A10. 计时刷新不导致过程面板整体闪烁

目标：运行中秒表或状态刷新不能每秒重建整块过程内容。

准备：

- 使用一个至少运行 8 秒的 fake model/runtime 场景。

操作：

1. 开始长任务：`请阅读三篇笔记并生成一段总结，过程中保持运行 10 秒。`
2. 开始后立即注入 MutationObserver，只观察 process shell 子树替换和 class 重启动：

```powershell
obsidian vault="test" eval code="
window.__fridayFlickerAudit={events:[]};
const shell=document.querySelector('.friday-agent-process-shell');
if(shell){
  const observer=new MutationObserver(ms=>{
    for(const m of ms){
      window.__fridayFlickerAudit.events.push({
        t:Date.now(),
        type:m.type,
        added:m.addedNodes.length,
        removed:m.removedNodes.length,
        target:[...m.target.classList||[]].join(' ')
      });
    }
  });
  observer.observe(shell,{childList:true,subtree:true,attributes:true,attributeFilter:['class','open']});
  window.__fridayFlickerAudit.observer=observer;
}
JSON.stringify({watching:!!shell});
"
```

3. 连续截图：

```powershell
1..8 | ForEach-Object {
  Start-Sleep -Seconds 1
  obsidian vault="test" dev:screenshot path="$out\A10-$($_)-running.png"
}
```

4. 读取观察结果：

```powershell
obsidian vault="test" eval code="JSON.stringify(window.__fridayFlickerAudit?.events?.slice(0,200)||[])"
```

检查：

- 允许计时文本变更。
- 不允许每秒大量 remove/add 整个 process 子树。
- 截图之间不应出现整块面板闪白、动画重新进入、滚动跳动。

通过标准：

- 用户视觉上感觉稳定。
- observer 没有显示 process shell 被周期性重建。

### A11. 文件创建审批前不落盘、不说“已创建”

目标：文件创建必须先进入待确认；审批前不能写入文件，也不能说已经创建。

准备：

- 删除目标文件：`UX验收/A11-created-by-friday.md`。

操作：

```powershell
$target="C:\Own Docm\Coding\Friday - Ob\test\UX验收\A11-created-by-friday.md"
Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
```

1. 发送：`请创建 UX验收/A11-created-by-friday.md，内容是“这是 A11 创建审批测试”。`
2. 待审批截图：`A11-01-pending-create-review.png`。
3. 审批前检查文件：

```powershell
Test-Path "C:\Own Docm\Coding\Friday - Ob\test\UX验收\A11-created-by-friday.md"
```

4. 点击 `应用修改`。
5. 审批后截图：`A11-02-after-apply.png`。
6. 审批后读取文件。

检查：

- 审批前文件不存在。
- UI 使用“已准备/待应用/确认后才会写入”。
- 审批前不出现“已创建”。
- 通过后文件才存在。

通过标准：

- 真实文件系统和 UI 文案一致。

### A12. 文件修改审批前不改原文件、不说“已修改”

目标：修改文件前必须待确认；拒绝后文件保持原样。

准备：

```powershell
obsidian vault="test" create path="UX验收/A12-edit-target.md" content="# A12\n原始内容。" silent overwrite
```

操作：

1. 发送：`请把 UX验收/A12-edit-target.md 里的“原始内容”改成“修改后的内容”。`
2. 待审批截图：`A12-01-pending-edit-review.png`。
3. 审批前读取文件确认仍是原始内容。
4. 点击 `不应用`。
5. 拒绝后截图：`A12-02-after-reject.png`。
6. 再次读取文件。

检查：

- 审批前文件仍是原始内容。
- 拒绝后文件仍是原始内容。
- UI 不能出现“已修改”。
- 拒绝后文案应说明未写入任何文件。

通过标准：

- 拒绝路径安全、清楚、没有假完成。

### A13. 文件删除走用户确认，审批前不删除

目标：删除是高风险文件变更，但普通用户仍应看到文件改动确认，而不是工程化权限系统。

准备：

```powershell
obsidian vault="test" create path="UX验收/A13-delete-target.md" content="# A13\n删除审批目标。" silent overwrite
```

操作：

1. 发送：`请删除 UX验收/A13-delete-target.md。`
2. 待审批截图：`A13-01-pending-delete-review.png`。
3. 审批前确认文件仍存在。
4. 点击 `应用修改`。
5. 审批后截图：`A13-02-after-delete-apply.png`。
6. 审批后确认文件不存在。

检查：

- 审批前不删除。
- 用户看到的是删除后果和确认按钮，不是 raw `delete` tool。
- 不出现 `Allow once/session/always`。

通过标准：

- 删除动作被清楚确认，且没有双重审批噪音。

### A14. 高风险非文件动作只有“允许/拒绝”

目标：非文件副作用审批应占用 composer，并且只有普通用户能理解的二元决策。

准备：

- 通过真实 governed tool path 触发一个本地命令或外部副作用审批。
- 不允许直接 `approvalQueue.enqueue`。

操作：

1. 发送：`请运行一个本地检查命令确认测试目录存在。`
2. 等待审批态截图：`A14-01-high-risk-approval.png`。
3. 点击 `拒绝`，截图：`A14-02-denied.png`。
4. 再发送一次同类请求，点击 `允许执行`，截图：`A14-03-allowed.png`。

检查：

- 审批面板在 composer body。
- 按钮是 `允许执行` / `拒绝`。
- 不出现 `Allow once`、`Allow session`、`Allow always`、`Tool approval required`。
- 拒绝后任务用用户语言解释无法继续。

通过标准：

- 普通用户不需要理解权限粒度。

### A15. 审批态占用 composer body 且保留 composer chrome

目标：审批不是聊天记录里的一个卡片，而是当前输入状态。

操作：

1. 使用 A11 或 A14 的待审批状态。
2. 截图 composer 近景：`A15-01-composer-decision-panel.png`。
3. 执行 composer 审批结构检查。

检查：

- 普通输入区被审批面板替代。
- 模型选择、权限模式、`+Skill`、`@` 等 chrome 仍可见或保留其位置。
- 审批面板是视觉主焦点。

通过标准：

- 用户自然知道“现在轮到我确认”。

### A16. 审批入口唯一，不在过程面板复制 apply/reject

目标：决策入口只能是 composer，过程面板可以说明等待确认，但不能提供第二套按钮。

操作：

1. 使用 A11/A12/A14 待审批状态。
2. 全屏截图：`A16-01-single-approval-surface.png`。
3. DOM 按钮扫描：

```powershell
obsidian vault="test" eval code="
const buttons=[...document.querySelectorAll('button')].map(b=>({text:b.innerText.trim(),classes:b.className}));
JSON.stringify(buttons.filter(b=>/应用|不应用|允许|拒绝|Apply|Reject|Allow|Deny/.test(b.text)));
"
```

检查：

- 同一个审批动作不应同时出现在 composer 和过程面板。
- 如果有过程面板按钮，它只能是查看详情/展开，不能是实际决策按钮。

通过标准：

- 用户不会在两个地方做同一个决定。

### A17. mutation conflict 使用用户语言，不暴露 Before snapshot mismatch

目标：文件在审批前被用户或外部修改时，FRIDAY 应解释需要重新检查，而不是暴露内部冲突字符串。

准备：

1. 创建 `UX验收/A17-conflict.md`，内容为 `版本一`。
2. 发送修改请求，让 FRIDAY 准备把 `版本一` 改成 `版本二`，停在待审批。
3. 审批前手动把文件改成 `外部改动`。

操作：

1. 点击 `应用修改`。
2. 截图冲突态：`A17-01-conflict-user-copy.png`。
3. DOM 禁词扫描。

检查：

- UI 说明“文件在确认前发生变化，需要重新检查/重新准备修改”。
- 不出现 `Before snapshot mismatch`。
- 不出现 stack/error/debug 语气。

通过标准：

- 用户知道为什么没有写入，并知道下一步。

### A18. 旧会话 pending 审批不污染当前 composer

目标：当前 composer 只被当前会话的审批占用。

准备：

1. 会话 A 触发文件修改审批并停留 pending。
2. 切换或新建会话 B。

操作：

1. 在会话 B 截图：`A18-01-new-session-clean-composer.png`。
2. composer 结构检查。
3. 在会话 B 发送一个简单 direct answer。

检查：

- 会话 B composer 不显示会话 A 的审批。
- 会话 B 可以正常输入和发送。
- 回到会话 A 时，A 的审批仍在 A 的上下文中。

通过标准：

- 审批状态按当前 session 归属，不是全局粘住。

### A19. 普通用户界面隔离工程概念

目标：所有普通状态都不能泄露工程概念或英文 fallback。

操作：

1. 分别在 direct answer、clarify、light task、task_with_process、审批、冲突、网络失败状态下运行禁词扫描。
2. 每种状态保存截图和 JSON。

检查禁词：

- `tool`
- `checkpoint`
- `model_request`
- `model request`
- `raw reasoning`
- `debug`
- `replay`
- `View replay`
- `Tool approval required`
- `Allow once`
- `Allow session`
- `Allow always`
- `Before snapshot mismatch`
- `Cancel`
- `Continue`
- `Apply`
- `Reject`

通过标准：

- 普通 FRIDAY 面板没有上述词。
- 如果英文只出现在 Obsidian 自身 UI 或打开的源码/文档，不计入，但必须在报告里说明。

### A20. 用户切换笔记时任务继续

目标：用户不盯着 FRIDAY 面板，任务也应继续。

准备：

- 一个 8-10 秒的 long-running task。

操作：

1. 发起任务：`请阅读 UX验收 文件夹里的多篇笔记并生成总结。`
2. 运行中截图：`A20-01-running-before-switch.png`。
3. 切换到另一个 Markdown 笔记。
4. 等待 5 秒，截图：`A20-02-while-other-note-active.png`。
5. 回到 FRIDAY 面板，截图：`A20-03-return-to-friday.png`。

检查：

- 任务没有因为切换笔记取消。
- 回来后过程状态或最终答案仍在正确会话。
- 没有把结果写到错误会话。

通过标准：

- 用户可以去看别的笔记，不需要盯着过程。

### A21. 用户切换 FRIDAY 会话时，任务归属不丢失

目标：运行中的任务属于启动它的会话；切换会话不应把最终答案写错。

操作：

1. 在会话 A 发起长任务。
2. 切到会话 B，截图：`A21-01-session-b-while-a-running.png`。
3. 等任务完成后，仍在 B 截图。
4. 回到 A，截图：`A21-02-session-a-final.png`。

检查：

- B 不应突然出现 A 的最终答案。
- A 返回后有正确最终答案和完成折叠过程。
- 如果产品当前无法支持跨会话后台完成，记录为差距，不要用脚本注入掩盖。

通过标准：

- 任务状态和输出按启动会话归属。

### A22. 收起 FRIDAY 插件区域后任务继续

目标：用户可以把 FRIDAY 收起来或切到别的对话框，AI 继续工作。

注意：如果当前产品“完全关闭 DailyBoard view 会 abort run”，这应记录为已知能力缺口。不要把“切换笔记但 view 仍存在”偷换成“关闭插件仍后台工作”。

操作：

1. 发起 10 秒长任务。
2. 收起 FRIDAY 侧栏或切换到其他面板，但不要退出 Obsidian。
3. 5 秒后截图：`A22-01-friday-collapsed.png`。
4. 再打开 FRIDAY，截图：`A22-02-friday-restored.png`。

检查：

- 任务是否继续。
- 恢复后是否能看到完成状态或当前进度。
- 如果关闭 view 会中断，明确写入报告：这是后台任务能力缺口。

通过标准：

- 至少“收起/切换”不打断任务。
- 完全关闭 view 是否继续，按当前产品承诺单独结论。

### A23. 完成后最终答案优先，过程不要求用户继续关注

目标：任务结束时，用户首先看到交付结果，而不是过程日志。

操作：

1. 使用 A08 的复杂任务完成态。
2. 截图：`A23-01-final-answer-primary.png`。
3. 过程面板结构检查。

检查：

- assistant 最终答案可见且清晰。
- 过程面板折叠或弱化。
- 不出现“下一步请查看过程日志”这类要求用户关注内部过程的文案。

通过标准：

- FRIDAY 显得从容，不粘人。

### A24. queued input 与审批态不竞争

目标：如果审批期间允许用户继续输入，输入队列必须是次要状态，不能抢审批焦点。

操作：

1. 进入 A11 待审批状态。
2. 尝试输入第二条消息或发送追问。
3. 截图：`A24-01-queued-input-during-approval.png`。

检查：

- 审批面板仍是主焦点。
- queued input 不替代或遮挡审批按钮。
- 如果产品不允许审批期间输入，应该明确禁用并解释，而不是输入后丢失。

通过标准：

- 用户不会误以为新输入已经绕过审批执行。

### A25. 移动窄宽度或小窗下文字不溢出

目标：Obsidian 窄侧栏下，状态文案、审批按钮、过程标题不互相覆盖。

操作：

1. 将 FRIDAY 面板调到较窄宽度，或使用 Obsidian mobile emulation：

```powershell
obsidian vault="test" dev:mobile on
```

2. 分别打开 direct answer、过程运行、审批、冲突状态。
3. 截图：
   - `A25-01-mobile-running.png`
   - `A25-02-mobile-approval.png`
   - `A25-03-mobile-conflict.png`

检查：

- 按钮文字不截断到不可理解。
- composer chrome 不与审批面板重叠。
- 过程面板标题不盖住下一行内容。

通过标准：

- 小窗可用，不需要横向滚动。

## 4. 验收报告模板

验收窗口最后输出一份报告，按下面结构写：

```markdown
# FRIDAY Agent UX Live Acceptance Report

Branch:
Commit:
Test vault:
Plugin artifact hash:
Obsidian version:
Date:

## Summary

- Passed:
- Failed:
- Blocked:
- Not tested:

## Scenario Results

| ID | Result | Evidence | Notes |
| --- | --- | --- | --- |
| A01 | PASS/FAIL/BLOCKED | screenshot + JSON path |  |

## Findings

### P0

- [ ] Finding title
  - Scenario:
  - Evidence:
  - User impact:
  - Likely root cause:
  - Suggested owner/files:

### P1

### P2

## Evidence Folder

`C:\Own Docm\Coding\Friday - Ob\.tmp\friday-live-ux-acceptance-...`

## Explicit Limitations

- Which tests used deterministic fake model:
- Which tests used real model:
- Which tests could not be run:
- Whether any state injection was used:
```

## 5. 验收通过门槛

P0 必须全部通过：

- A01 本地首响不持久化、不伪装模型理解。
- A02 模型请求开始态顺序正确。
- A03 网络失败前置态不误导用户。
- A08 复杂任务运行中展开、完成后折叠。
- A11/A12/A13 文件变更审批前不落盘、不说已完成。
- A14/A15 审批占用 composer body，且只有用户级二元决策。
- A16 审批入口唯一。
- A19 普通用户界面无工程概念泄露。
- A20/A21 切换笔记/会话不导致任务归属错误。

P1 应尽量全部通过：

- A04 retry/recovery 文案。
- A05/A06/A07 intake route 对应体验。
- A09 工具轨迹折叠。
- A10 计时不闪烁。
- A17 冲突文案产品化。
- A18 旧会话 pending 不污染当前 composer。
- A22 收起/切换 FRIDAY 时任务继续。
- A23 最终答案优先。
- A24 queued input 不竞争审批。

P2：

- A25 窄宽度布局稳定。
- 截图命名、报告完整性、证据目录可复现。

## 6. 给验收窗口的启动提示词

可以直接复制下面这段给验收窗口：

```text
你现在负责验收 FRIDAY Agent UX，不负责修复。请在待验收工作树中执行 docs/plans/2026-05-11-friday-agent-ux-live-acceptance-scenarios.zh.md。

目标不是证明测试通过，而是证明普通用户在 Obsidian 里真实看到的首响、过程、审批、文件变更、网络失败、切换会话/笔记等体验符合设计。每个场景必须从用户可见入口进入，允许在模型服务边界使用 deterministic fake model，但禁止直接向 approvalQueue、WorkbenchStateStore、trajectory snapshot 或 renderer 塞最终状态。

请先确认 main.js、manifest.json、styles.css 已刷新到 C:\Own Docm\Coding\Friday - Ob\test\.obsidian\plugins\friday-obsidian-plugin，hash 一致后 reload 插件。每个场景保存截图、短 DOM eval JSON 和文件系统检查结果。最后按文档里的报告模板输出 PASS/FAIL/BLOCKED，并按 P0/P1/P2 列出具体问题、证据路径、用户影响和可能根因。
```
