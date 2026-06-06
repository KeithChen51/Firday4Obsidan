# FRIDAY 桌面端模块平台长期愿景

**状态：** 长期产品与架构记录。

**范围：** 本文记录 PI-first runtime 规划过程中形成的远期方向。它不是当前 v1 的实现任务，也不应作为第一轮 PI 接入的阻塞项。

## 1. 核心判断

FRIDAY 未来不应该只是一个带 AI 能力的 Obsidian 插件，而应该逐步成为一个桌面端 Agent Host。Obsidian 仍然可以是一个重要面板，但桌面版 FRIDAY 应该是更宽的本地工作台：用户可以组合、查看、安装、编写和调试自己的 Agent 能力。

PI-first 方向让这件事更可信。PI 本质上是 coding-agent runtime 和扩展生态，FRIDAY 可以借助它让用户在本地改造 Agent 行为；同时，FRIDAY 继续掌握权限、产品体验、状态持久化、审批流程和 host surface。

长期定位可以概括为：

```text
FRIDAY = 产品化的本地 Agent Host
PI = runtime 与生态底座
Obsidian = 其中一个 host surface
模块 = 用户和社区定义的能力单元
Soul = 可配置的 Agent 行为画像
```

## 2. 桌面端模块页面

桌面版 FRIDAY 应该有一个独立的模块页面。这个页面不是简单的 Skill 列表，而是管理所有会改变 FRIDAY 工作方式的可安装、可启用、可编辑能力。

模块页面至少应该包含三类来源：

1. **用户自己创建的本地模块**
   - 由 FRIDAY 根据用户需求生成的模块。
   - 高级用户手写或手动编辑的模块。
   - 存放在本地，可以作为文件直接查看和修改。

2. **已安装的可信模块**
   - 当前 FRIDAY 工作区中已经启用的模块。
   - 每个模块应显示权限、触发方式、影响的界面和最近运行记录。
   - 用户可以启用、禁用、更新、删除或回滚。

3. **公开社区模块**
   - FRIDAY 社区或 PI 社区发布的模块。
   - 页面应支持发现、源码查看、风险标记、安装预览和版本固定。
   - 社区模块不应只限于 Skill，也可以包含 workflow、prompt、tool、UI card、connector、agent loop strategy 等。

关键产品含义是：模块页面会成为用户理解和控制 FRIDAY 扩展能力的地方。

## 3. 模块类型

“模块”这个概念应该比 Skill 更宽。未来的 FRIDAY 模块可以包含：

- **Skill：** 可复用的工作方法、触发条件、输入输出、约束、人工复核和评估规则。
- **Prompt：** 可复用的提示词模板和任务入口。
- **Workflow：** 多步骤流程，例如周报生成、研究包整理、会议纪要汇总。
- **Tool：** 带 schema、权限、执行 adapter 和结果契约的可调用能力。
- **Connector：** 与本地应用、Vault、项目目录、浏览器、代码库或外部 API 的连接。
- **UI surface：** 卡片、面板、审查组件、审批卡和模块专属视图。
- **Memory rule：** 记忆什么、存在哪里、如何检索。
- **Agent loop policy：** 规划策略、澄清策略、工具重试策略、subagent 调度、复核策略和停止条件。
- **Model routing：** 首选模型、thinking level、fallback 策略和特定任务的模型路由。

这个更宽的定义很重要。一个真正有用的 Agent 能力通常不只是一个 prompt。它可能同时需要 workflow、UI contract、tool policy、storage policy 和 review pattern。

## 4. Module Builder Agent

因为 PI 本质上是 coding-agent 框架，FRIDAY 桌面版未来可以支持自举式模块生成：

```text
用户提出一个能力需求
  -> FRIDAY 澄清需求
  -> FRIDAY 生成模块设计
  -> FRIDAY 生成模块文件
  -> FRIDAY 运行校验和 smoke test
  -> FRIDAY 展示权限和行为预览
  -> 用户批准安装
  -> 模块成为 FRIDAY 的可用能力
```

示例：

```text
用户：我希望 FRIDAY 每周五整理本周会议笔记，并生成周报草稿。

FRIDAY 生成：
- manifest.json
- README.md
- skills/weekly-report/SKILL.md
- prompts/weekly-report.md
- workflows/weekly-report.workflow.json
- permissions.json
- tests/weekly-report.test.ts
```

这会让 FRIDAY 成为一个能够自我扩展的产品。用户不需要理解模块协议，FRIDAY 可以把自然语言工作流需求翻译成本地可查看、可测试、可安装的模块。

安装流程必须是 review-first：

- 显示模块会读取哪些内容。
- 显示模块会写入哪些内容。
- 显示是否需要网络、shell、外部路径或应用集成。
- 显示触发方式和自动化条件。
- 显示生成的测试和校验结果。
- 允许用户安装、拒绝、编辑或保留为草稿。

## 5. Soul 概念扩大化

当前 Soul 更多是 prompt 级的人设或行为预设。长期来看，Soul 应该扩大为完整的 Agent 行为画像。

未来的 Soul 可以定义：

- 身份和语气；
- system prompt 和任务 framing；
- 首选模块和禁用模块；
- 可用工具和权限模式；
- planning style；
- clarification style；
- memory retrieval policy；
- subagent 或 reviewer 策略；
- model routing 和 fallback；
- UI 呈现偏好；
- 默认 workflow。

这意味着 Soul 可以从：

```text
Soul = prompt / persona preset
```

演化为：

```text
Soul = agent loop + module set + prompt + memory + tool policy + UI behavior
```

例如，一个 “Research Soul” 可以偏好 web/search 模块、引用工作流、证据表格和保守写入权限。一个 “Writing Soul” 可以偏好草稿/改写 workflow、风格记忆和轻量澄清。一个 “Project Operator Soul” 可以偏好任务规划、同步工具、Git/项目模块和更严格的审批规则。

Soul 对普通用户仍然应该是可理解的。产品界面可以显示简单标签和摘要，高级用户再查看底层配置。

## 6. 与 PI 社区模块的关系

FRIDAY 不需要一开始就成为完整的 PI package host。它可以分阶段吸收 PI 社区能力：

1. **Hostless absorption**
   - 审查社区模块的源码、prompt、schema 和 workflow。
   - 把有价值的部分翻译成 FRIDAY 原生模块。
   - 执行仍然走 FRIDAY 的 host adapter 和 approval system。

2. **PI-compatible module schema**
   - 让 FRIDAY 模块文件可以映射到 PI-style skill、prompt、tool 和 extension 概念。
   - 降低社区设计迁移到 FRIDAY 的摩擦。

3. **Selective package host**
   - 通过受控 bridge 加载可信 package。
   - 要求显式权限、版本固定、源码查看和 runtime trace。
   - UI、审批、存储和 host 执行继续由 FRIDAY 控制。

基本原则是：

```text
社区模块提供能力灵感和可复用 building blocks。
FRIDAY 保留 product host、permission host 和 user experience host 的角色。
```

## 7. 产品边界

模块平台不能让普通用户感觉自己在管理 coding-agent 的内部控制台。

用户界面应该使用产品语言：

- 说“创建一个能力”，不要说“写一个 extension”。
- 说“这个模块可以读取这些文件夹”，不要说“tool permission manifest”。
- 说“FRIDAY 需要你的回答才能继续”，不要说“ask_user_question tool”。
- 说“审查生成的修改”，不要说“mutation approval protocol”。

开发者界面可以暴露更深层结构：

- module manifest；
- tool schema；
- workflow JSON；
- permission declaration；
- test result；
- trace log；
- source path；
- package provenance。

这样既能让普通用户理解 FRIDAY，也保留 hacker-first 的高级可塑性。

## 8. 分阶段路线

### Stage 1: 模块协议草案

先定义低风险的 FRIDAY 模块协议：

- manifest；
- Skill；
- prompt；
- workflow；
- permission；
- test。

默认不允许任意可执行代码。

### Stage 2: 模块生成草稿流

允许 FRIDAY 根据用户需求生成模块草稿。模块在用户审查前保持 disabled。

最小流程：

```text
request -> clarify -> design -> generate files -> validate -> preview -> install or keep draft
```

### Stage 3: 模块页面

新增桌面端模块页面，列出本地模块、已安装模块和社区模块。

页面应显示：

- 状态；
- 来源；
- 权限；
- 触发方式；
- 影响的界面；
- 已安装版本；
- 最近运行；
- 最近错误；
- 回滚操作。

### Stage 4: 扩展 Soul Profile

允许 Soul 引用模块和 agent-loop policy，而不只是 prompt。

到这一阶段，Soul 会成为用户意图和 runtime 行为之间的桥。

### Stage 5: 选择性社区 Bridge

增加对 PI-compatible package 或 FRIDAY community module 的受控支持。

这一阶段需要：

- source inspection；
- permission review；
- version pinning；
- package trust label；
- local sandbox 或 host adapter 限制；
- runtime trace persistence。

## 9. 战略含义

长期机会不只是让 FRIDAY 变得更强，而是让 FRIDAY 变得可适配。

用户不必等待产品团队实现每一个工作流，而是可以让 FRIDAY 为自己的领域创建 workflow。社区模块也不只是一个固定插件市场，而是可以被查看、编辑、重组和再发布的能力素材。

这会让 FRIDAY 形成一种不同的产品形态：

```text
FRIDAY 不只是 AI workspace。
FRIDAY 是一个在用户控制下构建和修改自身能力的本地 Agent 平台。
```

这仍然是长期方向，不是 v1 要求。当前 PI-first runtime 工作应继续聚焦在可靠 runtime 接入、host adapter、权限、trace 和持久化上。
