# FRIDAY 桌面端产品规划总纲

> 本文是 FRIDAY Desktop 方向的主入口。它汇总当前产品判断、关键决策、长期愿景和第一阶段实施路线。详细决策追加到 `2026-06-08-friday-desktop-product-decisions.zh.md`，长期模块平台愿景保留在 `2026-06-06-friday-desktop-module-platform-vision.zh.md`，桌面端 v0 工程实施计划保留在 `2026-06-11-friday-desktop-v0-implementation-plan.zh.md`，早期工程拆解保留在 `2026-06-06-friday-desktop-product-implementation.zh.md`。

## 1. 当前结论

FRIDAY 应从 Obsidian 插件形态升级为独立桌面端产品。Obsidian 后续是 FRIDAY 的一个 host surface，而不是唯一产品中心。

桌面端的核心不是把 Coding Agent 换一层外壳，而是把 PI-first runtime、FRIDAY Agent Kernel、项目资料、产物、技能、模块和 Soul 组织成一个本地优先的工作台。目标用户主要是组织和团队里的泛文档工作者，他们通过 AI 提升工作效率、沉淀知识、复用方法，而不一定把自己的需求表达成写代码或写脚本。

桌面端是新的产品形态，交互上可以脱离 Obsidian 重新组织：窗口布局、右侧资源入口、悬浮详情、模块页、Soul 页和工作区切换都不必受 Obsidian 视图结构限制。但它不是另起一套能力系统。后续产品规划必须先盘点 FRIDAY 已有能力，再决定桌面端如何重组、抽象和产品化这些能力。

当前应优先复用或抽象的既有能力包括：

- Agent Kernel、FridayPiRuntime、PI SDK adapter。
- Runtime progress、Agent trajectory、过程面板和 replay。
- 项目资料、mention/context assembly、memory。
- Skill、Soul、本地状态、权限和 trace persistence。
- 项目边界、Git 同步、产物和文件修改审查。

第一阶段不做完整 marketplace、云账号、移动端或 Obsidian 替代品。第一阶段先证明：FRIDAY 可以作为独立桌面 Host 运行，并在本地工作区里管理资料、对话、产物、技能和模块入口。

### 1.1 桌面端 v0 产品边界

v0 不是完整组织协作平台，而是一个可以跑通核心泛文档工作的本地桌面工作台。

v0 必须跑通：

- 独立 Desktop Host 启动。
- 本地工作区和项目主页。
- 项目切换、开始新对话、打开已有对话。
- 右侧 FRIDAY 完整历史、过程 trace、工具调用和参考文件披露。
- 生成或打开可显示文件后的产物画布。
- 项目资料库 v1：以项目根目录文件树为直接信息来源，登记文件成为资料，保存 metadata、启用 / 暂停。
- 最小项目技能 / 全局技能列表和启用状态。
- 权限模式 v1：安全 / 标准 / 自主，并能把文件修改审查、工具调用、审批和拒绝记录披露到过程区。

v0 先占位：

- 项目 Wiki / 知识图谱。
- 团队总模块。
- 总日历。
- 项目日历。
- 模块页面的完整市场化能力。
- Soul 高级 Agent 行为配置。

v0 明确不做：

- 云账号和组织权限系统。
- 实时多人协作。
- 完整 marketplace。
- 模块自动更新。
- 移动端。
- 完整 Obsidian 替代品。
- 发布安装包和自动升级。

v0 的验收口径是：一个用户可以在一个本地项目里添加资料、开始对话、查看过程、生成或打开产物、看到实际参考文件、保存状态并在下次恢复。

### 1.2 v0 核心工作流状态流

v0 的核心不是“有很多页面”，而是让一个泛文档任务从开始到产物形成完整闭环。

```text
项目主页接收意图
-> 创建或恢复对话
-> FRIDAY 运行并披露过程
-> 生成或打开产物
-> 产物画布接管主区域
-> 回答披露参考文件
-> 对话、产物、trace 和引用状态落盘
-> 下次打开项目时恢复
```

状态规则：

- 用户在项目主页输入框里说明要做什么，FRIDAY 创建新对话。
- 用户点击已有对话时，必须加载该对话的完整历史，并恢复该对话绑定的主产物状态。
- FRIDAY 运行时，右侧区域显示完整对话、过程 trace、工具调用、确认事项和继续输入。
- 当 FRIDAY 生成 Markdown、HTML、报告等可显示文件，或用户手动打开已有可显示文件时，主区域进入产物画布。
- 产物画布接管主区域后，右侧 FRIDAY 区域仍属于同一个对话，不变成独立聊天窗口。
- 回答底部显示 `参考文件 x 个`，点击后展开本次实际参考文件。
- 默认采用标准权限模式：FRIDAY 产物可以自动保存到 `FRIDAY/artifacts/`，写入项目真实文件树前保留修改审查；安全模式更保守；自主模式对齐 Codex Full access，用户明确选择后，FRIDAY 可以完整访问本地文件、运行命令和使用网络，不再默认逐项确认。
- 权限范围摘要：安全适合敏感资料和新项目，真实文件写入、命令、网络、删除和模块变更都需要确认；标准适合默认泛文档工作，项目内读取和 FRIDAY 产物保存不频繁打断，真实文件写回走 diff / patch；自主适合用户明确授权的 Coding Agent 工作，按本机账号权限完整访问文件、命令、网络、Git 和依赖安装。
- v0 不做临时提权。当前权限模式只在输入框底部查看和切换；自主模式不需要在标题区、过程区、设置区反复标识。切回低权限时，如果 FRIDAY 正在执行工具或写文件，需要先停止后续排队动作，再由用户选择停止当前任务或等当前步骤完成后切换。
- 输入框底部工具栏固定为 `+ · 模型名称 · 当前权限模式`。`+` 承载添加文件、图片、Skill 和 `@` 引用；权限切换是当前对话级，不直接修改项目默认权限，新对话再继承项目默认值。
- 通过 `+` 添加项目外文件 / 图片时，默认复制快照到 `FRIDAY/imports/`，再作为当前输入引用；项目内文件只引用相对路径，不复制。`imports/` 不自动进入项目资料库。
- `FRIDAY/imports/` 按对话分目录：`FRIDAY/imports/<conversationId>/<importId>/`，每个 import 目录保存原文件快照和 `import.json`，便于按对话清理、归档和历史恢复。
- 对话生命周期 v0 不做删除，只做归档；归档某个对话时，`FRIDAY/conversations/<conversationId>/` 和 `FRIDAY/imports/<conversationId>/` 一起转入 `FRIDAY/archive/conversations/<conversationId>/`，恢复时整包回到原位置。
- 归档后的对话默认从活跃对话列表和最近对话中隐藏；项目主页的对话区域提供“查看归档对话 x”入口。打开归档对话先是只读状态，恢复后 `conversationId` 不变，输入框为空，并按恢复时间回到活跃对话列表靠前位置。
- `FRIDAY/artifacts/` 下的产物文件不随对话归档移动，只保留对话里的 artifact 关联；归档后当前对话产物列表随对话隐藏，恢复后再显示。
- 对话、产物、trace、引用记录和恢复状态都需要落盘。

## 2. 文档分工

本目录是桌面端规划的统一位置。

```text
docs/plans/friday-desktop/
  2026-06-08-friday-desktop-product-master-plan.zh.md
  2026-06-08-friday-desktop-product-decisions.zh.md
  2026-06-11-friday-desktop-v0-implementation-plan.zh.md
  2026-06-06-friday-desktop-module-platform-vision.zh.md
  2026-06-06-friday-desktop-product-implementation.zh.md
```

各文件职责：

- `index.html`：HTML 规划工作台，面向阅读、评审和视觉决策。
- `2026-06-08-friday-desktop-product-master-plan.zh.md`：总纲，给未来阅读者快速理解方向和当前版本边界。
- `2026-06-08-friday-desktop-product-decisions.zh.md`：决策日志，持续追加已经确认的产品规则。
- `2026-06-11-friday-desktop-v0-implementation-plan.zh.md`：v0 实施计划，把 HostAdapter、状态、权限、资料库、产物和 PI runtime 拆成可执行工程任务。
- `2026-06-06-friday-desktop-module-platform-vision.zh.md`：长期愿景，描述模块平台、Module Builder、社区模块和 Soul 扩展。
- `2026-06-06-friday-desktop-product-implementation.zh.md`：早期工程拆解，保留为历史参考。

原则：总纲只在阶段性收敛时更新；决策日志随讨论及时追加；实施计划随开发进度调整；HTML 用于让规划和视觉预览更容易被阅读和评审。

## 3. 产品对象

FRIDAY Desktop 的第一层产品对象：

```text
工作区
  项目资料库
  对话工作台
  产物区
  技能库
  模块
  Soul
```

- **工作区** 是底层对象，不强制所有工作都叫项目。
- **项目资料库** 是产品侧名称，技术侧仍可叫 `context`。
- **对话工作台** 是用户和 FRIDAY 开始工作的中心；一个工作区可以包含多个对话。
- **产物区** 是对话视图里的组件，展示当前对话已有产物列表；它属于当前对话资源，不是项目主页里的一级管理模块。
- **技能库** 管理会影响 FRIDAY 行为的 Skill。
- **模块** 面向更完整的可安装能力包。
- **Soul** 长期会从 prompt/persona 扩展成可配置的 Agent 行为画像。

启动入口已经确认：

- 在项目页创建新项目时，入口文案使用 **让 FRIDAY 加入一个项目**。
- 点击后，用户选择 **新建文件夹** 或 **选择现有文件夹**。
- 如果用户选择现有文件夹，FRIDAY 先只读查看文件夹结构，再给出初步判断和下一步建议。
- 观察阶段不创建 `FRIDAY/`，也不移动或修改原有文件；用户点击 **加入项目** 后才写入 FRIDAY 管理目录。
- 之后打开时，默认恢复上次使用的工作区。
- 默认第一屏是上次项目的项目主页，而不是工作区列表或某个历史对话。
- 工作区列表只作为切换器，不挡在用户和工作之间。
- 初始化文案采用“工作伙伴”语气：面向用户可以说“让 FRIDAY 加入一个项目”，而不是只说“初始化工作区”。
- 拟人化只用于降低理解成本和建立伙伴感；涉及文件创建、权限、移动和同步时，说明仍然必须清楚、克制、可审查。

现有文件夹观察卡文案已经确认：

```text
FRIDAY 已查看文件夹结构

初步判断：偏代码项目。
判断依据：Git 仓库 · 文档 12 个 · 代码文件 184 个 · README · docs/ · package.json
建议：对于需要作为项目背景资料的文件，请在项目资料库中选择现有文件进行配置。
说明：观察阶段不会创建 FRIDAY/，也不会移动或修改原有文件。

[加入项目] [取消]
```

观察卡不提供 **配置项目资料** 按钮；项目资料库视图和资料配置流程在用户进入项目后再单独定义。

项目工作台布局已经确认：

- 最左侧是常驻总模块栏，固定显示搜索、项目、团队、日历、模块、Soul 和设置；设置放在最下面。
- 团队、日历先作为总模块占位，后续再定义具体页面内容、数据结构和交互细节。
- 用户点击“项目”后，出现第二层项目菜单，显示本机已有的全部项目 / 工作区。
- 用户点击任意项目后，主区域显示该项目主页，而不是直接进入某个对话。
- 第二层项目菜单用于项目切换和进入项目主页，不是进入对话页后的常驻信息。
- 项目主页显示输入框；用户输入后创建或进入新的对话页。
- 项目主页下方显示该项目下全部对话列表；点击已有对话后进入对应对话页面。
- 项目主页还展示项目资料库、项目日历、项目技能、项目 Wiki、项目协作人员和项目远端配置情况的摘要入口。
- 项目日历暂时作为项目管理视图占位，后续再定义任务、会议、排期、提醒或同步规则。
- 项目 Wiki 摘要展示当前项目已经建立的知识图谱；用户点击后进入详细知识图谱界面。
- 进入对话页面后，没有活跃产物时，主区域是对话工作台。
- 进入对话页面后，有活跃产物或用户打开已有可显示文件时，主区域切换为产物画布。
- 进入对话页面后，第二层切换为当前项目导航，显示当前项目、本项目对话列表，并把资料库、Wiki、技能入口靠底部放置，尽量让对话列表展示更多条目。
- 对话页不常驻显示全部项目列表；用户需要切换项目时，再点击最左侧“项目”入口打开项目菜单。
- 对话页面右侧是 FRIDAY 侧栏，加载当前对话的完整历史，并承载过程、确认和继续输入。
- 画布区和右侧 FRIDAY 侧栏属于同一个对话页面；画布区是该对话页面里拆分出来的当前可操作页面。
- 右侧 FRIDAY 侧栏不重复显示对话标题；对话标题由外层对话页面标题承担，项目主页中的对话列表只作为进入入口。
- 资料库、Wiki、技能作为当前项目导航底部的一组项目入口出现，不作为固定右侧主栏完整展开。
- 当前对话资源入口最终采用“**标题行入口 + 共用资源窗口**”布局：对话标题行右侧放一排资源 icon，分别代表资料库、项目文件树、技能和产物。
- 没有画布区时，标题行下方靠右资源窗口承载 **当前对话资源**；用户点击标题行资源 icon 后，只切换同一个资源窗口里的内容。产物默认显示当前对话已有产物列表。
- 画布区出现后，同一排资源 icon 仍放在对话标题行右侧；用户点击后在右侧 FRIDAY 过程区上方悬浮展开共用资源窗口，不作为固定面板挤占过程内容。产物本身继续通过画布标签、当前产物和产物列表进入。
- 当前对话资源窗口的默认 tab 规则：如果当前对话已有产物，默认打开 **产物**；如果还没有产物，默认打开 **资料库**；用户手动切换后，按当前对话记住上次选择。
- 资料库 tab 只显示当前项目中 **已加入资料库的资料清单**，每项只展示文件类型和文件名，不展示摘要、说明、路径、更新时间或完整文件树；窗口内需要预留“进入项目资料库”按钮，跳转到该项目资料库完整页面。
- Wiki 不作为当前对话资源窗口 tab 出现；它保留为项目级知识图谱入口。当前对话资源中的第二个 tab 是 **项目文件树**，用于查看整个项目的文件树。
- 文件树 tab 支持单击文件后在画布中打开；右键文件只显示两个动作：**在画布中打开**、**添加到对话**。添加到对话等同于当前插件版本里的 `@` 功能：把该文件作为 `@文件` 加进当前消息 / 当前对话上下文，不改变项目资料库登记。
- 技能 tab 默认显示项目技能，并允许切换查看全局技能；列表项只显示技能名和一句短用途。点击技能不会直接执行，而是把该技能作为 `@技能` 加入当前输入，等待用户补充任务要求。
- `@` 引用沿用现有 Obsidian 插件的结构化输入思路：输入框里不是普通字符串拼接，而是保存文本和 token 组成的 composer snapshot。桌面端在此基础上扩展 token 类型，至少包含 `@文件`、`@技能`、`@产物`。
- 用户发送消息时，当前输入框里的 `@` 引用随本轮 Turn 冻结为显式引用快照；发送成功后输入框必须清空，不把上一轮引用自动带到下一轮。
- 已发送用户消息下方可以折叠显示“已添加引用 x 个”；FRIDAY 回复底部仍显示“参考文件 x 个”。前者表示用户点名带入的材料，后者表示 FRIDAY 实际参考或使用过的内容，两者不能混为一谈。
- 用户点击项目导航里的资料库、Wiki 或技能后，在主区域打开对应详情窗口。
- 产物作为当前对话的画布相关入口处理，不放入当前项目导航底部的项目入口组。
- 技能详情默认显示项目技能，并允许切换查看全局技能。
- Codex 桌面端可以作为工作台感参考，但不是 1:1 布局参考：FRIDAY 最左侧是常驻小侧栏；第二层在项目切换时是项目菜单，在对话页中是当前项目导航；主区域先进入项目主页，进入对话页后中间是文件或产物画布，最右侧才是 FRIDAY 完整对话和 Agent 工作过程。FRIDAY 参考 Codex 的多面板桌面 Agent 结构，但产品语义必须转向泛文档工作、项目资料库、产物和技能。
- 视觉上不沿用 Codex 参考版配色；桌面端视觉按 FRIDAY VI 收敛到 Graphite、Warm Bone、Muted Teal、Stone 和 Accent，并遵守低侵入、柔和墨色、少量功能色、少阴影和文档感排版原则。
- 当前结构参考预览先不放浏览器地址栏、路径栏和环境信息浮层；这些属于后续工作状态入口设计，不属于第一轮板块放置参考。
- 主 HTML 已以该信息结构作为桌面端工作台定稿预览；另有完整的有画布预览和无画布对话页预览，用于后续实现参考。

工作区本地结构已经确认：

- 使用用户可见的 `FRIDAY/` 目录，不使用隐藏的 `.friday/`。
- 选择已有文件夹作为工作区时，不移动原有文件，只创建 `FRIDAY/`。
- 新建工作区时，FRIDAY 创建空文件夹并初始化 `FRIDAY/`。
- 普通文件夹必须由用户确认“让 FRIDAY 加入项目”后，才初始化为 FRIDAY 工作区。
- 初始化已有文件夹后，不移动原有文件；如果该文件夹本身就是资料库，用户可以把项目内已有文件登记为项目资料。
- FRIDAY 只有一个混合工作区模型，不拆成“文档项目”和“代码项目”两套底层对象。
- 项目根目录和其中的现有文件树就是 FRIDAY 的直接信息来源；不再额外创建 `Knowledge/` 或 `Code/` 作为默认分类目录。
- 项目资料库只登记哪些文件成为资料，保存说明、摘要、启用状态和索引信息；不为项目现有文件创建隐藏复制版本。
- 代码文件、资料文件、兼具两者的文件和排除项都是文件角色，通过 metadata 表达，不改变文件物理位置。
- FRIDAY 生成的文件默认作为 **产物** 保存到 `FRIDAY/artifacts/`；用户可以后续把产物加入资料库，或把产物写入项目文件树中的指定位置。

```text
工作区/
  原有文件...
  FRIDAY/
    project.json
    context/      # 项目资料库登记、说明、metadata；必要时保存被纳入资料库的产物文件
    artifacts/    # 产品侧叫“产物”，保存 FRIDAY 生成物和版本关系
    imports/      # 从 + 添加的项目外文件快照，服务当前对话引用，默认本地
    archive/      # 归档的对话包；对话和按 conversationId 分组的 imports 一起归档
    skills/
    conversations/
    traces/
    references/
    state/
    runtime/
    local/
    workspace.json
```

### 3.1 Git 同步边界

v0 先采用目录级 allowlist，而不是默认把整个 `FRIDAY/` 提交到 Git。`Context` 和项目 `Skill` 不再表述为“默认同步层”，而是 **可共享资产层**；是否进入 Git 由项目来源和 Git Profile 决定。

可共享资产：

```text
FRIDAY/project.json # 最小 FRIDAY 项目共享 manifest
FRIDAY/context/     # 项目资料库登记、metadata；不复制项目现有文件
FRIDAY/skills/      # 当前项目技能
```

默认保守、本地优先：

```text
FRIDAY/conversations/ # 对话历史和单轮消息
FRIDAY/artifacts/     # 产物文件，默认本地；产物可被加入资料库或写入项目文件树
FRIDAY/imports/       # 项目外文件通过 + 加入当前对话时的本地快照
FRIDAY/archive/       # 归档的对话包，默认本地；v0 不做对话删除
FRIDAY/traces/        # 过程 trace 和工具调用明细
FRIDAY/references/    # 每次回答的实际引用记录
FRIDAY/state/         # workspace/canvas/session 状态
FRIDAY/runtime/       # PI / FRIDAY runtime cache
FRIDAY/local/         # 个人 UI、窗口、设备状态
```

产物和 Wiki 暂不作为默认 Git 协作事实来源。产物需要用户显式添加到项目资料库后，才进入 `FRIDAY/context/` 的资料登记，或被用户放入项目文件树中的指定位置；Wiki 后续再决定是共享图谱事实、导出结果，还是本地索引。

Git Profile：

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| `local-only` | 新建本地项目，或选择已有文件夹但不希望影响 Git | FRIDAY 内容只在本机使用；已有 Git 仓库中优先使用本地忽略策略，不主动污染共享仓库文件 |
| `share-friday-layer` | 用户明确希望把 FRIDAY 项目资料和项目技能纳入协作 | 只把 `project.json`、`context/`、`skills/` 视作可提交内容，其它运行态继续本地 |
| `remote-managed` | 用户从远端仓库拉取一个已有 FRIDAY 共享层的项目 | 检测并加载仓库中的 `project.json`、`context/`、`skills/`；缺失时再询问是否初始化 |

真实 Git 环境中的具体问题，例如 `.gitignore`、`.git/info/exclude`、子模块、已有忽略规则、文件大小和冲突处理，先不在产品规划阶段过早展开，后续进入实现和测试时再逐项解决。

### 3.2 落盘对象分层

FRIDAY 的落盘对象先分为三层：

- **项目事实**：`project.json`、`Context` 和项目 `Skill`。这些内容是稳定、可解释、适合多人协作的可共享资产层，但是否进入 Git 由 Git Profile 决定。
- **运行过程**：`Conversation`、`Turn`、`Artifact`、`Trace`、`Reference`。这些内容变化频繁，容易产生冲突，v0 默认本地保存。
- **个人状态**：`Workspace State`、窗口布局、当前打开对话、画布标签、折叠状态、runtime cache。只属于当前设备和当前用户，不进入 Git 协作层。

对象职责：

| 对象 | 存什么 | 默认同步策略 |
| --- | --- | --- |
| `Project` | 最小共享 manifest、工作区识别、schema version、目录识别 | manifest 可共享；个人状态本地 |
| `Context` | 项目文件登记、产物入库文件、说明、metadata、启用状态 | 可共享资产，由 Git Profile 决定是否提交 |
| `Skill` | 项目技能文件、说明、启用状态 | 项目技能可共享；全局技能属于本机 |
| `Conversation` | 对话标题、创建时间、关联产物、历史索引 | 本地 |
| `Turn` | 单轮用户输入、FRIDAY 回复、确认事项 | 本地 |
| `Artifact` | md、html、report 等产物文件和版本关系 | 本地；显式加入资料库或写入项目文件树后才成为项目资料 |
| `Import` | `FRIDAY/imports/<conversationId>/<importId>/` 下的项目外文件 / 图片快照、原始来源、hash、所属 turn | 本地；只服务当前对话引用，后续显式加入资料库或写入项目文件树后才成为项目资料；归档时随 `conversationId` 整包移动 |
| `Trace` | 工具调用、读写文件、命令执行、PI runtime event、审批和失败状态 | 本地 |
| `Reference` | 用户显式添加的引用、发送时解析的引用、FRIDAY 实际使用后披露的参考来源 | 跟随 Turn 本地保存 |
| `Workspace State` | 当前打开对话、窗口布局、画布状态、折叠状态 | 个人本地状态 |

Conversation / Turn / Trace 文件切分已确认采用 **方案 B：Conversation 索引 + Turn 快照 + Trace 独立文件**。

目录结构：

```text
FRIDAY/conversations/
  <conversationId>/
    conversation.json
    turns/
      <turnId>.json
    traces/
      <turnId>.jsonl

FRIDAY/archive/
  conversations/
    <conversationId>/
      conversation/
      imports/
```

职责边界：

- `conversation.json` 只作为对话索引，保存标题、项目 id、创建时间、更新时间、turn 顺序、当前主产物、打开状态和必要摘要。
- `turns/<turnId>.json` 保存单轮稳定快照，包括用户消息、FRIDAY 回复、确认事项、Explicit Reference、Resolved Reference、Answer Reference 和产物关联。
- `traces/<turnId>.jsonl` 保存过程事件流，包括工具调用、读取、写入、命令执行、失败重试、审批、runtime event 和状态更新。
- 历史恢复默认先读取 `conversation.json` 和 `turns/*.json`；只有用户展开过程、调试、复盘或审计时才懒加载对应 `traces/<turnId>.jsonl`。
- v0 不采用“一个对话一个大 JSON”，避免长对话导致单文件过大和恢复成本过高；也不采用全量事件流作为唯一事实源，避免早期 UI 恢复过度复杂。

### 3.3 Reference / Turn / Trace 落盘关系

已确认原则：用户添加的 `@` 引用、FRIDAY 实际读取的文件、回答底部披露的参考文件、过程里展示的读取 / 写入 trace 必须分开存。它们可能指向同一个文件，但产品含义不同。

四类信息的分工：

| 类型 | 含义 | 归属对象 | 主要展示位置 | 是否改变项目资料库 |
| --- | --- | --- | --- | --- |
| `Explicit Reference` | 用户在发送前通过 `@文件`、`@技能`、`@产物` 明确带入的材料 | 当前 `Turn.user` | 输入框 chip；发送后用户消息下方“已添加引用 x 个” | 否 |
| `Resolved Reference` | 发送时被 FRIDAY 解析并进入 prompt / context package 的引用 | 当前 `Turn.references` | 历史恢复、调试和必要时的引用详情 | 否 |
| `Trace Source` | FRIDAY 在执行过程中通过工具实际读取、搜索、写入或运行的目标 | 当前 `Trace` | 右侧过程区、工具 trace、审计记录 | 否 |
| `Answer Reference` | FRIDAY 回复底部披露的实际参考文件或来源 | 当前 `Turn.assistant.references` | 回答底部“参考文件 x 个”，点击展开 | 否 |

这四类信息不能互相替代：

- 用户 `@` 了一个文件，只表示用户希望 FRIDAY 关注它，不代表它一定会出现在回答底部。
- FRIDAY 读取了一个文件，只表示执行过程中访问过它，不代表它一定是回答的主要参考来源。
- 回答底部的“参考文件”应只展示用户能理解的来源，不展示所有工具调用、审批、失败重试或内部 context 事件。
- Trace 必须比 Reference 更完整，用于过程复盘、错误排查和权限审计；Reference 必须更克制，用于用户理解答案来源。

建议的 Turn 结构：

```text
Turn
  id
  conversationId
  status
  user
    text
    composerSnapshot
    explicitReferences[]
  assistant
    text
    answerReferences[]
    artifactIds[]
  runtime
    contextSummary
    eventLogPath
    traceIds[]
    toolRunIds[]
```

建议的 Reference 结构：

```text
ReferenceRecord
  referenceId
  conversationId
  turnId
  phase: user_explicit | resolved_context | assistant_cited
  targetType: file | folder | skill | artifact | selection
  targetUri
  displayName
  fileType
  source: composer | mention_resolver | tool_trace | model_output | manual
  relation: added_to_prompt | resolved_for_prompt | read_by_agent | written_by_agent | shown_as_reference
  visibility: user_message | answer_footer | internal
```

v0 不把 Reference 当成项目资料库条目。只有用户明确选择“加入项目资料库”时，才写入 `Context` / 项目资料库；否则它只是某一轮对话的引用事实。

回答底部的“参考文件 x 个”由 `Answer Reference` 生成，已确认采用 **方案 B：候选来源池 + 受限筛选**。它不是把所有 `@` 引用或所有 trace 直接展示出来，而是先形成候选池，再筛出真正支撑本轮回答的来源。

候选来源池：

- 用户显式 `@` 且已被解析进入 prompt / context package 的文件、产物或选区。
- FRIDAY 通过 read / search / lookup 等工具成功读取，并在最终回答中实际使用的具体文件。
- 当前产物、当前画布选区或截图被用于本轮回答时形成的 artifact / selection reference。
- FRIDAY 本轮生成或修改的产物，如果最终回答正在解释、总结或交付该产物，也可以进入候选池。

展开字段：

- 折叠态只显示 `参考文件 x 个`。
- 展开后每项只显示文件类型图标、文件名和来源类型。
- 来源类型先收敛为 `@引用`、`FRIDAY 读取`、`当前产物`、`选区`。
- 默认不显示完整路径；点击文件在画布中打开，悬停或右键时可以提供查看路径、定位到文件树、加入项目资料库等动作。

排序和去重：

- 用户显式 `@` 的文件按用户添加顺序优先显示。
- 当前产物和选区次之。
- FRIDAY 读取的文件按第一次实际使用顺序显示。
- 同一目标按 `targetType + targetUri` 去重；如果同一文件同时来自多种来源，默认标签优先显示 `@引用`，详情里可以补充“同时被 FRIDAY 读取”。

Answer Reference 最小落盘结构：

```text
AnswerReference
  id
  turnId
  targetType       // project_file | artifact | selection | external_file
  targetUri
  displayName
  fileKind
  primarySourceType // @引用 | FRIDAY读取 | 当前产物 | 选区
  sourceTypes[]
  order
  createdAt
  explicitReferenceIds?
  traceIds?
  artifactId?
  selectionId?
```

必须落盘的字段是 `id`、`turnId`、`targetType`、`targetUri`、`displayName`、`fileKind`、`primarySourceType`、`sourceTypes`、`order`、`createdAt`。可选落盘字段是 `explicitReferenceIds`、`traceIds`、`artifactId`、`selectionId`，用于解释“为什么它进入参考文件”。文件图标、展开状态、hover 文案、右键菜单、是否高亮和 tooltip 里的完整路径只属于 UI 状态，不进入 `AnswerReference` 快照。

默认排除：

- Skill、模块和工具本身不进入“参考文件”，它们在用户消息引用 chip、过程 trace 或资源窗口中展示。
- 失败、被拒绝、只写入但未作为回答依据的工具调用。
- 内部规则、系统 prompt、模型重试、审批事件、纯状态事件。
- 仅作为权限检查、路径探测、目录枚举或恢复状态的 trace。

历史恢复时，Conversation 负责恢复消息顺序；Turn 负责恢复某一轮的用户输入、FRIDAY 回复和引用快照；Trace 只在用户展开过程、调试或复盘时懒加载。

## 4. 项目资料库

产品侧定名为 **项目资料库**。它面向普通用户，不使用“上下文”这个技术词。

关键规则：

- 用户可以从项目文件树中选择文件，也可以把外部文件先放入项目文件树后再登记。
- 用户不必填写说明，但可以给每份资料补充描述。
- 项目资料库不是强制存放所有资料的文件夹，而是 FRIDAY 对项目可用资料的管理视图。
- 项目根目录是直接信息来源；项目内已有文件可以直接作为项目资料，FRIDAY 只登记相对路径、说明、摘要、启用状态和索引信息，不复制原文件。
- 项目内已有文件也可以被识别为代码文件；文件角色通过 metadata 表达，不要求把文件移入某个固定目录。
- 不再默认创建 `Knowledge/` 和 `Code/`；文档、代码、README、docs、方案文档等都保留在项目原有文件树中。
- 外部文件如果要成为项目资料，优先让用户选择放入项目文件树中的位置，再登记为资料；FRIDAY 不在 `context/` 中为普通现有文件创建第二份副本。
- 默认让 FRIDAY 在工作区权限边界内自由判断哪些资料、Skill、产物和模块与当前任务相关。
- FRIDAY 使用资料时应逐层读取：清单、说明、摘要、原文；但这不是限制器，而是为了节省上下文和保持可解释性。
- 回答底部应有折叠区 **参考文件 x 个**，展开后只列出本次实际参考过的文件。
- v1 不需要 SQL；文件系统是事实来源，JSON/Markdown 保存 metadata 和说明。
- 项目主页中的资料库摘要只显示 **已配置 x 份资料**，不在项目主页里展开资料清单。
- 项目资料库完整视图采用左右结构：左侧全量显示项目里的文件夹结构与文件；右侧显示已经加入资料库的文件列表及说明。
- 完整视图不设置 **推荐配置** 分区；FRIDAY 可以显示文件类型和状态，但不替用户把候选资料预先分组为推荐项。
- 项目内文件从左侧文件树加入资料库。用户可以勾选 / 多选文件后点击 **加入资料库**，也可以直接选中文件后拖到右侧已加入列表。
- 已经加入资料库的文件在左侧文件树中保留浅色勾选状态，表示它已经被登记，不代表本次多选。
- 项目内文件加入资料库时，FRIDAY 只登记相对路径、说明和启用状态，不复制、不移动。
- 从项目外添加资料时，使用完整视图下方的 **导入到项目文件树** 按钮，先把文件放到用户确认的位置，再登记为资料。
- 资料添加后不弹必填表单；用户说明可后补，FRIDAY 后台生成摘要和建议用途。
- 资料详情页以原文件信息优先，再展示用户说明和 FRIDAY 的理解。
- 新加入资料默认启用；用户可以暂停资料，暂停后资料仍保留在资料库，但 FRIDAY 默认不参考。
- 用户可以在单次对话中点名、排除或强调某些文件、Skill 或产物；这些是当前任务指令，不改变资料库或技能库的长期状态。
- 回答底部用 **参考文件 x 个** 披露实际参考文件，默认折叠，点击后展开明细。
- 项目资料库 v1 不承担知识图谱视图；知识图谱属于项目主页中的 **项目 Wiki** 入口。

### 4.1 项目 Wiki 和知识图谱

项目 Wiki 暂缓，不进入桌面端 v0 的可用闭环。后续再把它作为项目级知识沉淀入口重新定义，用来展示当前项目已经建立的知识图谱。它和项目资料库分工不同：

- 项目资料库管理资料登记、产物入库文件、说明、摘要和启用状态。
- 项目 Wiki 管理已经沉淀出的知识节点与关系，例如概念、决策、产物、技能、来源资料和关键结论之间的连接。
- 原 Obsidian 插件里的 Wiki 能力还不成熟，只能作为历史探索代码参考，不作为 FRIDAY Desktop 项目 Wiki 的成熟能力基线。
- Desktop 项目 Wiki 应从产品语义和数据对象重新定义，不按旧插件的 ingest / retrieval / graph 流程直接照搬。
- v0 只在项目主页保留项目 Wiki 占位入口，不定义节点、关系、图谱编辑、自动生成或详情页交互。
- 后续版本再讨论项目 Wiki 摘要卡片、详细知识图谱界面、节点筛选、来源追溯和手动校正。

推荐结构：

```text
工作区/
  FRIDAY/
    context/
      registry.json
      metadata/
        <context-id>.json
      items/
        <context-id>/   # 仅用于产物入库或用户明确选择 FRIDAY 托管的资料文件
          original/
          description.md
          extracted.md
          summary.md
      index.json
```

## 5. 产物和资料

产物区已确认是当前对话里的产物列表，并和项目资料库保持分工：

- 产物区只在进入某个对话后出现，是当前对话界面的一部分。
- 产物区本质上是 **当前对话已有产物的列表**。
- 列表项代表 FRIDAY 在该对话中生成、打开或修改过的文件结果。
- 用户点击列表项后，主区域才打开对应产物画布；没有打开产物时，对话主区域仍显示完整对话。
- 产物列表不直接塞进对话标题行；对话标题行右侧只放资料库、文件树、技能、产物四个资源 icon。
- 当前对话资源用这排 icon 切换；没有打开产物画布时，下方右侧共用资源窗口显示当前选中的资源内容。
- 打开产物画布后，资源 icon 仍与对话标题平行；资源内容在右侧 FRIDAY 过程区上方以悬浮窗口展开，避免占用画布标题、产物标签区域和过程内容流。
- 产物 tab 只显示当前对话产生、打开或修改过的产物；每项只显示文件类型和文件名。单击产物在画布中打开。右键产物显示：**在画布中打开**、**添加到对话**、**加入项目资料库**、**放入项目文件树**。
- 产物区不承担项目级文件管理，不出现在项目主页作为一级模块。
- 产物默认不进入项目资料库。
- 用户可以手动选择 **添加到项目资料库**。
- 添加时有两个出口：放入 FRIDAY 托管的资料文件夹，或写入项目现有文件树中的指定位置。
- 如果放入 FRIDAY 托管资料文件夹，FRIDAY 在 `context/items/` 下为该产物创建资料文件夹并登记 metadata。
- 如果写入项目文件树，用户选择目标路径，FRIDAY 把产物写入该位置后登记相对路径。

```text
产物 -> 添加到项目资料库
= 选择放入 FRIDAY 托管资料文件夹
-> 在 context/items/ 下创建资料文件夹
-> 登记为项目资料

产物 -> 放入项目文件树
= 用户选择项目内目标路径
-> 写入该位置
-> 可登记为项目资料
```

这保证“产物历史”和“项目资料”分工清楚：产物区记录 FRIDAY 生成过什么；项目资料库记录哪些文件成为长期资料；项目文件树仍然是用户的真实工作空间。

Artifact 落盘已确认采用 **方案 B：产物文件 + manifest 记录版本关系**。产物不是只覆盖的普通文件，也不在 v0 做完整版本图谱。

推荐目录：

```text
FRIDAY/artifacts/
  <artifactId>/
    artifact.json
    files/
      <versionId>/
        content.<ext>
```

`artifact.json` 最小职责：

```text
Artifact
  id
  conversationId
  title
  displayName
  artifactType      // markdown | html | report | code | image | other
  renderable        // 是否可在画布渲染
  currentVersionId
  versions[]
  createdTurnId
  updatedTurnId?
  source            // generated | opened | imported | modified
  promotedToContext // 是否已加入项目资料库
  contextId?
  writtenToProjectTree // 是否已写入项目文件树
  projectTreePath?
  createdAt
  updatedAt
```

`versions[]` 只记录能解释用户可见状态的关键版本：初次生成、用户确认后的修改、手动打开并纳入对话、写入项目文件树或加入资料库前的快照。v0 不记录每次自动保存和内部重试。

产物关系规则：

- 当前对话产物列表读取本对话关联的 `artifactId` 列表。
- 画布打开的是 `currentVersionId` 指向的文件。
- `@产物` 引用的是 artifact id 和当时的 version id，避免后续修改改变历史消息语义。
- 代码文件如果由 FRIDAY 生成，默认也先是产物；用户选择“放入项目文件树”后，才成为项目中的真实代码文件。
- 产物加入项目资料库时，写入 `context` metadata，并在 `artifact.json` 中回写 `promotedToContext` 和 `contextId`。
- 产物写入项目文件树时，写入用户选择的相对路径，并在 `artifact.json` 中回写 `writtenToProjectTree` 和 `projectTreePath`。

已有项目文件打开到画布已确认采用 **方案 B：按来源区分，创建轻量 Artifact wrapper**。

- FRIDAY 生成的文件由 `FRIDAY/artifacts/` 托管，文件内容保存在 `files/<versionId>/content.<ext>`。
- 用户从项目文件树手动打开已有文件时，不复制原文件，只创建一个 `artifact.json` wrapper 指向项目相对路径。
- wrapper 的 `source` 使用 `opened_project_file`，并记录 `storageMode: project_file_reference`、`projectTreePath`、打开时的 `observedHash?`、`observedMtime?` 和 `openedTurnId?`。
- 已有项目文件作为当前对话产物进入产物列表，是为了让画布、对话历史、`@产物` 和状态恢复有稳定句柄，不代表 FRIDAY 托管了该文件副本。
- 用户要求 FRIDAY 修改已有项目文件时，先生成修改草稿或 patch；用户确认后再写回 `projectTreePath` 指向的真实文件。
- 写回后在 `artifact.json` 中追加一次可见版本记录，记录应用的 turn、写入路径、新 hash / mtime 和可回溯 trace id。
- 如果用户希望保留一个独立产物副本，可以另存为 FRIDAY 托管产物；这不是默认行为。

## 6. 技能库

技能库管理 Skill。Skill 是会影响 FRIDAY 后续行为的能力或规则，所以不能和普通产物混在一起。

Skill 在产品和技术上都应被理解为显式能力文件。FRIDAY Agent 可以在当前任务中自由判断是否调用项目 Skill、全局 Skill 或相关模块；用户点名某个 Skill 时，应视为强显式引用。

Skill 分两个范围：

```text
项目技能
全局技能
```

项目技能只在当前工作区生效，存在工作区目录里。全局技能对所有工作区可用，存在本机 FRIDAY 全局目录里。

已确认规则：

- FRIDAY 不在普通对话中主动推荐生成 Skill。
- 用户进入技能库后，可以主动从对话、产物、流程说明或资料集合中创建 Skill。
- 用户主动创建项目 Skill 后，默认保存到当前项目技能并立即启用。
- 项目技能可以手动提升为全局技能，提升后默认启用。
- 技能库里必须始终提供启用/暂停开关。
- 项目技能和全局技能没有优先级；它们只区分范围和存储位置。
- 如果多个 Skill 冲突，不靠隐含优先级自动裁决，而是提示用户选择或修改。

推荐结构：

```text
工作区/
  FRIDAY/
    skills/

用户本机/
  .friday/
    skills/
```

## 7. 模块和 Soul

长期方向是让 FRIDAY Desktop 支持用户管理和创建本地模块。

模块页面应承载：

- 用户自己写的模块。
- FRIDAY 帮用户生成的模块草稿。
- 已安装本地模块。
- 可研究、可吸收的社区模块候选。

Module Builder Agent 的长期价值是：用户可以在 FRIDAY 里描述自己想要的工作方式或能力，FRIDAY 根据 FRIDAY 模块协议生成模块草稿，再由用户审查、修改、启用。

Soul 的长期方向也要扩大。现阶段 Soul 主要通过 prompt 实现差异化；未来 Soul 可以定义 agent loop、模块组合、工具策略、规划风格、记忆策略和 UI 偏好。

## 8. 现有能力到桌面端映射

这一轮不继续发散团队、日历、完整模块市场。先把现有 FRIDAY 能力映射到桌面端 v0，明确哪些可以复用、哪些需要抽象、哪些应后移；技术栈已在 M2 决策中收敛为 Electron-first。

| 现有能力 | 当前代码位置 | 桌面端产品落点 | v0 是否需要 | 缺口 | 后续任务 |
| --- | --- | --- | --- | --- | --- |
| 对话、runtime progress、tool trace、Agent trajectory | `src/services/AgentRuntimeService.ts`、`src/core/agent-kernel/contracts/AgentTurn.ts`、`src/views/agentProcessPanelViewModel.ts`、`src/views/agentTrajectoryRenderer.ts`、`src/views/DailyBoardView.ts` | 右侧 FRIDAY 过程区、完整历史、任务控制、过程折叠 | 必须 | 过程 UI 仍和 Obsidian / `DailyBoardView` 绑定 | 抽出 host-neutral conversation shell 和 process panel view model |
| PI Runtime / PI SDK adapter | `src/core/agent-kernel/pi/FridayPiRuntime.ts`、`src/core/agent-kernel/pi/RealPiSdkSessionAdapter.ts`、`src/core/agent-kernel/pi/FridayPiRuntimePorts.ts`、`src/services/ObsidianFridayPiRuntimeHostAdapter.ts`、`src/services/PersistedFridayPiSessionHostAdapter.ts`、`src/services/FridayPiRuntimeStateStore.ts` | Desktop 主 Agent Runtime | 必须 | 现在已有 Obsidian host bridge 和 persisted wrapper，但没有 Desktop HostAdapter | 新增 `DesktopFridayPiRuntimeHostAdapter` 和 Desktop host surface contract |
| 项目、工作区、Git 和远端状态 | `src/features/workbench/ProjectEditorService.ts`、`src/features/workbench/WorkbenchStateStore.ts`、`src/features/sync/SyncOrchestrator.ts`、`src/platform/git/SimpleGitOperator.ts`、`src/utils/projectWorkspacePolicy.ts` | 项目创建 / 加入、项目主页、远端状态、同步入口 | 必须 | 现有语义偏 vault / plugin project，需要改成普通本地文件夹项目 | 定义 Desktop workspace layout、Git Profile 和项目主页状态模型 |
| 项目资料库、context、mention、memory | `src/core/context/PromptContextEngine.ts`、`src/core/context/ContextAssembler.ts`、`src/core/context/mention/MentionResolver.ts`、`src/views/components/MentionComposer.ts`、`src/core/memory/MemoryStoreV1.ts`、`src/services/ProjectContentService.ts` | 项目资料库、`@` 添加到对话、回答底部参考文件 | 必须 | mention 类型目前偏 note / folder / skill，没有项目文件树、产物、外部导入和回答引用快照 | 扩展 Reference model、项目资料 metadata 和 `@` token 类型 |
| 项目 Wiki / 知识图谱 | 旧 Wiki 相关代码仅作调研参考：`src/services/WikiIngestService.ts`、`src/core/retrieval/WikiLookupService.ts`、`src/core/retrieval/WikiKnowledgeProvider.ts`、`src/core/retrieval/RelationGraphBuilder.ts`、`src/core/retrieval/CapabilityIndexBuilder.ts`、`src/features/wiki/TagPolicyRuntime.ts` | 项目主页 Wiki 占位入口，后续再做知识图谱 | v0 暂缓 | 原插件 Wiki 不成熟，不能当成可直接复用的产品能力；桌面端缺新的 Wiki 数据模型、图谱交互和沉淀规则 | v0 只保留占位入口；后续重新定义项目 Wiki 对象、节点 / 关系 schema 和详情页骨架 |
| 产物、画布和可显示文件 | `src/views/agentTrajectoryRenderer.ts`、`src/views/DailyBoardView.ts`、`src/core/mutations/MutationPlan.ts`、`src/core/mutations/MutationPlanStore.ts`、`src/core/mutations/MutationApplier.ts`、`src/features/workbench/WorkbenchStateStore.ts` | 产物画布、当前对话产物列表、打开已有文件、产物写入项目文件树或加入资料库 | 必须 | 现有产物更多是结果展示和 workspace 打开动作，还没有独立 `ArtifactStore` 与画布状态 | 定义 `ArtifactStore`、产物 manifest、画布打开 / 并列 / 版本规则 |
| 权限模式、工具审批、修改审查 | `src/core/policy/CapabilityPolicy.ts`、`src/core/tools/ToolGateway.ts`、`src/services/ToolApprovalService.ts`、`src/services/WorkspaceAccessService.ts`、`src/core/security/policy-resolver/PolicyResolverCore.ts`、`src/core/security/policy-resolver/PolicyMatrix.ts`、`src/core/mutations/*` | 输入框底部安全 / 标准 / 自主模式、文件修改审查、过程 trace | 必须 | 现有 policy 能力在插件里存在，但桌面端三档权限、完全访问和路径边界需要重新命名和收口 | 定义 Desktop permission profile，并接入 composer toolbar 与 mutation review |
| Skill 管理和调用 | `src/services/SkillCommandService.ts`、`src/core/execution/SkillRegistry.ts`、`src/core/execution/InvocationResolver.ts`、`src/core/execution/ExecutionOrchestrator.ts`、`src/skills/packs/builtin/*` | 项目技能 / 全局技能列表、`@skill`、从对话沉淀 Skill | 必须但先做轻量 | 现有 Skill 发现和调用可复用，但项目 / 全局范围、编辑、提升到全局还缺产品化存储 | 定义 `SkillLibraryStore`、scope、启用状态和沉淀入口 |
| Soul | `src/services/SoulStore.ts`、`src/features/soul/SoulProfile.ts`、`src/features/soul/SoulExperimentTemplates.ts`、`src/types/soul.ts` | Soul 页和设置入口 | 部分需要 | 当前主要是 prompt / persona 层，还不是可定义 agent loop 的行为系统 | v0 只复用现有 Soul 管理，高级 loop / 模块组合延后 |
| 本地状态、trace persistence 和归档 | `src/services/RuntimeStateStore.ts`、`src/services/FridayPiRuntimeStateStore.ts`、`src/features/workbench/WorkbenchStateStore.ts`、`src/core/runtime/TurnEventLog.ts` | 对话恢复、过程恢复、归档箱、导入文件随对话归档 | 必须 | 已有多类状态存储，但没有按桌面端 `FRIDAY/conversations/<id>/`、`FRIDAY/imports/<id>/`、`FRIDAY/archive/` 收敛 | 定义桌面端 state layout 和迁移边界，不迁移旧插件数据 |
| 模块平台和社区模块 | 相关基础：`src/services/SkillCommandService.ts`、`src/core/execution/*`、PI SDK dependency；完整模块协议尚不存在 | 总模块页、Module Builder、社区模块吸收路径 | v0 暂缓 | 还没有 FRIDAY 模块协议、模块 manifest、权限声明和社区导入流程 | v0 只保留入口占位；在 runtime shell 跑通后单独设计模块协议 |
| 团队和日历 | 当前只有项目协作 / 远端状态基础，完整团队和日历模型尚不存在 | 总团队、总日历、项目日历、项目协作人员 | v0 占位 | 没有完整数据模型和协作语义 | 项目主页保留卡片和入口，后续独立规划 |

v0 切分结论：

- v0 必做：Desktop HostAdapter、项目主页、对话页、过程区、权限模式、项目资料库、Reference / Trace 分离、产物画布、ArtifactStore、状态恢复和归档。
- v0 轻量做：项目 / 全局技能列表、现有 Soul 管理入口。
- v0 暂缓：项目 Wiki / 知识图谱、完整模块协议、社区 marketplace、Module Builder、团队协作系统、完整日历系统、高级 Soul agent loop。

### 8.1 桌面端 v0 功能清单

这一版 v0 不追求完整平台感，而是证明 FRIDAY Desktop 可以跑通一个本地优先的泛文档工作闭环。

| 功能区 | v0 要做到 | 明确不做 | 主要对象 | 验收口径 |
| --- | --- | --- | --- | --- |
| Desktop shell | 独立窗口启动、最左侧总模块栏、项目入口、设置入口、基本窗口恢复 | 多账号、云工作区、插件市场壳 | `WorkspaceState` | 打开应用后能看到项目入口，并恢复上次打开项目 |
| 项目主页 | 显示当前项目、输入框、对话列表、资料库摘要、技能摘要、协作 / 远端状态、Wiki / 团队 / 日历占位 | 完整项目管理、团队权限、日历任务系统、Wiki 图谱详情 | `Project`、`WorkspaceState`、`Conversation` | 用户能从项目主页开始新对话或打开已有对话 |
| 项目创建 / 加入 | 新建文件夹、选择已有文件夹、远端仓库拉取入口占位；已有文件夹先观察再加入 | 自动整理用户文件、自动提交 Git、强制创建知识 / 代码目录 | `Project`、`GitProfile` | FRIDAY 能在不移动原文件的情况下加入一个本地文件夹 |
| 对话页 | 加载完整历史、右侧 FRIDAY 过程区、继续输入、任务状态、停止 / 继续、当前对话资源入口 | 多人实时协作、跨项目对话合并 | `Conversation`、`Turn`、`Trace`、`WorkspaceState` | 打开任意对话后能恢复历史和当前主产物 |
| 输入框 / 权限栏 | `+ · 模型名称 · 权限模式`；`+` 包含添加文件 / 图片、Skill、`@`；权限为当前对话级安全 / 标准 / 自主 | 临时提权、复杂规则编辑器、组织级权限策略 | `Turn`、`Import`、`PermissionProfile` | 发送一轮消息时冻结当时的权限模式和显式引用 |
| 项目资料库 | 左侧项目文件树，右侧已加入资料库文件列表和说明；支持多选 / 拖拽加入、外部导入、启用 / 暂停、说明编辑 | 自动知识图谱、AI 排序、复杂标签系统 | `Context`、`Import`、`Reference` | 项目内文件登记引用，项目外文件复制快照后可加入资料库 |
| 产物画布 | 当前对话产物列表、打开 Markdown / HTML 等可显示文件、顶部标签切换、可后续扩展并列视图 | 完整版本图谱、多人协同编辑、所有格式完美渲染 | `Artifact`、`Conversation`、`WorkspaceState` | FRIDAY 生成或用户打开可显示文件后，主区域进入产物画布 |
| Reference / Trace | 回答底部显示 `参考文件 x 个`；过程区披露读取、写入、工具调用、审批、失败和重试 | 把所有 trace 都塞进回答底部、完整 provenance graph | `Reference`、`Trace`、`Turn` | 用户能区分“我添加的引用”“FRIDAY 实际读取”“回答披露的参考文件” |
| Skill | 项目技能 / 全局技能列表、启用状态、`@skill` 引用；项目 Skill 可提升到全局的入口占位 | 完整模块协议、社区导入、自动生成复杂模块 | `Skill` | 用户能看到项目和全局技能，并在对话中引用 |
| Soul / 设置 | 复用现有 Soul 管理入口、模型和权限基础设置 | 高级 agent loop、自定义工具策略、团队共享 Soul | `SoulProfile`、`PermissionProfile`、`WorkspaceState` | 用户能切换基本 Soul / 设置，不影响 v0 主流程 |
| 归档 / 恢复 | 对话归档、`FRIDAY/imports/<conversationId>/` 随对话归档、恢复后继续对话 | 删除、云备份、跨设备恢复 | `Conversation`、`Import`、`Artifact` | 归档从活跃列表隐藏，恢复后历史和输入状态正常 |
| 暂缓入口 | Wiki、团队、日历、模块页保留占位或入口说明 | 真实团队协作、完整日历、模块市场、Module Builder | `Project`、`WorkspaceState` | 用户能看到未来入口，但不会误以为 v0 已支持 |

### 8.2 核心对象冻结表

下表把 v0 需要先稳定的对象重新按工程优先级排列。第 3.2 节仍保留完整落盘分层；这里用于指导第一轮桌面端实现。

| 对象 | v0 最小字段 | 默认位置 | 读写方 | 备注 |
| --- | --- | --- | --- | --- |
| `Project` | `id`、`name`、`rootPath`、`schemaVersion`、`createdAt`、`gitProfile`、`defaultPermissionMode` | `FRIDAY/project.json` | Desktop Host、项目主页、Git Profile | 可共享资产，由 Git Profile 决定是否提交 |
| `WorkspaceState` | `activeProjectId`、`activeConversationId`、`activeArtifactId`、`layout`、`resourcePanelState`、`lastOpenedAt` | `FRIDAY/state/`、`FRIDAY/local/` | Desktop shell、项目主页、画布 | 个人本地状态，不进入协作层 |
| `Conversation` | `id`、`projectId`、`title`、`status`、`turnIds`、`artifactIds`、`activeArtifactId`、`createdAt`、`updatedAt` | `FRIDAY/conversations/<conversationId>/conversation.json` | 对话页、归档、状态恢复 | v0 只做归档，不做删除 |
| `Turn` | `id`、`conversationId`、`role`、`content`、`permissionSnapshot`、`explicitReferences`、`answerReferences`、`artifactIds`、`createdAt` | `FRIDAY/conversations/<conversationId>/turns/<turnId>.json` | Runtime adapter、对话页、Reference renderer | 发送时冻结输入框状态和权限模式 |
| `Trace` | `traceId`、`turnId`、`eventType`、`toolName`、`target`、`status`、`startedAt`、`endedAt`、`summary` | `FRIDAY/conversations/<conversationId>/traces/<turnId>.jsonl` | Runtime adapter、过程区、审计 | 比 Reference 更完整，历史恢复时懒加载 |
| `Reference` | `referenceId`、`turnId`、`phase`、`targetType`、`targetUri`、`displayName`、`fileType`、`sourceTypes` | 随 Turn 快照保存，必要时索引到 `FRIDAY/references/` | Composer、Mention resolver、Answer footer | 用户添加、运行解析、回答披露必须分层 |
| `Artifact` | `id`、`conversationId`、`title`、`artifactType`、`renderable`、`currentVersionId`、`source`、`versions[]`、`createdTurnId` | `FRIDAY/artifacts/<artifactId>/artifact.json` 和 `files/` | Runtime adapter、产物画布、资料库 | 生成代码也先作为产物，写入项目文件树后才变成真实项目文件 |
| `Import` | `importId`、`conversationId`、`turnId`、`originalName`、`originalPath`、`fileType`、`hash`、`storedPath`、`createdAt` | `FRIDAY/imports/<conversationId>/<importId>/` | Composer、项目资料库、归档 | 只处理项目外文件 / 图片快照 |
| `Context` | `contextId`、`sourceType`、`projectRelativePath?`、`artifactId?`、`importId?`、`displayName`、`description`、`enabled` | `FRIDAY/context/` | 项目资料库、PromptContextEngine | 项目内文件登记引用，项目外文件先进入 Import |
| `Skill` | `skillId`、`scope`、`displayName`、`description`、`enabled`、`sourcePath`、`createdFromConversationId?` | 项目：`FRIDAY/skills/`；全局：本机全局 skills 目录 | Skill 库、Runtime adapter、Composer | v0 先做列表和启用状态，不做完整模块协议 |
| `PermissionProfile` | `mode`、`projectDefault`、`conversationOverride`、`turnSnapshot` | `FRIDAY/project.json`、`Conversation`、`Turn` | Composer、ToolGateway、Runtime adapter | 安全 / 标准 / 自主三档；不做临时提权 |
| `GitProfile` | `mode`、`remoteUrl?`、`branch?`、`shareFridayLayer`、`lastCheckedAt` | `FRIDAY/project.json` 或 `FRIDAY/state/` | 项目主页、Sync / Git service | v0 只表达状态和基础策略，不做复杂冲突 UI |

### 8.3 剩余缺口排序

进入工程实施计划前，还需要把下面几件事定得足够硬：

1. **Desktop HostAdapter contract**：它是 runtime、文件系统、权限、Git、trace 和 UI 的分界线，优先级最高。
2. **ArtifactStore 与画布状态**：产物是桌面端区别于插件形态的核心体验，必须先定文件结构、打开规则和恢复规则。
3. **项目资料库 metadata**：需要把项目内文件登记、项目外快照、产物入库和说明编辑统一到一套对象上。
4. **Reference / Trace UI contract**：必须保证回答底部参考文件和过程 trace 不混在一起。
5. **技术栈选择**：M1 冻结 HostAdapter 能力后，M2 已确认 v0 选择 Electron-first；下一步必须验证 Electron `BrowserWindow`、preload bridge 和本地 renderer smoke。
6. **Skill / Soul 最小边界**：v0 只做列表、启用和引用，不做模块平台和高级 Soul loop。

上述缺口已拆解到 `2026-06-11-friday-desktop-v0-implementation-plan.zh.md`。工程执行时应先推进 Baseline、HostAdapter ports、Desktop shell tech spike、ProjectHost、FileSystemHost、Permission / Trace / ToolExecution 和 PI Runtime smoke，再进入完整 UI 集成。

### 8.4 Desktop HostAdapter contract 草案

Desktop HostAdapter contract 是 FRIDAY Runtime 与桌面端真实环境之间的能力合同。它不等于 Electron / Tauri 的具体 API，也不等于 UI 组件；它定义 Runtime 可以向 host 请求什么、host 必须怎么执行、哪些动作要被权限系统拦截、哪些结果要进入 trace。

核心原则：

- Runtime 不直接读写桌面文件系统，不直接操作窗口、Git、系统命令或 UI。
- Desktop HostAdapter 负责把 Runtime 请求翻译成桌面端真实动作，并返回结构化结果。
- 所有可能影响本地文件、命令、网络、Git 或用户可见状态的动作，都必须经过权限模式和 trace。
- Obsidian host 和 Desktop host 可以实现同一类 contract，但 Desktop 是 v0 主 host。
- Contract 先按能力域定义，不在这一层绑定 Electron / Tauri 技术栈。

能力域：

| 能力域 | Runtime 可以请求 | Desktop HostAdapter 负责 | 必须进入 trace |
| --- | --- | --- | --- |
| Project | 获取当前项目、解析项目路径、读取 Git Profile、读取默认权限 | 管理项目根目录、`FRIDAY/` 布局、项目 manifest 和项目状态 | 项目切换、项目初始化、Git Profile 变更 |
| FileSystem | 读取项目文件、读取 / 写入 `FRIDAY/` 状态、复制外部导入、写入产物 | 做路径解析、权限检查、快照复制、原子写入和错误返回 | 读文件、写文件、移动、删除、外部路径访问 |
| Runtime State | 保存 Conversation、Turn、Trace、Reference、Artifact、WorkspaceState | 提供稳定落盘结构和恢复接口 | 状态保存失败、恢复失败、归档 / 恢复 |
| Permission | 获取当前对话权限模式、冻结 turn 权限快照、请求用户确认 | 实现安全 / 标准 / 自主三档策略，处理拒绝和停止 | 拦截、确认、拒绝、模式切换 |
| Tool Execution | 执行命令、调用工具、读取工具结果 | 连接 ToolGateway、shell、Git、文件工具和后续模块工具 | 工具开始、输出摘要、成功、失败、取消 |
| Trace / UI Event | 发送过程事件、回答引用、状态更新、确认事项 | 把事件推给右侧过程区、回答底部、通知和审计视图 | 所有 runtime progress、tool call、approval、reference |
| Artifact Surface | 创建产物、打开产物、更新产物版本、切换当前画布 | 管理 ArtifactStore、画布状态、渲染入口和项目文件树写入 | 产物创建、打开、版本变更、写入项目文件树 |
| Project Library | 登记资料、编辑说明、启用 / 暂停、外部导入转资料 | 管理 `FRIDAY/context/` metadata、项目文件引用和 import 快照 | 资料加入、暂停、说明修改、外部导入 |
| Skill / Soul | 列出技能、引用技能、读取当前 Soul | 管理项目 / 全局 skill 列表、基础 Soul 状态 | 技能启用、禁用、引用，Soul 切换 |
| Git | 读取 status / diff、检测远端、执行同步动作 | 封装 Git 操作、冲突检测和 Git Profile 策略 | status、diff、commit、push、pull、冲突 |

最小接口形态：

```text
DesktopHostAdapter
  getActiveProject()
  resolveProjectPath(pathIntent)
  readProjectFile(path)
  writeProjectFile(path, content, options)
  writeFridayState(kind, payload)
  readFridayState(kind, id)
  createImport(file)
  createArtifact(payload)
  openArtifact(artifactId)
  registerContextItem(payload)
  listSkills(scope)
  getPermissionSnapshot(conversationId)
  requestApproval(action)
  executeTool(invocation)
  emitTrace(event)
  persistTurn(turn)
  archiveConversation(conversationId)
  restoreConversation(conversationId)
```

这些名字只是规划草案，不是最终 TypeScript 命名。真正实现时可以拆成多个 port，例如 `ProjectHostPort`、`FileSystemHostPort`、`ArtifactHostPort`、`PermissionHostPort`、`TraceHostPort`。

Runtime 与 HostAdapter 的典型调用链：

```text
用户发送消息
-> Composer 生成 Turn 输入和权限快照
-> Runtime / PI session 开始运行
-> Runtime 请求 HostAdapter 读取资料、执行工具或写入产物
-> HostAdapter 检查权限并执行真实动作
-> HostAdapter emitTrace 到过程区
-> Runtime 生成回复和 AnswerReference
-> HostAdapter persistTurn / persistArtifact / persistWorkspaceState
-> UI 恢复对话、参考文件和当前画布
```

权限规则：

- 安全 / 标准模式下，HostAdapter 可以拒绝、暂停或请求用户确认；Runtime 必须接受结构化拒绝结果，不绕过 host 直接执行。
- 自主模式下，HostAdapter 放宽默认拦截，但仍记录 trace，并保留停止任务的入口。
- Turn 发送时冻结权限快照；即使用户之后切换权限，历史 Turn 的执行解释仍以当时快照为准。
- 外部路径、命令执行、删除 / 移动、Git push / reset、安装依赖和修改 Skill / 模块等高风险动作必须被 HostAdapter 标记风险等级。

不属于 HostAdapter 的职责：

- 不决定 FRIDAY 该怎么思考、怎么规划任务、怎么组织回复。
- 不把 UI 文案或视觉状态写进 Runtime。
- 不直接实现 PI SDK 的 agent loop；PI Runtime 只通过 Adapter 调用 host 能力。
- 不承担完整模块市场、团队协作、云同步或高级 Soul 行为定义。

v0 需要先定这个 contract，再选技术栈。否则 Electron / Tauri 的比较会过早变成“哪个壳更好”，而不是“哪个壳更适合承载 FRIDAY 所需 host 能力”。

## 9. 实施路线

第一阶段应围绕 v0 可用闭环推进，而不是一次性实现完整桌面平台：

1. 建立可启动的 Desktop shell 和 Desktop HostAdapter。
2. 接通 PI Runtime / Agent Kernel smoke。
3. 抽出对话页、过程区和 composer 的 host-neutral UI contract。
4. 建立本地项目主页、项目切换和 `FRIDAY/` 状态布局。
5. 做项目资料库 v0、`@` 引用和回答底部参考文件快照。
6. 做 ArtifactStore、当前对话产物列表和产物画布。
7. 做安全 / 标准 / 自主三档权限与修改审查。
8. 接入 Skill 列表和 Soul 入口；项目 Wiki 仅保留占位。
9. 做状态恢复、归档箱和最小回归验收。
10. v0 稳定后再进入模块协议、Module Builder 和社区能力吸收。

实施原则：

- 不删除 Obsidian，先把它降级为兼容 surface。
- Runtime contract 尽量复用已有 Agent Kernel、FridayPiRuntime、PI SDK adapter、tool trace 和 state persistence。
- 桌面端 renderer 不直接依赖 Obsidian API。
- 本地文件、shell、网络、外部路径都必须经过 FRIDAY 权限和 trace 层。

## 10. 当前不做

- 完整 marketplace。
- 账号系统和云同步。
- 模块自动更新。
- 任意远程代码执行。
- 移动端。
- 完整 Obsidian 替代品。
- 发布安装包和自动升级。

## 11. 下一步

当前处于产品形态和信息架构收敛阶段，还不是最终工程选型阶段。现有能力到桌面端 v0 的映射、功能清单、核心对象表和 Desktop HostAdapter contract 草案已经形成第一版。下一步应把它进一步收束成 **工程任务分期**。

建议下一轮先讨论：

1. 按 HostAdapter 能力域拆工程包：Project、FileSystem、Permission、Trace、Artifact、Context、Skill、Git。
2. Desktop shell 的最小工程形态：窗口、路由、项目主页、对话页、产物画布和设置。
3. ArtifactStore、Project Library Store、Conversation Store 的最小实现顺序。
4. v0 smoke 验收路径：创建 / 加入项目 -> 添加资料 -> 开始对话 -> 运行 FRIDAY -> 生成或打开产物 -> 披露参考文件 -> 保存并恢复。
5. 技术栈选择：M2 已选择 Electron-first。Electron main process 负责桌面壳、PI SDK / FRIDAY Runtime / tool trace / state persistence；preload 负责受控桥；renderer 负责 UI。

技术栈已经进入 v0 决策状态，但仍需用工程 smoke 继续收敛风险：桌面端必须本地优先，必须能访问真实文件系统，必须能承载 PI SDK / FRIDAY Runtime / tool trace / state persistence，必须能脱离 Obsidian 运行并保留 Obsidian 作为兼容 surface。下一步应先验证 Electron `BrowserWindow`、preload bridge、renderer 隔离和 HostAdapter IPC，再进入完整 UI integration。

等 v0 功能清单和工程任务分期确认后，再回到实施计划，从 HostAdapter contract、Electron shell bridge 和 PI runtime smoke 开始开发。
