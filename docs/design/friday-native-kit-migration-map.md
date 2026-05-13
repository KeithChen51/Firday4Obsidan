---
title: FRIDAY Native Kit Migration Map
status: draft
updated: 2026-05-13
tags:
  - friday/design
  - friday/migration
  - friday/native-kit
---

# FRIDAY Native Kit 迁移路线图

这份路线图把 [[friday-native-kit]] 转成后续代码迁移顺序。
目标不是马上抽象一整套组件库，而是先让当前可见 UI 按 Native Kit v0.2 收敛。

## 当前决策

数据来源：`docs/design/native-kit-catalog-decisions.json`

| 状态 | 数量 |
| --- | ---: |
| 保留 | 14 |
| 调整 | 0 |
| 暂缓 | 1 |

暂缓项：`项目状态组`。

迁移原则：

- 先迁移助手、执行过程、Task Bar、审批和输入区，因为它们属于同一个信息系统。
- 工作台顶部栏可作为同批可见改进。
- 设置组件只迁移已经明确的 Native Kit 形态，不做大范围品牌化。
- `项目状态组` 暂缓，不进入首批迁移。

补充扫描候选：

- 跨组件元组件先沉淀为命名和样式规则：状态徽标、文件类型图标、低强调事件行、运行中表面、浮层列表项、控制按钮组。
- 新增组件候选已进 HTML 画板：设置页状态反馈、变更审阅 Diff、首次引导步骤、运行状态提示组、能力控制中心、对话记录抽屉、同步冲突差异。
- 这些候选不改变当前 `native-kit-catalog-decisions.json` 的 14/0/1 选择计数；需要用户在画板中确认后再进入正式迁移计数。

## 当前代码锚点

静态搜索下，首批迁移主要会碰到这些文件：

- `src/views/DailyBoardView.ts`
- `src/views/agentTrajectoryRenderer.ts`
- `src/views/agentProcessPanelViewModel.ts`
- `src/views/components/MentionComposer.ts`
- `src/views/components/MentionDropdown.ts`
- `src/views/skillReviewNotePopoverPlacement.ts`
- `src/settings/FridaySettingTab.ts`
- `src/ui/obsidian-native/SettingsKit.ts`
- `styles.css`

相关测试：

- `tests/native-kit-catalog-server.test.mjs`
- `tests/agent-process-panel-style-regression.test.mjs`
- `tests/daily-board-ui-regression.test.mjs`
- `tests/settings-native-groups-regression.test.mjs`
- `tests/settings-project-ui-regression.test.mjs`

## 首批迁移顺序

### 0. 跨组件元组件

原因：

- 多个新增候选都在重复表达状态、文件、事件、浮层和控制按钮。
- 先统一元组件，后续迁移不用在每个 Kit 里重写一遍基础样式。

主要文件：

- `styles.css`
- `src/ui/obsidian-native/SettingsKit.ts`
- `src/views/agentTrajectoryRenderer.ts`
- `src/views/components/MentionComposer.ts`
- `src/views/components/MentionDropdown.ts`

迁移点：

- 状态徽标统一 ready、waiting、active、warning 等语义。
- 文件类型图标统一支持 Markdown、Canvas、HTML/代码、普通笔记。
- 工具调用、同步日志和后台记录复用低强调事件行。
- 运行中表面只用弱背景和低幅度动画，并遵守 `prefers-reduced-motion`。
- 低强调事件行和运行中表面共用等高的一行信息条；主内容单行截断，宽度不足时省略多余信息。
- Skill、`@` 文件、会话菜单复用浮层列表项。
- 模型、权限、`@`、`+Skill`、搜索、刷新、设置复用控制按钮组。
- 工具统一行动类 icon，Skill 统一技能/组件类 icon，会话行暂不做差异化 icon。

验证：

- 静态测试覆盖元组件 class 存在。
- 静态测试同时阻止大组件继续使用旧局部 class，例如旧状态徽标、旧文件类型 icon、局部工具 icon、局部浮层项和局部运行条。
- 手动检查明暗主题、紧凑密度和 reduced motion。

### 1. 对话输入区 + Task Bar

原因：

- 用户输入、Skill、`@`、权限、模型、Task Bar、审批都围绕 composer 发生。
- 如果这里不统一，后续助手消息和执行过程也会继续割裂。

主要文件：

- `src/views/DailyBoardView.ts`
- `src/views/agentTrajectoryRenderer.ts`
- `src/views/agentProcessPanelViewModel.ts`
- `styles.css`
- `tests/agent-process-panel-style-regression.test.mjs`
- `tests/daily-board-ui-regression.test.mjs`

迁移点：

- Task Bar 收起态贴住输入框上方。
- Task Bar 展开态显示已完成、执行中、未开始步骤。
- 输入框保留模型、权限、`@`、`+Skill`、发送。
- 去掉输入框下方小上下文状态条。
- Skill token 显示技能名，不显示 `/`。
- Skill 列表项显示技能名，不显示 `Skill` 前缀。
- Skill 列表和 `@` 文件选择都向输入框上方展开。
- `@` 文件列表可按文件类型显示 icon，已选 token 不显示 icon。

验证：

- 静态测试覆盖关键 class、文案和废弃结构不存在。
- 手动检查收起态是否真正贴住输入框。
- 手动检查展开态是否显示未开始的后续步骤。

### 2. 审批强提醒

原因：

- 审批会阻塞对话，是输入区状态的一部分。
- 审批样式已经确认，不需要保留单独的重复组件。

主要文件：

- `src/views/DailyBoardView.ts`
- `styles.css`
- `tests/agent-process-panel-style-regression.test.mjs`

迁移点：

- 继续使用 `friday-approval-card`。
- 审批阻塞时渲染在 composer/input shell 内。
- 文案说明等待内容和确认后的结果。
- 主按钮为明确继续动作，次按钮低强调。
- 不添加执行中动画。

验证：

- 静态测试确认审批进入输入区结构。
- 手动检查审批状态不会和普通输入态同时争抢主视觉。

### 3. 助手消息

原因：

- 用户消息和 FRIDAY 输出的结构已经明确不同。
- 工具调用、正文、产物需要在同一套消息语法下展示。

主要文件：

- `src/views/DailyBoardView.ts`
- `src/views/agentTrajectoryRenderer.ts`
- `styles.css`
- `tests/daily-board-ui-regression.test.mjs`

迁移点：

- 用户消息保持右侧气泡。
- FRIDAY 输出改为文档流。
- FRIDAY 身份每组输出出现一次。
- 正文、工具调用、产物使用不同但相关的样式。
- 工具调用使用低强调 icon + 工具名 + 操作内容。
- 不使用重卡片承载工具调用。

验证：

- 静态测试确认 document-flow 类存在。
- 静态测试确认工具调用不使用旧重卡片结构。
- 手动检查长正文和多工具记录的扫描效率。

### 4. 执行过程时间线 + 产物

原因：

- 执行过程和助手输出存在信息交叉，应该共用事件语言。
- 产物需要按文件类型区分，适配 `.md`、`.canvas`、普通笔记等场景。

主要文件：

- `src/views/agentTrajectoryRenderer.ts`
- `src/views/agentProcessPanelViewModel.ts`
- `styles.css`
- `tests/agent-process-panel-style-regression.test.mjs`

迁移点：

- 工具事件保持轻量。
- 执行过程不重复 Task Bar 的当前摘要。
- 产物行显示文件类型 icon。
- Markdown、Canvas/白板、普通笔记或文档至少可区分。

验证：

- 静态测试覆盖 artifact icon class 或 renderer 分支。
- 手动跑一次会产生 `.md` 和 `.canvas` 的流程。

### 5. 工作台顶部栏

原因：

- 工作台顶部栏是高频入口，品牌身份和项目控制要稳定。
- 这部分和 composer 信息系统耦合较低，可以在前几项稳定后迁移。

主要文件：

- `src/views/DailyBoardView.ts`
- `styles.css`
- `tests/daily-board-ui-regression.test.mjs`

迁移点：

- 左侧保留品牌 logo + `FRIDAY`。
- 项目选择器保留。
- 搜索、刷新、设置使用原生紧凑控制。
- 不使用多余的孤立 icon 容器。

验证：

- 静态测试覆盖品牌 logo、`FRIDAY`、项目选择器和操作按钮。
- 手动检查明暗主题。

### 6. 设置组件

原因：

- 设置页的基础形态已经明确，但不需要在首批里做大范围重构。

主要文件：

- `src/settings/FridaySettingTab.ts`
- `src/ui/obsidian-native/SettingsKit.ts`
- `styles.css`
- `tests/settings-native-groups-regression.test.mjs`

迁移点：

- 设置页框架。
- 设置行状态。
- 危险操作设置行。
- 设置页状态反馈。
- 前置条件列表。
- 空状态。
- 行内提醒。

验证：

- 继续使用现有设置页回归测试。
- 手动检查设置页在明暗主题下的密度和层级。

### 7. 新增扫描候选

原因：

- 本轮扫描发现多个已有代码 surface 尚未进入 Native Kit。
- 它们不是都要立刻迁移，但需要先进入画板，避免后续继续各自演化。

候选组件：

- 变更审阅 Diff：来自 `friday-mutation-review-*`，应并入审批信息系统。
- 首次引导步骤：来自 `friday-onboarding-*`，应保持配置缺口列表风格。
- 运行状态提示组：覆盖后台 Agent、输入排队和临时覆盖条。
- 能力控制中心：来自 `friday-control-center-*`，包含工具权限、Skill 分组和审阅说明。
- 对话记录抽屉：来自 `friday-ai-session-*`，包含搜索、分组、批量选择、重命名和空状态。
- 同步冲突差异：来自同步冲突和 diff surface，可独立于暂缓的项目状态组先定义。

迁移点：

- 先在 HTML 画板中评审，不直接改运行时代码。
- 能组合元组件的地方必须先组合元组件。
- `项目状态组` 仍保持暂缓；同步冲突差异不是解除项目状态组暂缓。

验证：

- 静态测试确认这些候选出现在 HTML 和规范文档。
- 用户确认画板选择后，再更新 `native-kit-catalog-decisions.json` 和迁移优先级。

## 暂缓范围

### 项目状态组

状态：暂缓。

原因：

- B 版本的紧凑方向可以保留为参考，但还不是最终规范。
- 项目焦点、风险、状态、行动入口的层级还需要单独设计。
- 不应该在首批迁移中把未定样式固化成公共组件。

要求：

- 首批迁移不改 `项目状态组`。
- 不从 `项目状态组` 抽样式 token 或组件。
- 后续如果重启，需要重新放回组件候选画板横向比较。

## 验证策略

首批迁移前：

- 确认 `native-kit-catalog-decisions.json` 仍是 14 保留、0 调整、1 暂缓。
- 确认 `项目状态组` 仍为 `hold`。
- 确认 [组件候选画板](native-kit-catalog.html) 仍可打开。

首批迁移中：

- 每迁移一个组件，补一条对应静态回归测试。
- 对 composer、Task Bar、审批做浏览器或 Obsidian 手动检查。
- 对明暗主题至少各检查一次。

首批迁移后：

- 运行 `npm test`。
- 如果存在无关历史失败，记录具体失败测试和断言，不把它混进 Native Kit 结论。
- 更新本路线图，把已迁移项改为完成状态。

## 完成标准

- [ ] 首批组件都能映射到 [[friday-native-kit]] 中的规范。
- [ ] `项目状态组` 没有被迁移或重构。
- [ ] 助手、Task Bar、执行过程和审批使用一致的信息语法。
- [ ] 对话输入区覆盖未输入、Skill、`@`、Task Bar、审批状态。
- [ ] 产物能按文件类型区分。
- [ ] 明暗主题下视觉层级一致。
- [ ] 相关测试通过，或无关失败被明确记录。
