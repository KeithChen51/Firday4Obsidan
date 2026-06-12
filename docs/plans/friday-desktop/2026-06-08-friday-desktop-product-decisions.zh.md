# FRIDAY 桌面端产品决策记录

> 本文用于记录 `codex/friday-desktop-product-vision` 分支中已经确认的产品决策。它不是完整实施计划，而是后续桌面端、项目资料库、产物区、技能库和模块平台设计的事实来源。

## 1. 产品定位

- FRIDAY Desktop 面向以泛文档工作为主的团队和组织用户。
- 用户不一定把自己理解为程序员，也不一定明确要求“写脚本”或“写代码”；FRIDAY 要把 AI 能力包装成工作效率、知识沉淀、资料组织和流程协作能力。
- Obsidian 后续只是一个面板或 host surface，不再是 FRIDAY 的唯一产品形态。
- PI-first runtime 是底层 Agent Runtime 方向，但产品侧不把 FRIDAY 表达成 Coding Agent。
- 长期方向是本地优先的工作台：用户可以管理资料、对话、产物、技能和模块，也可以让 FRIDAY 帮助编排或生成自己的能力模块。

## 2. 核心对象

FRIDAY Desktop 的第一层产品对象先收敛为：

```text
工作区
  项目资料库
  对话工作台
  产物区
  技能库
  模块
  Soul
```

- 对外仍然可以讲“项目”，但底层对象以“工作区”为准，因为不是所有工作都围绕严格项目展开。
- 工作区可以承载项目、团队知识库、复盘空间、客户案例、周期性会议、个人工作流等。
- 首页形态是工作台，而不是营销首页或传统仪表盘。

## 3. 项目资料库

产品侧名称定为 **项目资料库**，技术侧仍可继续使用 `context`。

推荐文案：

```text
模块名：项目资料库
项目内操作：加入资料库
项目外操作：导入到项目文件树后登记
产物操作：添加到项目资料库
回答引用区：参考文件 x 个
详情页：资料说明 / FRIDAY 的理解
```

基本规则：

- 项目资料库承载当前工作区中 FRIDAY 可以参考的文件、文本和说明。
- 项目根目录和其中的现有文件树是 FRIDAY 的直接信息来源。
- 用户可以把项目文件树里的文件加入项目资料库，也可以先把外部文件放入项目文件树后再登记。
- 项目资料库不是强制存放所有资料的文件夹，而是 FRIDAY 对项目可用资料的管理视图。
- 项目内已有文件可以登记为项目资料，FRIDAY 记录相对路径、说明、摘要、启用状态和索引信息，不复制原文件。
- 项目内已有文件也可能是代码、知识资料或两者兼具；文件角色通过 metadata 表达，不通过自动移动文件表达。
- 不再创建 `Knowledge/` 和 `Code/` 作为默认分类目录；现有文档、代码、README、docs、方案文档等都保留在项目原有文件树中。
- FRIDAY 不在 `context/` 中为普通现有文件创建隐藏复制版本。
- 用户不需要强制填写说明；但可以对每个资料补充一段描述。
- 资料默认按添加顺序展示，可以提供文件类型、文件名、导入时间等简单排序。
- 默认所有启用资料都属于当前对话可用范围，但 FRIDAY 不应每次把全部原文塞进模型，而应按清单、说明、摘要、原文逐层使用。
- FRIDAY 回答底部应提供折叠的 **参考文件 x 个**，展开后只列出本次实际参考过的文件。

推荐本地结构：

```text
工作区/
  FRIDAY/
    context/
      registry.json
      metadata/
        <context-id>.json
      items/
        <context-id>/ # 仅用于产物入库或用户明确选择 FRIDAY 托管的资料文件
          original/
            文件.pdf
          description.md
          extracted.md
          summary.md
      index.json
```

v1 不需要 SQL。文件系统是事实来源，JSON/Markdown 存 metadata 和说明。后续如果引入 SQLite，只作为可重建索引或缓存。

## 4. 产物与资料的关系

- 产物区只在进入某个对话后出现，是当前对话界面的一部分。
- 产物区本质上是 **当前对话已有产物的列表**。
- 列表项代表 FRIDAY 在该对话中生成、打开或修改过的文件结果。
- 用户点击列表项后，主区域才打开对应产物画布；没有打开产物时，对话主区域仍显示完整对话。
- 产物列表不直接塞进对话标题行；对话标题行右侧只放资料库、文件树、技能、产物四个资源 icon。
- 当前对话资源用这排 icon 切换；用户点击产物后，下方共用资源窗口显示当前对话已有产物列表。
- 打开产物画布后，资源 icon 仍与对话标题平行；资源内容在右侧 FRIDAY 过程区上方以悬浮窗口展开，避免占用画布标题、产物标签区域和过程内容流。
- 当前对话资源窗口默认 tab：已有产物时默认打开 **产物**；没有产物时默认打开 **资料库**；用户手动切换后，按当前对话记住上次选择。
- 产物 tab 只显示当前对话产生、打开或修改过的产物；每项只显示文件类型和文件名。单击产物在画布中打开。右键产物显示：**在画布中打开**、**添加到对话**、**加入项目资料库**、**放入项目文件树**。
- 产物区不承担项目级文件管理，不出现在项目主页作为一级模块。
- 已确认原则：产物默认不自动进入项目资料库。
- 用户可以手动选择把产物添加到项目资料库。
- 添加时有两个出口：放入 FRIDAY 托管的资料文件夹，或写入项目现有文件树中的指定位置。

规则：

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

结果：

- 产物区记录 FRIDAY 生成过什么。
- 项目资料库记录哪些文件成为长期资料。
- 项目文件树仍然是用户真实工作空间。
- 不用为了资料库把用户已有文件二次复制一份。
- `metadata.json` 可以记录 `sourceType: artifact`、`sourceArtifactId`、`promotedAt` 和 `targetPath`。

已确认：Artifact 落盘采用 **方案 B：产物文件 + manifest 记录版本关系**。产物不是只覆盖的普通文件，也不在 v0 做完整版本图谱。

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

版本规则：

- `versions[]` 只记录能解释用户可见状态的关键版本：初次生成、用户确认后的修改、手动打开并纳入对话、写入项目文件树或加入资料库前的快照。
- v0 不记录每次自动保存、内部重试和临时中间结果。
- 当前对话产物列表读取本对话关联的 `artifactId` 列表。
- 画布打开的是 `currentVersionId` 指向的文件。
- `@产物` 引用 artifact id 和当时的 version id，避免后续修改改变历史消息语义。
- 代码文件如果由 FRIDAY 生成，默认也先是产物；用户选择“放入项目文件树”后，才成为项目中的真实代码文件。
- 产物加入项目资料库时，写入 `context` metadata，并在 `artifact.json` 中回写 `promotedToContext` 和 `contextId`。
- 产物写入项目文件树时，写入用户选择的相对路径，并在 `artifact.json` 中回写 `writtenToProjectTree` 和 `projectTreePath`。

已确认：用户手动打开项目里的已有文件到画布时，采用 **方案 B：按来源区分，创建轻量 Artifact wrapper**。

规则：

- FRIDAY 生成的文件由 `FRIDAY/artifacts/` 托管，文件内容保存在 `files/<versionId>/content.<ext>`。
- 用户从项目文件树打开已有文件时，不复制原文件，只创建一个 `artifact.json` wrapper 指向项目相对路径。
- wrapper 的 `source` 使用 `opened_project_file`，并记录 `storageMode: project_file_reference`、`projectTreePath`、打开时的 `observedHash?`、`observedMtime?` 和 `openedTurnId?`。
- 这个 wrapper 让已有项目文件可以进入当前对话产物列表、画布、`@产物` 和状态恢复，但不表示 FRIDAY 托管了该文件副本。
- 用户要求 FRIDAY 修改已有项目文件时，先生成修改草稿或 patch；用户确认后再写回 `projectTreePath` 指向的真实文件。
- 写回后在 `artifact.json` 中追加一次可见版本记录，记录应用的 turn、写入路径、新 hash / mtime 和可回溯 trace id。
- 如果用户希望保留一个独立产物副本，可以另存为 FRIDAY 托管产物；这不是默认行为。

## 4.3 权限模式

已确认：桌面端权限模式命名为 **安全 / 标准 / 自主**。这是面向用户的产品语言，不直接暴露现有插件里的 `toolPermissionMode`、`fileMutationMode` 或内部 runtime policy 名称。

安全和标准模式共享同一个基本边界：项目根目录、`FRIDAY/` 管理目录和用户明确添加的授权路径是 FRIDAY 可以工作的范围；超出范围的外部路径、命令执行、网络访问、Git push、删除和移动需要更高等级确认。自主模式单独处理，语义上对齐 Codex 的 full access / danger-full-access：用户明确选择后，FRIDAY 不再用默认沙箱边界和逐项审批阻断本地文件、命令和网络动作。

| 模式 | 产品语义 | 默认行为 |
| --- | --- | --- |
| 安全 | FRIDAY 可以观察和准备，但关键动作都先问用户 | 读项目资料和打开文件允许；写入项目真实文件树、移动、删除、命令执行、外部路径和网络访问都需要确认 |
| 标准 | 默认推荐模式，适合泛文档工作 | FRIDAY 产物自动保存到 `FRIDAY/artifacts/`；已有项目文件修改先生成草稿 / patch，用户确认后写回；低风险读取和资料解析不打断 |
| 自主 | 用户希望 FRIDAY 像 full access Coding Agent 一样自主推进 | 类似 Codex Full access：本地文件读写、命令执行、网络访问和项目外路径不再默认逐项确认；FRIDAY 继续记录 trace，并允许用户随时停止或切回标准 / 安全 |

具体范围：

| 能力范围 | 安全 | 标准 | 自主 |
| --- | --- | --- | --- |
| 读取项目文件 | 可以读项目内文件，并在过程里披露 | 可以读项目内文件，不频繁打断 | 可以读本机账号可访问的文件，不限项目边界 |
| 写入 `FRIDAY/` 自身状态 | 可以写对话、trace、草稿、产物 metadata | 可以写对话、trace、产物和恢复状态 | 可以写所有 FRIDAY 状态和运行缓存 |
| 写入 `FRIDAY/artifacts/` 产物 | 可以生成草稿，但关键交付前提示 | 自动保存和版本化 | 自动保存、修改、覆盖版本 |
| 修改项目真实文件 | 每次确认 | 默认生成 diff / patch，用户确认后写回 | 直接写入，不默认逐项确认 |
| 新建项目文件 | 每次确认目标位置 | 低风险新建可少打断，重要文件确认 | 直接创建 |
| 删除 / 移动文件 | 每次确认 | 强确认 | 直接执行 |
| 访问项目外路径 | 每次确认 | 默认确认，或加入授权路径后按项目规则处理 | 直接访问本机可访问路径 |
| 运行本地命令 | 默认关闭，需要确认开启和执行 | 可运行常规命令；越界或高风险时确认 | 直接运行 shell、npm、git、脚本等命令 |
| 网络访问 | 默认确认 | 按任务确认或项目策略开启 | 默认可访问网络 |
| Git `status` / `diff` | 可读，过程披露 | 可执行 | 可执行 |
| Git `commit` / `push` / `reset` | 每次确认 | commit 可确认后执行；push / reset 强确认 | 直接执行 |
| 安装依赖 / 包 / 模块 | 每次确认 | 需要确认 | 直接执行 |
| 启用 / 修改 Skill、模块 | 每次确认 | 需要确认，尤其是影响 Agent 行为的模块 | 直接启用或修改 |
| 读取 secrets / `.env` | 默认不主动读取，除非用户点名确认 | 默认敏感提示 | 可以读取，除非用户另设排除规则 |
| UI 提示 | 频繁确认卡 | 只在越界、高风险或写真实文件时确认 | 输入框底部显示当前模式 + trace + 停止按钮 |
| 适用场景 | 新项目、资料敏感、非技术用户 | 默认推荐，泛文档工作 | 用户明确要 FRIDAY 像 Coding Agent 一样全权推进 |

补充原则：

- 项目路径可信不等于所有写入都自动放行。安全和标准模式下，可信边界解决的是 FRIDAY 能不能看、能不能准备修改；真正落盘仍按动作风险和权限模式决定。自主模式是用户明确选择的例外，等同进入完整访问姿态。
- `FRIDAY/artifacts/` 属于 FRIDAY 托管产物区，默认可以自动保存和版本化。
- 写入项目现有文件树、把产物放入项目文件树、修改用户手动打开的已有文件，都应保留可见 diff / patch 和可回溯 trace。
- 所有读取、写入、审批、拒绝、失败和重试都进入 Trace；普通用户看到的是过程说明和确认事项，开发者需要时可以展开审计细节。
- v0 不设计临时提权流程。FRIDAY 不提供“仅允许这一步”“本轮临时提升权限”之类入口；权限模式由用户在输入框底部明确查看和切换。安全 / 标准模式下遇到越界或高风险动作时，FRIDAY 只按当前模式要求动作确认、拒绝或提示用户手动切换模式。
- 输入框底部工具栏采用极简结构：`+ · 模型名称 · 当前权限模式`，例如 `+ · 5.5 · 标准`。`+` 是统一添加入口，包含添加文件、添加图片、添加 Skill、`@` 引用等；权限文字点击后只切换三档模式。
- 通过 `+` 添加外部文件 / 图片时，默认复制一份快照到 `FRIDAY/imports/`，再作为当前输入的显式引用。项目内文件仍按项目相对路径引用，不复制。`FRIDAY/imports/` 不自动进入项目资料库；用户后续要沉淀为资料时，再走“加入资料库 / 写入项目文件树”的显式动作。
- `FRIDAY/imports/` 按对话分目录：`FRIDAY/imports/<conversationId>/<importId>/`。每个 import 目录保存原文件快照和 `import.json`，记录原文件名、原路径、hash、文件类型、大小、创建 turn 和添加时间。这样便于按对话清理、归档和历史恢复。
- 对话生命周期 v0 不设计删除动作，只提供归档。归档某个对话时，`FRIDAY/conversations/<conversationId>/` 和 `FRIDAY/imports/<conversationId>/` 一起转入 `FRIDAY/archive/conversations/<conversationId>/`；恢复时按同一个归档包回到原位置。
- 归档后的对话默认从项目主页的活跃对话列表和最近对话中隐藏；项目主页的对话区域提供“查看归档对话 x”入口，不在最左侧全局导航新增归档模块。
- 打开已归档对话时先进入只读状态，顶部显示“这个对话已归档。恢复后可以继续对话。”并提供恢复按钮。恢复后 `conversationId` 不变，输入框为空，按恢复时间回到活跃对话列表靠前位置。
- `FRIDAY/artifacts/` 下的产物文件不随对话归档移动，只保留对话里的 artifact 关联。归档后当前对话产物列表随对话隐藏；恢复对话后再显示。
- 权限模式切换是当前对话级状态，不直接修改项目默认权限。项目默认权限只决定新对话初始值；当前对话每个 Turn 发送时冻结当时的权限模式，方便历史恢复、trace 审计和解释行为差异。
- 自主模式不作为默认模式。它需要清楚说明“FRIDAY 将获得完整本地访问并自动执行”；进入对话后，当前模式只需要在输入框底部持续显示，避免把自主标识散落到过程区、标题区和设置区。
- 当用户从自主切回标准 / 安全时，如果 FRIDAY 空闲则立即切换；如果正在执行命令、写文件或调用工具，则先停止后续排队动作，并让用户选择停止当前任务或等当前步骤完成后再切换。
- 后续设置页不应先做复杂规则编辑器。v0 只需要三档模式 + 项目级覆盖；allow / ask / deny 细规则可以作为高级能力延后。

## 5. 技能库

产品侧建议名称为 **技能库**。Skill 是会影响 FRIDAY 后续行为的能力或规则，不等同于普通产物。

技能分两个范围：

```text
项目技能
全局技能
```

项目技能：

- 存在当前工作区目录中。
- 只在当前工作区生效。
- 适合当前项目、团队、客户、案例、流程或管理方法。
- 如果用户和 FRIDAY 在某个项目中共同生成了 Skill，默认添加到该项目技能中。

全局技能：

- 存在本机 FRIDAY 全局技能目录中。
- 所有工作区都可以读取和调用。
- 适合通用写作规范、复盘流程、会议方法、组织管理方法、脚本能力和个人工作偏好。

推荐本地结构：

```text
工作区/
  FRIDAY/
    skills/

用户本机/
  .friday/
    skills/
```

项目技能可以由用户手动提升为全局技能。提升时 FRIDAY 应提示用户检查适用范围、依赖资料和敏感信息。

## 6. Skill 生成入口

已确认原则：FRIDAY 不主动推荐生成 Skill。

- FRIDAY 不在普通对话结束后主动弹出“这个流程可以沉淀为 Skill”。
- FRIDAY 不自动创建 Skill，也不自动改变用户后续行为。
- Skill 创建入口应放在技能库模块中，由用户主动进入并选择创建。
- 用户可以从一次对话、一个产物、一段流程说明或一个资料集合中创建 Skill。
- FRIDAY 可以在技能库创建流程中帮助用户整理、生成、检查和预览 Skill。

推荐路径：

```text
技能库 -> 新建技能 -> 选择来源 -> FRIDAY 帮我整理 -> 预览 -> 保存并启用
```

## 7. Skill 启用规则

已确认原则：用户主动创建或提升 Skill 后，默认启用。

项目技能：

```text
用户在技能库里创建 Skill
-> FRIDAY 生成并让用户确认
-> 保存到当前项目技能
-> 默认立即启用
```

全局技能：

```text
项目技能 -> 添加到全局技能
-> 用户确认
-> 默认启用为全局技能
```

技能库中必须始终提供启用/暂停开关，用户可以随时停用某个项目技能或全局技能。

## 8. 项目技能与全局技能的关系

已确认原则：不要做优先级。

- 项目技能和全局技能只区分作用范围和存储位置。
- 项目技能不会覆盖全局技能。
- 全局技能也不会压过项目技能。
- 当前任务中所有已启用且相关的技能进入同一个候选池。
- 是否使用某个 Skill，取决于它与当前任务是否相关，而不是它来自项目还是全局。

如果两个技能存在冲突，不靠隐含优先级自动裁决：

```text
命中冲突技能
-> FRIDAY 提示存在冲突
-> 用户选择这次使用哪个
-> 或进入技能库暂停/修改某个技能
```

## 9. 启动与工作台入口

已确认原则：FRIDAY Desktop 启动后应尽快进入可工作的地方，而不是每次先让用户停在工作区列表。

首次打开：

```text
第一次打开 FRIDAY Desktop
-> 进入项目页
-> 点击“让 FRIDAY 加入一个项目”
-> 新建文件夹 / 选择现有文件夹
-> 如果是现有文件夹，FRIDAY 先查看文件夹结构并给出初步判断
-> 用户确认加入项目，或取消
```

之后打开：

```text
打开 FRIDAY Desktop
-> 默认恢复上次使用的工作区
-> 直接进入上次项目主页
-> 最左侧常驻小侧栏提供项目切换入口
```

工作区列表是切换器，不是默认首页。第一屏应是项目主页：

```text
最左侧：常驻小侧边栏
  - 搜索 / 项目 / 模块 / Soul / 设置

第二层：项目菜单
  - 展示全部项目 / 工作区

主区域：项目主页
  - 输入框：开始新对话
  - 全部对话列表：进入已有对话
  - 项目资料库摘要
  - 项目日历占位：暂时作为项目管理视图
  - 项目技能摘要
  - 项目协作人员
  - 项目远端配置情况
```

核心判断：用户不是先来管理资料、模块或设置，也不是被直接丢进某个历史对话，而是先进入当前项目主页。项目主页是项目级上下文和工作入口，进入对话页后才展示完整对话历史、过程和产物画布。

## 9.1 工作伙伴文案原则

已确认原则：FRIDAY 在桌面端的产品语气中不是一个后台系统组件，而是用户的工作伙伴。初始化、识别和建议文案可以轻微拟人化。

推荐表达：

```text
让 FRIDAY 加入一个项目
FRIDAY 已查看文件夹结构
FRIDAY 建议先保留原目录结构
FRIDAY 可以先把这些文件登记为项目资料
FRIDAY 会记住这次对话和产物
```

不推荐表达：

```text
初始化工作区
扫描目录完成
系统已完成分类
执行上下文导入
```

边界：

- 可以让 FRIDAY 像工作伙伴一样“加入项目”“查看文件夹结构”“给出建议”。
- 不把 FRIDAY 写成情绪化人格，不使用撒娇、夸张、陪伴型文案。
- 涉及文件创建、权限、移动、同步、Git 和外部访问时，必须用清楚的操作说明补足。
- 拟人化不能掩盖事实：FRIDAY 会创建什么、不会移动什么、哪些内容会被登记、哪些内容只保留本地。

## 9.2 现有文件夹观察卡

已确认原则：用户选择现有文件夹时，FRIDAY 先观察文件夹结构，再给出结论。观察卡不承担复杂导入向导，只说明判断、依据和下一步入口。

观察卡文案：

```text
FRIDAY 已查看文件夹结构

初步判断：偏代码项目。
判断依据：Git 仓库 · 文档 12 个 · 代码文件 184 个 · README · docs/ · package.json
建议：对于需要作为项目背景资料的文件，请在项目资料库中选择现有文件进行配置。
说明：观察阶段不会创建 FRIDAY/，也不会移动或修改原有文件。

[加入项目] [取消]
```

行为规则：

- 观察阶段只读取文件夹结构、文件类型和少量标志性文件，不创建 `FRIDAY/`，也不修改原文件。
- **加入项目**：按 FRIDAY 的默认判断进入项目主页，并创建 / 使用 `FRIDAY/`。
- **取消**：退出本次加入流程，不创建或修改项目。
- 建议文案只告诉用户下一步怎么做，不替用户解释过多产品概念。
- 观察卡不提供 **配置项目资料** 按钮；项目资料库视图和资料配置流程进入项目后再进一步定义。
- 对偏代码项目，源码文件不默认刷进项目资料库列表；需要作为背景资料的文件由用户在项目资料库中选择。

## 10. 工作区本地文件结构

已确认原则：工作区内使用一个用户可见的 `FRIDAY/` 目录，不使用隐藏的 `.friday/` 目录。

用户选择已有本地文件夹作为工作区时：

```text
用户选择已有文件夹 A
-> FRIDAY 不移动 A 中已有文件
-> FRIDAY 只在 A 中创建 FRIDAY/ 目录
-> FRIDAY 自己产生和管理的内容都放进 FRIDAY/
```

用户新建工作区时：

```text
FRIDAY 帮用户创建一个空文件夹
-> 在其中创建 FRIDAY/
-> 进入该项目 / 工作区主页
```

推荐结构：

```text
A/
  原有文件...
  FRIDAY/
    project.json   # 最小 FRIDAY 项目共享 manifest
    context/       # 项目资料库登记、说明、metadata；不复制项目现有文件
    artifacts/     # 产品侧叫“产物”，保存 FRIDAY 生成物和版本关系
    imports/       # 从 + 添加的项目外文件快照，服务当前对话引用，默认本地
    archive/       # 归档的对话包；对话和按 conversationId 分组的 imports 一起归档
    skills/        # 项目技能
    conversations/ # 对话和单轮消息，默认本地
    traces/        # 工具调用和过程 trace，默认本地
    references/    # 回答实际引用记录，默认本地
    state/         # workspace/canvas/session 状态，默认本地
    runtime/       # PI / FRIDAY runtime cache，默认本地
    local/         # 个人窗口、布局、设备和 UI 状态，默认本地
    workspace.json # 工作区元信息
```

选择可见 `FRIDAY/` 的原因：

- 普通用户能理解这个目录属于 FRIDAY。
- 本地优先产品不应把关键资料藏起来。
- 迁移和备份时更容易识别；Git 同步时按目录 allowlist 处理，而不是默认整体提交。
- 可以避免 FRIDAY 管理内容和用户原有文件混在一起。

## 10.1 Git 同步边界

已确认原则：v0 暂时把 **context 和项目 Skills** 定义为可共享资产层，但不是强制默认提交。是否进入 Git 由项目来源和 Git Profile 决定，其它内容先保守处理。

可共享资产：

```text
FRIDAY/project.json # 最小 FRIDAY 项目共享 manifest
FRIDAY/context/     # 项目资料库登记、说明、metadata；不复制项目现有文件
FRIDAY/skills/      # 当前项目技能
```

默认本地、不作为多人 Git 协作事实来源的内容：

```text
FRIDAY/conversations/ # 对话历史和单轮消息
FRIDAY/artifacts/     # 产物文件，默认本地；产物可被加入资料库或写入项目文件树
FRIDAY/imports/       # 项目外文件通过 + 加入当前对话时的本地快照
FRIDAY/archive/       # 归档的对话包，默认本地；v0 不做对话删除
FRIDAY/traces/        # 工具调用和过程 trace 明细
FRIDAY/references/    # 每次回答的实际引用记录
FRIDAY/state/         # workspace/canvas/session 状态
FRIDAY/runtime/       # PI / FRIDAY runtime cache
FRIDAY/local/         # 个人窗口、布局、设备和 UI 状态
```

产物和 Wiki 也先保守处理：

- 产物默认不共享；用户选择“添加到项目资料库”后，才进入 `FRIDAY/context/` 的资料登记，或被用户放入项目文件树中的指定位置。
- Wiki 暂不默认共享为协作事实来源，后续再决定共享图谱数据、导出结果，还是只作为本地索引。
- 全局 Skills 不属于当前项目目录，存放在本机全局 FRIDAY 目录；项目 Skills 可以随项目 Git 同步。
- 这条边界的目标是减少多人使用 FRIDAY 时的冲突，把协作事实先限定在资料和项目能力上。

Git Profile：

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| `local-only` | 新建本地项目，或选择已有文件夹但不希望影响 Git | FRIDAY 内容只在本机使用；已有 Git 仓库中优先使用本地忽略策略，不主动污染共享仓库文件 |
| `share-friday-layer` | 用户明确希望把 FRIDAY 项目资料和项目技能纳入协作 | 只把 `project.json`、`context/`、`skills/` 视作可提交内容，其它运行态继续本地 |
| `remote-managed` | 用户从远端仓库拉取一个已有 FRIDAY 共享层的项目 | 检测并加载仓库中的 `project.json`、`context/`、`skills/`；缺失时再询问是否初始化 |

真实 Git 环境中的具体问题，例如 `.gitignore`、`.git/info/exclude`、子模块、已有忽略规则、文件大小和冲突处理，先不在产品规划阶段过早展开，后续进入实现和测试时再逐项解决。

## 10.2 落盘对象分层

已确认原则：FRIDAY 的落盘对象不要都按“协作数据”处理，而是分成三层。

```text
项目事实：project.json、Context、项目 Skill
运行过程：Conversation、Turn、Artifact、Trace、Reference
个人状态：Workspace State、窗口布局、当前打开状态、runtime cache
```

对象职责和同步策略：

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

## 10.2.1 已确认方向：Conversation / Turn / Trace 文件切分

已确认采用 **方案 B：Conversation 索引 + Turn 快照 + Trace 独立文件**。

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

## 10.2.2 已确认方向：Reference / Turn / Trace 分层

已确认原则：用户添加的 `@` 引用、FRIDAY 实际读取的文件、回答底部披露的参考文件、过程里展示的读取 / 写入 trace 必须分开存。它们可能指向同一个文件，但产品含义不同。

四类事实：

| 类型 | 含义 | 归属对象 | 展示位置 |
| --- | --- | --- | --- |
| `Explicit Reference` | 用户发送前通过 `@文件`、`@技能`、`@产物` 明确加入的材料 | 当前 Turn 的 user 部分 | 输入框 chip；发送后用户消息下方“已添加引用 x 个” |
| `Resolved Reference` | 发送时被解析并进入 prompt / context package 的引用 | 当前 Turn 的 references 部分 | 历史恢复、调试和必要时的引用详情 |
| `Trace Source` | FRIDAY 执行中实际读取、搜索、写入或运行的目标 | Trace / ToolRun / TurnEvent | 右侧过程区、工具 trace、审计记录 |
| `Answer Reference` | FRIDAY 回复底部披露给用户的实际参考来源 | 当前 Turn 的 assistant 部分 | 回答底部“参考文件 x 个” |

分层规则：

- `Explicit Reference` 不等于 `Answer Reference`。用户点名一个文件，只表示用户希望 FRIDAY 关注它，不保证一定出现在回答底部。
- `Trace Source` 不等于 `Answer Reference`。FRIDAY 可能读取、搜索、检查多个文件，但回答底部只展示真正支撑答案的用户可理解来源。
- `Trace` 必须比 `Reference` 更完整，用于过程复盘、错误排查和权限审计。
- `Reference` 必须比 `Trace` 更克制，用于用户理解“这条消息 / 这次回答用了哪些材料”。
- 任何 Reference 都不自动改变项目资料库；只有用户明确选择“加入项目资料库”时，才写入 `Context` / 项目资料库。

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

建议的 ReferenceRecord：

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

回答底部“参考文件 x 个”由 `Answer Reference` 生成，已拍板采用 **方案 B：候选来源池 + 受限筛选**。

候选来源池：

- 用户显式 `@` 且已解析进入 prompt / context package 的文件、产物或选区。
- FRIDAY 成功读取并实际用于回答的具体文件。
- 当前产物、当前画布选区或截图被用于本轮回答时形成的 artifact / selection reference。
- FRIDAY 本轮生成或修改的产物，如果最终回答正在解释、总结或交付该产物，也可以进入候选池。

展示规则：

- 折叠态显示 `参考文件 x 个`。
- 展开后每项只显示文件类型图标、文件名和来源类型。
- 来源类型先收敛为 `@引用`、`FRIDAY 读取`、`当前产物`、`选区`。
- 默认不显示完整路径；点击文件在画布中打开，悬停或右键时可以查看路径、定位到文件树、加入项目资料库。

排序和去重：

- 用户显式 `@` 的文件按用户添加顺序优先。
- 当前产物和选区次之。
- FRIDAY 读取的文件按第一次实际使用顺序显示。
- 同一目标按 `targetType + targetUri` 去重；如果同一文件同时来自多种来源，默认标签优先显示 `@引用`，详情里可以补充“同时被 FRIDAY 读取”。

已确认：`AnswerReference` 随 Assistant Turn 落盘为稳定快照，不从 Trace 临时推导，也不在 v0 建完整 provenance graph。

最小落盘结构：

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

必须落盘：`id`、`turnId`、`targetType`、`targetUri`、`displayName`、`fileKind`、`primarySourceType`、`sourceTypes`、`order`、`createdAt`。

可选落盘：`explicitReferenceIds`、`traceIds`、`artifactId`、`selectionId`，用于解释“为什么它进入参考文件”。

只属于 UI 状态、不进入快照：文件图标、展开 / 折叠状态、hover 文案、右键菜单、是否高亮、tooltip 里的完整路径。

默认不进入回答底部的内容：Skill、模块和工具本身；失败或被拒绝的工具调用；只写入但未作为回答依据的工具调用；模型重试；权限检查；路径探测；目录枚举；审批事件；系统 prompt；内部规则；纯状态事件。

历史恢复规则：Conversation 只恢复消息顺序；Turn 恢复某一轮的用户输入、FRIDAY 回复和引用快照；Trace 只在用户展开过程、调试或复盘时懒加载。

## 10.3 混合工作区与文件分类

已确认原则：FRIDAY 只有一个混合工作区模型，不拆成“文档项目”和“代码项目”两套底层对象。项目根目录和其中的现有文件树是直接信息来源；知识资料和代码文件是文件角色，不是强制物理目录。

文件角色：

| 文件角色 | 说明 | 默认处理 |
| --- | --- | --- |
| 知识资料 | 文档、会议记录、需求、方案、设计、README、docs 等 | 可显示在项目资料库，可补说明和摘要 |
| 代码文件 | 源码、配置、测试、脚本、工程依赖文件 | 作为代码工作上下文，可被 FRIDAY 搜索、读取、修改 |
| 兼具两者 | README、docs、schema、脚本说明、工程规范等 | 可以同时出现在资料库视图和代码工作上下文中 |
| 排除 / 系统 | `.git`、`node_modules`、`dist`、缓存、环境文件、大型二进制等 | 默认隐藏或低优先，不作为普通资料展示 |

目录规则：

- 不再默认创建 `Knowledge/` 和 `Code/`。
- 选择已有文件夹或已有代码仓库作为工作区时，FRIDAY 不自动改变文件树。
- “把某个文件定义为知识资料”默认只写入 `FRIDAY/context/registry.json` 和 metadata，不移动原文件。
- 物理移动只作为独立的整理操作，必须让用户确认，因为它可能影响 Git 历史、相对链接、代码引用、构建脚本和 CI。

初始化推断：

```text
空文件夹
-> 先只有用户选择的项目根目录和 FRIDAY/
-> FRIDAY 生成文件默认进入 FRIDAY/artifacts/
-> 用户需要长期保存到项目文件树时再选择目标位置

非空、明显是泛文档资料的文件夹
-> 现有文件可作为知识资料登记
-> FRIDAY 不创建第二套资料目录

非空、疑似代码仓库
-> 保持现有目录为代码工作区
-> README、docs、方案文档等可登记为知识资料
-> 不自动挪动任何已有文件
```

## 11. 工作区识别与初始化

已确认原则：FRIDAY 不应在用户选择普通文件夹后悄悄改动它。普通文件夹必须经过用户确认后才初始化为 FRIDAY 工作区。

文件夹识别规则：

```text
已有 FRIDAY/workspace.json
-> 已是 FRIDAY 工作区
-> 直接打开

有 FRIDAY/ 但没有 workspace.json
-> 不完整工作区
-> 提供“修复工作区”入口

没有 FRIDAY/
-> 普通文件夹
-> 用户确认后初始化
```

初始化确认文案：

```text
让 FRIDAY 加入这个项目？
FRIDAY 会在这里创建自己的 FRIDAY 文件夹，用于保存资料登记、产物、技能和对话记录。原有文件不会被移动、复制或修改。
```

已有文件夹初始化后的资料库规则：

- 原有文件保持原样。
- 如果该文件夹本身就是整理好的资料库，用户可以选择把项目内已有文件登记为项目资料。
- 如果该文件夹疑似代码仓库，FRIDAY 默认保持代码目录结构不变；用户可以把其中的 README、docs、方案文档等标记为知识资料。
- 系统可以根据文件类型、依赖文件和目录结构做初步判断，但判断结果只影响默认视图和提示，不触发自动移动。
- v0 不强制自动扫描全部文件；项目资料库完整视图左侧显示当前项目文件树，用户从文件树中选择项目内文件加入资料库。
- 项目文件登记引用，不复制；外部文件需要先进入项目文件树，或作为产物 / FRIDAY 托管资料再登记。
- 用户可以后续继续手动添加资料。

## 12. 项目资料库加入规则

已确认原则：项目资料库 v1 以项目文件树为主要入口。文件从完整视图左侧文件树加入资料库；外部文件如果要成为资料，先通过 **导入到项目文件树** 进入项目，再登记为资料。

完整视图结构：

```text
左侧：项目里的文件夹结构与文件
右侧：已加入资料库的文件列表及说明
底部：导入到项目文件树
```

项目内文件加入资料库时，FRIDAY 不移动原有文件；用户从左侧文件树中选择文件后，右侧资料库列表增加一条资料记录，并允许补充说明。

添加规则：

```text
项目内文件
-> 用户确认加入项目资料库
-> 在 FRIDAY/context/registry.json 记录相对路径
-> 创建 metadata / description / summary

外部文件
-> 用户选择项目内目标位置
-> FRIDAY 将文件放入该位置
-> 在 FRIDAY/context/registry.json 记录相对路径
-> 创建 metadata / description / summary
```

这样可以保证：

- 已经整理好的项目文件夹不需要被 FRIDAY 二次复制一遍。
- 项目内资料保持原有目录结构和 Git 历史。
- 外部文件进入项目后成为项目文件树中的普通文件，资料库只登记它。
- 资料库删除某个登记项，不默认删除项目内原文件；如果是 FRIDAY 托管资料文件，只删除用户确认删除的托管副本。

## 13. 资料说明与自动理解

已确认原则：资料添加后不弹出必填表单，不要求用户立即写说明。

导入流程：

```text
用户添加资料
-> 立即完成导入
-> 资料卡片显示“可补充说明”
-> 用户点进详情后可以写描述
-> FRIDAY 后台生成摘要和建议用途
```

说明规则：

- 用户说明是可选的，可以后补。
- 资料导入不因缺少说明而阻塞。
- FRIDAY 可以自动生成摘要、建议用途和不确定点。
- FRIDAY 的自动理解只作为辅助，不覆盖原文件信息。
- 资料详情页仍以原文件信息优先，用户说明和 FRIDAY 理解按渐进披露展示。

资料详情页 v1 顺序：

```text
1. 材料本身
2. 用户说明
3. FRIDAY 的理解
```

## 14. 资料启用与暂停

已确认原则：项目资料库中的每个资料都有启用状态。新增资料默认启用，用户可以暂停资料。

资料状态：

```text
启用
-> 默认参与当前工作区对话

暂停
-> 保留在项目资料库
-> FRIDAY 默认不参考
```

行为规则：

- 新加入资料默认启用。
- 暂停资料不删除项目内原文件，也不删除 FRIDAY 托管的资料文件。
- 暂停资料只从默认参考范围移除。
- 用户仍然可以在对话中点名使用暂停资料。
- 项目资料库列表中提供简单开关，不做复杂权限模型。

## 15. 显式文件引用与 Agent 自由度

已确认原则：不要把“本次任务范围”做成默认限制器。文件、Skill、产物和模块本质上都是本地可见的显式文件或能力文件，FRIDAY Agent 应尽可能有更大的自由度去判断、读取、组合和调用。

产品侧重点不是让用户每轮先勾选一个“可参考范围”，而是保证能力来源足够显式、可追踪、可解释：

```text
项目资料库 = 显式资料文件
项目 Skill = 显式能力文件
全局 Skill = 显式能力文件
产物 = 显式结果文件
模块 = 显式能力包
```

默认行为：

- FRIDAY 可以在工作区权限边界内自由判断哪些资料、Skill、产物和模块与当前任务相关。
- 项目资料库、项目 Skill、全局 Skill 和相关产物不应被理解成互相隔离的孤岛，而是 Agent 可组合使用的本地工作材料。
- 启用/暂停仍然存在，但它更像长期可用性管理，不是每一轮对话的前置配置。
- 用户在对话中点名某个文件、Skill 或产物时，FRIDAY 应把它视为强显式引用。
- 用户也可以说“这次不要看 A”或“只看 B/C”，这是一条当前任务指令，不改变资料库或技能库的长期状态。

透明披露：

- 回答底部继续显示 **参考文件 x 个**，披露本次实际参考过的文件。
- 项目资源入口可以展示“相关资料”“本次产物”“可能参与的技能”等工作线索，而不是展示一个限制 Agent 的完整白名单。
- 如果 FRIDAY 调用了 Skill、模块或工具，应通过过程折叠、trace 或详情浮窗解释来源和动作。

## 16. 项目资料库页面 v1

已确认原则：项目资料库 v1 不做复杂知识库视图，也不做推荐分组。项目主页只显示资料库配置数量；完整视图用于管理“项目文件”和“已加入资料库”的关系。

项目主页摘要：

```text
项目资料库
已配置 12 份资料
```

完整视图：

```text
左侧：项目文件
  - 全量显示当前项目里的文件夹结构与文件
  - 文件可以显示类型、是否已加入资料库、是否为代码文件等轻量状态

右侧：已加入资料库
  - 显示已经加入资料库的文件列表
  - 每个文件显示说明、启用状态和来源

底部：导入到项目文件树
  - 从项目外添加资料时，先选择项目内目标位置，再登记为资料
```

交互规则：

- 不做 **推荐配置** 分区。
- 项目内文件从左侧文件树加入资料库；FRIDAY 只登记相对路径、说明和启用状态，不复制、不移动。
- 左侧文件树支持勾选 / 多选文件后点击 **加入资料库**。
- 用户也可以直接选中文件后拖到右侧 **已加入资料库** 列表。
- 已经加入资料库的文件在左侧文件树中显示浅色勾选框，表示已登记，不代表本次选中。
- 右侧列表只显示已经加入资料库的文件，不把全部项目文件混在一起。
- 下方提供 **导入到项目文件树** 按钮；外部文件先进入项目文件树，再登记为资料。
- 可以在右侧修改资料说明和启用 / 暂停状态。
- 不做复杂标签、AI 重要性排序、自动分组或知识图谱。
- 这里的“不做知识图谱”仅限定项目资料库完整视图 v1。项目主页可以有独立的 **项目 Wiki** 板块，用于展示已经沉淀出的知识图谱。

详情页顺序：

```text
1. 材料本身
2. 用户说明
3. FRIDAY 的理解
```

HTML 预览：

```text
docs/plans/friday-desktop/previews/project-library-v1.html
```

## 17. 项目工作台布局

已确认原则：项目工作台以“工作线”为中心，而不是以模块导航或资源管理为中心。没有活跃产物时以对话为主；有活跃产物或用户打开可显示文件时，以产物画布为主。

页面结构：

```text
最左侧：常驻小侧边栏
  - 搜索
  - 项目
  - 模块
  - Soul
  - 设置放在最下面

第二层：项目菜单
  - 点击“项目”后出现
  - 显示当前本机已有的全部项目 / 工作区
  - 点击任意项目后，主区域显示该项目主页
  - 项目菜单用于切换项目，不是进入对话页后的常驻信息

项目主页：当前项目的工作入口
  - 显示输入框，用户输入后进入新的对话页
  - 下方显示项目下全部对话列表
  - 点击任意已有对话后进入对话页面
  - 展示项目资料库摘要：部分文件清单、更多、添加
  - 展示项目日历占位：暂时作为项目管理视图，具体功能后续再定义
  - 展示项目技能摘要：部分技能清单、更多、配置
  - 展示项目 Wiki 摘要：当前项目已经建立的知识图谱
  - 展示项目协作人员
  - 展示项目远端配置情况

对话页第二层：当前项目导航
  - 显示当前项目名称和返回项目主页入口
  - 显示本项目对话列表，方便在同一项目内切换对话
  - 底部显示项目资料库、项目 Wiki、技能入口，不显示产物入口
  - 产物入口属于当前对话资源：入口放在对话标题行右侧；无画布时内容显示在右侧资源窗口，有画布时内容以悬浮窗口覆盖在 FRIDAY 过程区上方
  - 不继续显示全部项目列表；切换项目时再点击最左侧“项目”重新打开项目菜单

中间 / 左侧主区域：当前工作对象
  - 在项目主页中显示项目概览和入口
  - 进入对话页后，没有活跃产物时显示对话工作台
  - 进入对话页后，有活跃产物时显示产物画布
  - 产物画布可以显示 FRIDAY 生成物，也可以显示用户手动打开的已有可显示文件

右侧：FRIDAY 侧栏
  - 只在进入对话页面后出现
  - 加载当前对话的完整历史
  - 显示当前任务过程、确认、继续输入
  - 过程卡片可以折叠，但对话历史不能只保留当前任务片段
```

对话历史规则：

- 一个项目下面可以有多个对话。
- 每个对话打开时，都应该加载该对话的完整历史对话记录。
- 完整历史可以在右侧 FRIDAY 区域中滚动、折叠或按时间分组展示，但数据层必须完整加载。
- 当前产物、产物标签、选区引用和 FRIDAY 侧栏都绑定到当前打开的对话。
- 切换到另一个对话时，产物画布和右侧 FRIDAY 历史也随之切换到该对话的状态。

左侧导航和项目主页规则：

- 最左侧栏不再承载项目下的对话列表，而是常驻的全局小侧边栏。
- 最左侧栏是常驻总模块栏，固定显示：搜索、项目、团队、日历、模块、Soul、设置；设置固定在最下面。
- 团队、日历先作为总模块占位，不在本轮定义具体页面内容、数据结构和交互细节。
- 用户点击“项目”后，出现第二层项目菜单，列出本机已有的全部项目 / 工作区。
- 用户点击任意项目后，主区域进入该项目主页。
- 项目主页是项目的默认入口，不直接等同于某个对话页。
- 项目主页顶部提供输入框；用户输入后创建或进入一个新的对话页。
- 项目主页下方显示该项目下全部对话列表；用户点击已有对话后进入对应对话页。
- 项目主页还展示项目资料库、项目日历、项目技能、项目 Wiki、项目协作人员和项目远端配置情况的摘要。
- 项目日历暂时作为项目管理视图占位，不在本轮定义任务、会议、排期、提醒或同步规则。
- 项目 Wiki 板块展示当前项目已经建立的知识图谱，包括知识节点、关系和来源文件数量；点击后进入详细知识图谱界面。
- 项目 Wiki 不替代项目资料库列表。项目资料库仍管理资料文件、登记、说明和启用状态；项目 Wiki 负责组织已经沉淀出的概念、决策、产物、技能和资料之间的关系。
- 原 Obsidian 插件里的 Wiki 能力不成熟，不作为桌面端项目 Wiki 的成熟参考。桌面端项目 Wiki 需要重新定义产品语义、数据对象、节点 / 关系 schema 和图谱交互。
- 进入对话页面后，主要页面内容继续沿用前面确认的结构：有产物时为画布 + 右侧 FRIDAY 过程区；没有产物时为对话主页面 + 靠右资源窗口。
- 进入对话页面后，第二层从“项目列表”切换为“当前项目导航”：显示当前项目、本项目对话列表，并把项目资料库 / Wiki / 技能入口靠底部放置，尽量让对话列表展示更多条目。
- 产物不放在当前项目导航的项目入口中；它属于当前对话资源，入口放在对话标题行右侧；无画布时内容显示在右侧资源窗口，有画布时内容以悬浮窗口覆盖在 FRIDAY 过程区上方。
- 对话页中不常驻显示全部项目列表；如果用户要切换项目，应重新点击最左侧“项目”入口展开项目菜单。

Codex 桌面端参考结论：

- 可以参考 Codex 的桌面工作台感，但不能 1:1 复制 Codex 的三栏顺序。
- Codex 的可借鉴点是：左侧工作列表、多面板桌面工作状态、文件 / 浏览器 / Agent 过程并列存在。
- FRIDAY Desktop 不继承 Codex 参考版配色。Codex 只作为板块组织和桌面 Agent 工作感参考，不作为视觉基准。
- 桌面端视觉以 FRIDAY VI 为准：Graphite 作为主文字和严肃表面，Warm Bone 作为桌面和文档底色，Muted Teal 作为主要交互和状态色，Stone 作为边界和低层级界面元素，Accent 只用于编辑性强调、重要提醒和少量选区提示。
- FRIDAY VI 不能被理解成“把界面换成品牌色”。正确落地方式是：正文默认使用 72%-82% Graphite 的柔和墨色，浅色背景保持 Warm Bone 的文档感，Muted Teal 只用于活跃状态、连接、链接和系统响应，Accent 只用于重要提醒或编辑性强调。
- 规划 HTML 属于品牌叙述和视觉评审材料，标题可以使用霞鹜文楷方向，整体接近品牌手册的阅读排版；桌面端产品 UI mock 属于密集操作界面，继续使用现代无衬线，不在按钮、表格、状态提示和密集列表中强行使用文楷。
- 视觉细节上避免重投影、发光、玻璃质感、过度胶囊化按钮、大面积深色 coding shell 和过多彩色标签；使用 8px 外层圆角、6px 内部控制圆角、细分隔线和留白建立层级。
- FRIDAY 的对话页面应该固定在最右侧，承载当前对话的完整历史、过程、工具调用、确认事项和继续输入。
- 中间主区域是当前工作对象：Markdown、HTML、报告、页面原型、知识库文档、网页和其他可显示产物。
- 最左侧承载全局小侧边栏；第二层在项目切换状态下承载项目菜单，在对话页状态下承载当前项目导航。当前项目下的对话 / 工作线列表先在项目主页中展示，进入对话页后也可作为当前项目导航的一部分保留。
- FRIDAY 桌面端参考 Codex 的“桌面 Agent 工作台”结构，但产品语义必须转向工作区、项目资料库、产物、技能、模块和泛文档工作流。
- FRIDAY 的资源入口更适合靠近中间产物画布，而不是占用最右侧完整对话历史或固定展开成资源后台。
- 当前阶段先不在产物画布中放浏览器地址栏 / 路径栏，避免把“产物画布”误解成浏览器壳。
- 当前阶段也先不放“环境信息”浮层，先聚焦常驻小侧栏、项目菜单、项目主页、主区域和 Agent 对话区这些板块。
- 环境、分支、运行状态、文件路径等信息后续可以单独设计为工作状态入口，但不放在这个结构参考预览里。
- 项目切换不再放在可收起的对话侧栏中，而是由最左“项目”入口打开第二层项目菜单；进入对话页后，第二层不继续显示全部项目，而是显示当前项目下的对话和项目入口。
- 画布区和右侧 FRIDAY 过程区不是两个并列产品页，而是同一个“对话页面”内部的拆分区域。
- 画布区是对话页面里的当前可操作页面；右侧 FRIDAY 区域是同一对话的完整历史、过程和继续输入。
- 右侧 FRIDAY 过程区不重复显示对话标题；对话标题由外层对话页面标题承担，项目主页中的对话列表只作为进入入口。
- 资料库、Wiki、技能是当前项目导航底部的一组项目入口；产物不放在这组入口里。
- 技能入口展开后默认显示项目技能，并允许切换查看全局技能。
- 没有画布区时，对话标题行右侧放一排资源 icon，分别代表资料库、项目文件树、技能和产物；下方靠右资源窗口承载当前对话资源。
- 产物是当前对话资源的一种，默认可以显示当前对话已有产物列表；它不作为项目级入口出现。
- 资源 icon 只负责切换资源类型；资源内容统一显示在同一个资源窗口中，避免每个入口各自带一个独立窗口。
- 画布区出现后，同一排资源 icon 仍放在对话标题行右侧；用户点击后在右侧 FRIDAY 过程区上方以悬浮窗口展开，不作为固定面板挤占过程内容。产物本身继续通过画布标签、当前产物和产物列表进入。

项目资源规则：

- 当前对话资源入口最终采用“**标题行入口 + 共用资源窗口**”布局：入口是一排放在对话标题行右侧的资源 icon，内容统一显示在下方同一个资源窗口或浮层中。
- 资料库、Wiki、技能不再作为固定右侧栏完整展示。
- 它们作为当前项目导航底部的一组项目入口出现；进入对话后，当前对话资源 icon 改为资料库、项目文件树、技能和产物。Wiki 保留为项目级知识图谱入口，不再放进当前对话资源窗口。
- 当前对话资源窗口默认 tab 由对话状态决定：已有产物时默认打开产物；没有产物时默认打开资料库；用户手动切换后按当前对话记住选择。
- 资料库 tab 只显示当前项目中已加入资料库的资料清单，每项只展示文件类型和文件名；不显示摘要、说明、路径、更新时间，也不完整展示项目文件树；窗口内预留“进入项目资料库”按钮，用于跳转到该项目资料库完整页面。
- 文件树 tab 显示整个项目文件树；单击文件直接在画布中打开。右键文件只显示两个动作：**在画布中打开**、**添加到对话**。添加到对话等同于当前插件版本里的 `@` 功能：把该文件作为 `@文件` 加进当前消息 / 当前对话上下文，不改变项目资料库登记。
- 技能 tab 默认显示项目技能，可切换查看全局技能；每项只显示技能名和一句短用途。点击技能不会直接执行，而是把该技能作为 `@技能` 加入当前输入，等待用户补充任务要求。
- 产物 tab 显示当前对话产物清单；单击产物在画布中打开。右键产物显示：**在画布中打开**、**添加到对话**、**加入项目资料库**、**放入项目文件树**。
- `添加到对话` 的语义沿用现有插件的 `@` 引用：引用先进入输入框，成为本轮消息的一部分，而不是直接修改项目资料库、技能库或产物状态。
- 现有插件的实现证据是：`MentionComposer` 保存结构化 composer snapshot；发送时解析 snapshot 和 mention resolution；用户消息通过 `uiMeta.segments` 保留结构化展示；发送成功或加入队列后，`aiComposerSnapshot` 会被重置为空并回写到 composer。
- 桌面端应继承这个行为：发送成功后输入框清空，上一轮 `@` 引用不自动延续到下一轮。已经发送的 Turn 保留显式引用快照，用于历史回放、引用展示和状态恢复。
- 已发送用户消息可折叠显示“已添加引用 x 个”；FRIDAY 回复底部继续显示“参考文件 x 个”。用户添加的引用表示显式点名，FRIDAY 的参考文件表示实际使用，两者是不同披露层。
- 用户点击项目导航里的资料库、Wiki 或技能后，在主区域打开对应详情窗口。
- 产物作为当前对话的画布相关入口处理，不进入当前项目导航底部的项目入口组；无画布时在右侧资源窗口中以“当前对话产物”列表展示。
- 技能入口默认显示项目技能，并提供切换到全局技能的控制。
- 悬浮详情窗口不取代当前对话和产物画布，只作为临时查看和管理入口。

资源入口方案 HTML 预览：

```text
docs/plans/friday-desktop/previews/resource-entry-options.html
docs/plans/friday-desktop/previews/codex-reference-workbench.html
docs/plans/friday-desktop/previews/no-canvas-workbench.html
docs/plans/friday-desktop/previews/project-wiki-graph.html
```

HTML 预览：

```text
docs/plans/friday-desktop/previews/workbench-v1.html
```

## 18. 实际参考文件披露

已确认原则：实际参考文件在回答底部披露，不放在 FRIDAY 侧栏或项目资源入口作为主要展示。

展示方式：

```text
参考文件 x 个
```

用户点击后展开，看到本次回答实际参考过的文件列表。

行为规则：

- 披露的是实际参考文件，不是当前任务允许参考的全部资料。
- 默认折叠，避免打扰主回答。
- 展开后显示文件名和必要的简短说明。
- 如果本次没有参考文件，可以不显示该入口，或显示“参考文件 0 个”作为调试/透明模式信息。
- 项目资源入口可以展示相关资料、产物、技能、确认事项和工作线索，但不作为“实际参考文件”的最终披露位置，也不作为限制 Agent 的白名单。

## 19. 规划交付形态

已确认原则：桌面端产品规划可以同时使用 Markdown 和 HTML。

- Markdown 继续作为可 diff、可追溯的事实来源。
- HTML 作为更适合阅读、评审和视觉决策的规划入口。
- 需要讨论信息架构、页面布局、模块页面、技能库页面、项目资料库页面时，可以直接做成 HTML 前端预览。
- 视觉或交互方向确认后，再同步回决策记录和实施计划，供后续开发参考。

当前 HTML 入口：

```text
docs/plans/friday-desktop/index.html
```

## 20. 桌面端新形态与既有能力复用

已确认原则：桌面端是 FRIDAY 的新产品形态，但不能偏离 FRIDAY 目前已经形成的能力基础。

含义：

- 交互层可以比 Obsidian 插件更自由，允许独立窗口、工作区切换、右侧资源入口、悬浮详情、模块页和 Soul 页。
- 能力层不另起一套断裂系统，而是优先复用、抽象和产品化现有 FRIDAY 能力。
- 后续每一个桌面端功能规划，都应该先回答：它对应 FRIDAY 当前哪个能力、需要从 Obsidian host 中抽出什么、是否需要补齐新的 desktop host contract。

应优先纳入桌面端能力地图的现有能力：

- Agent Kernel、FridayPiRuntime、PI SDK adapter。
- Runtime progress、tool trace、Agent trajectory、过程面板、turn replay。
- 项目边界、文件权限、Git 同步、文件修改审查。
- 项目资料、mention/context assembly、memory。
- Skill、Soul、本地状态、trace persistence。

产品侧落地：

- 中间对话区沿用现有 FRIDAY 对话和过程折叠能力。
- AI 工作过程中读取了什么、调用了什么、修改了什么，继续在过程面板中披露，类似 Manus/Codex 的工作流透明度。
- 回答底部只披露本次实际参考文件：`参考文件 x 个`。
- 右侧资源入口是资料、产物、技能的管理和查看入口，不是限制 Agent 的白名单。
- 后续实现桌面端时，应逐步把 `DailyBoardView` 中仍有价值的能力抽象成 host-neutral workbench/runtime UI，而不是沿用历史命名作为产品语义中心。

## 21. 已确认方向：产物优先工作台

状态：产物优先工作台预览已确认符合当前产品想象；多产物展示规则已确认。

用户提出的新工作界面方向：

- 默认状态下仍可保持对话工作台。
- 当 FRIDAY 开始生成可显示内容的产物，例如 Markdown、HTML、报告、页面原型等，工作台自动切换为产物优先形态。
- 用户也可以手动打开一个已有的可显示文件，包括用户自己放在工作区文件夹里的 Markdown、HTML、报告草稿等，用产物优先形态边看边和 FRIDAY 对话、理解、修改或生成说明。
- 产物优先形态中，左侧大区域成为产物实时渲染画布。
- 右侧保留类似侧边插件宽度的 FRIDAY 区域，承载工作过程、对话、确认和继续指令。
- 右侧 FRIDAY 区域必须加载当前对话的完整历史记录；当前任务过程只是历史中的一部分，可以折叠显示。
- 左侧产物画布可以承载多个产物，用户能在画布中切换或并列查看。
- 用户可以直接在产物画布里选择文字、区域或截图，并把所选内容交给 FRIDAY 修改，或作为上下文带入下一条用户消息。

已确认的多产物展示规则：

- 默认显示一个当前产物。
- 多个产物通过顶部标签切换。
- 用户可以拖拽顶部标签，把某个产物拆成并列视图。
- 并列视图支持上下并列和左右并列。
- 并列展示是用户主动触发的高级操作，不作为默认布局，避免打扰泛文档用户的主线工作。

已确认的进入和恢复规则：

- 新任务或没有活跃产物时，默认先进入对话工作台。
- FRIDAY 生成第一个可显示产物时，自动切换到产物优先工作台。
- 工作区已有活跃主产物时，下次打开恢复到产物优先工作台。
- 用户可以随时手动打开已有的可显示文件，并把它加载为当前主产物。
- 已有文件不必须来自 FRIDAY 生成；用户本地放进工作区文件夹里的可显示文件也可以作为主产物打开。
- 手动打开已有文件后，FRIDAY 侧栏用于解释、总结、修改、生成说明或围绕该文件继续对话。
- 用户始终可以从产物优先形态回到对话工作台。

已确认的对话历史规则：

- 一个项目下可以有多个对话。
- 每个对话打开时，都加载该对话的完整历史对话记录。
- 右侧 FRIDAY 侧栏不是只显示当前任务过程和输入框，而是当前对话的完整历史容器。
- 工作过程、工具 trace、参考文件披露和确认事项作为当前 turn 的折叠卡片嵌入完整历史中。
- 为了保持界面安静，较早历史可以折叠、分组或滚动查看，但不应在数据层被省略。

已确认的选区操作规则：

- 用户在产物画布中选中文字、区域或截图后，默认只出现一个小的 `FRIDAY` 按钮。
- 默认不直接展开“修改、提问、生成说明、加入资料库”等完整操作条，避免打扰阅读和普通复制。
- 用户点击 `FRIDAY` 后，再展开选区操作菜单。
- 选区操作菜单至少包含：修改这段、作为上下文提问、生成说明、加入项目资料库。
- 选区本身应作为结构化引用进入右侧 FRIDAY 对话，而不是只把文本复制进输入框。

初步产品判断：

- 这个方向更适合泛文档工作用户，因为用户真正关心的主对象通常不是聊天记录，而是正在形成的文档、页面、报告、方案或资料沉淀。
- FRIDAY 在此形态下不是“聊天机器人占据中心”，而是一个围绕产物工作的协作者、编辑器和过程解释器。
- 这能明显脱离 Obsidian 插件界面和市场常见 AI chat 产品页面，形成 FRIDAY Desktop 自己的工作台范式。

## 22. 当前待定问题

- 桌面端技术栈选择。当前只记录约束，不在产品功能边界稳定前做最终选择。
- 当前对话产物列表的展示字段、版本规则和操作菜单。
- 技能库中 Skill 的展示字段、编辑方式和冲突提示样式。
- 模块与 Skill 的边界：哪些是轻量行为规则，哪些应该成为完整模块。
- Soul 如何从 prompt/persona 扩展为可配置的 Agent 行为画像。
- 桌面端第一屏工作台的具体信息架构和视觉布局。

## 23. 当前规划阶段和技术栈决策原则

当前处于 **产品形态和信息架构收敛阶段**，还不是最终工程选型阶段。

已经基本确认的是：

- 目标用户和使用场景：组织 / 团队中的泛文档工作者。
- 第一屏：项目主页，而不是工作区列表或纯对话页。
- 常驻总模块栏：搜索、项目、团队、日历、模块、Soul、设置。
- 项目主页：输入框、全部对话、项目资料库、项目日历、项目 Wiki、项目技能、协作与远端状态。
- 对话页：第二层切换为当前项目导航，右侧是完整 FRIDAY 对话和过程区。
- 有产物时：主区域切换为产物画布，对话标题行右侧保留当前对话资源 icon，点击后在 FRIDAY 过程区上方悬浮展开共用资源窗口。

技术栈应在核心产品能力和 Host 边界稳定后再最终确定，但不应等到所有细节完全定完。现在先记录技术约束：

- 必须支持本地优先工作区和真实文件系统访问。
- 必须能承载 PI SDK / FRIDAY Runtime / tool trace / state persistence。
- 必须能脱离 Obsidian 运行，同时保留 Obsidian 作为兼容 surface。
- 必须能做桌面端多面板、产物画布、右侧过程区和本地模块管理。
- 必须支持后续模块页面、Skill 编辑、Soul 配置和 Module Builder。

因此，当前阶段先继续定义功能形态和页面边界；等项目主页、对话页、产物画布、资料库、Wiki、技能、模块、团队、日历这些一级能力的边界更稳定后，再进入 Electron / Tauri / Web runtime 等技术栈比较和最终选择。

## 24. 桌面端 v0 产品边界

当前先把 v0 定义为 **本地优先桌面工作台的可用闭环**，而不是完整组织协作平台。

v0 必须跑通：

- 独立 Desktop Host 启动。
- 本地工作区和项目主页。
- 项目切换、开始新对话、打开已有对话。
- 右侧 FRIDAY 完整历史、过程 trace、工具调用和参考文件披露。
- 生成或打开可显示文件后的产物画布。
- 项目资料库 v1：以项目文件树为直接信息来源，登记文件成为资料，保存 metadata、启用 / 暂停。
- 最小项目技能 / 全局技能列表和启用状态。

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

v0 的验收口径：一个用户可以在一个本地项目里添加资料、开始对话、查看过程、生成或打开产物、看到实际参考文件、保存状态并在下次恢复。

## 25. v0 核心工作流状态流

v0 的核心工作流不是页面堆叠，而是让一个泛文档任务形成闭环：

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

已确认状态规则：

- 用户在项目主页输入框里说明要做什么，FRIDAY 创建新对话。
- 用户点击已有对话时，必须加载该对话的完整历史，并恢复该对话绑定的主产物状态。
- FRIDAY 运行时，右侧区域显示完整对话、过程 trace、工具调用、确认事项和继续输入。
- 当 FRIDAY 生成 Markdown、HTML、报告等可显示文件，或用户手动打开已有可显示文件时，主区域进入产物画布。
- 产物画布接管主区域后，右侧 FRIDAY 区域仍属于同一个对话，不变成独立聊天窗口。
- 回答底部显示 `参考文件 x 个`，点击后展开本次实际参考文件。
- 对话、产物、trace、引用记录和恢复状态都需要落盘。

## 26. 现有能力到桌面端 v0 的映射方法

已确认：下一轮规划先不继续展开团队、日历、完整模块市场。先做一张硬映射表，把 **现有能力 -> 当前代码位置 -> 桌面端产品落点 -> v0 是否需要 -> 缺口 -> 后续任务** 对齐；技术栈已在后续 M2 决策中收敛为 Electron-first。

这个决策的目的不是证明所有东西都已经能直接复用，而是避免桌面端规划脱离现有 FRIDAY 能力基础。

当前切分：

- v0 必做：Desktop HostAdapter、项目主页、对话页、过程区、权限模式、项目资料库、Reference / Trace 分离、产物画布、ArtifactStore、状态恢复和归档。
- v0 轻量做：项目 / 全局技能列表、现有 Soul 管理入口。
- v0 暂缓：项目 Wiki / 知识图谱、完整模块协议、社区 marketplace、Module Builder、团队协作系统、完整日历系统、高级 Soul agent loop。

对应的现有能力来源：

- Agent Kernel、`FridayPiRuntime`、PI SDK adapter 是桌面端 runtime 主线。
- `AgentRuntimeService`、AgentTurn contract、过程面板 view model 和 trajectory renderer 是对话 / 过程 / trace 的主要复用来源。
- `ProjectEditorService`、`WorkbenchStateStore`、`SyncOrchestrator`、`SimpleGitOperator` 和 workspace policy 是项目、远端和本地边界的主要复用来源。
- `PromptContextEngine`、`ContextAssembler`、`MentionResolver`、`MentionComposer`、`MemoryStoreV1` 和 `ProjectContentService` 是项目资料库、`@` 引用和回答参考文件的主要复用来源。
- 旧 Wiki 相关代码，例如 `WikiIngestService`、`WikiLookupService`、`WikiKnowledgeProvider`、`RelationGraphBuilder`、`CapabilityIndexBuilder`，只作为历史探索参考，不作为项目 Wiki 和知识图谱的成熟复用来源。
- `CapabilityPolicy`、`ToolGateway`、`ToolApprovalService`、`MutationPlanStore` 和 `MutationApplier` 是权限模式、工具审批和修改审查的主要复用来源。
- `SkillCommandService`、`SkillRegistry`、`InvocationResolver`、`ExecutionOrchestrator` 和内置 skill packs 是技能库和未来模块平台的基础。
- `SoulStore`、`SoulProfile` 和 Soul templates 是 v0 Soul 入口的基础，但高级 agent loop 定义后移。

实施含义：

- 第一阶段不应把“模块协议 v0”作为必须完成项；模块页可先占位，等 Desktop runtime shell、项目资料库、产物画布和权限闭环跑通后再单独设计模块协议。
- 第一阶段也不应把旧插件 Wiki 管线作为项目 Wiki 的实现基线；项目 Wiki v0 暂缓，只保留项目主页占位入口，后续再定义产品语义、数据对象和详情页。
- `DailyBoardView` 继续视为现有 Obsidian surface 的实现细节，不再作为桌面端产品语义中心。
- 后续每一个桌面端功能，都应先回答它复用哪个现有能力、需要抽出哪个 host-neutral contract、是否进入 v0。

## 27. 桌面端 v0 功能清单和对象表

已确认：v0 先收束成一个可开发的本地桌面工作台闭环，而不是完整平台。

v0 必须进入开发清单的功能区：

- Desktop shell：独立窗口、最左侧总模块栏、项目入口、设置入口、上次项目恢复。
- 项目主页：当前项目、输入框、对话列表、资料库摘要、技能摘要、协作 / 远端状态、Wiki / 团队 / 日历占位。
- 项目创建 / 加入：新建文件夹、选择已有文件夹、已有文件夹先观察再加入。
- 对话页：完整历史、右侧 FRIDAY 过程区、继续输入、任务状态、当前对话资源入口。
- 输入框 / 权限栏：`+ · 模型名称 · 权限模式`；权限为当前对话级安全 / 标准 / 自主。
- 项目资料库：项目文件树、已加入资料库列表、说明、启用 / 暂停、外部导入。
- 产物画布：当前对话产物列表、Markdown / HTML 等可显示文件打开、标签切换、状态恢复。
- Reference / Trace：回答底部 `参考文件 x 个` 和过程区 trace 分开展示。
- Skill：项目技能 / 全局技能列表、启用状态、`@skill` 引用。
- Soul / 设置：复用现有基础 Soul 管理入口和模型 / 权限设置。
- 归档 / 恢复：只做归档，不做删除；`FRIDAY/imports/<conversationId>/` 随对话归档。

v0 暂缓或占位：

- 项目 Wiki / 知识图谱。
- 团队、日历、完整模块市场、Module Builder、高级 Soul agent loop。
- 云账号、组织权限、实时多人协作、移动端、自动更新和完整 Obsidian 替代品。

v0 第一轮需要冻结的核心对象：

| 对象 | v0 最小职责 |
| --- | --- |
| `Project` | 项目 id、名称、根目录、schema version、Git Profile、默认权限模式 |
| `WorkspaceState` | 当前项目、当前对话、当前产物、布局、资源面板状态 |
| `Conversation` | 对话标题、状态、turn 顺序、产物关联、归档状态 |
| `Turn` | 单轮输入 / 回复、权限快照、显式引用、回答引用、产物关联 |
| `Trace` | 工具调用、读写文件、命令执行、审批、失败和重试事件 |
| `Reference` | 用户添加、发送时解析、回答披露三类引用事实 |
| `Artifact` | 产物 manifest、可渲染类型、当前版本、版本文件、来源 turn |
| `Import` | 项目外文件 / 图片快照、原始路径、hash、所属对话和 turn |
| `Context` | 项目资料库登记、来源类型、说明、启用状态 |
| `Skill` | 项目 / 全局 scope、说明、启用状态、来源路径 |
| `PermissionProfile` | 安全 / 标准 / 自主三档、项目默认、对话覆盖、turn 快照 |
| `GitProfile` | local-only / share-friday-layer / remote-managed 等同步策略 |

剩余缺口排序：

1. Desktop HostAdapter 工程包拆分。
2. ArtifactStore 与产物画布状态。
3. 项目资料库 metadata 和外部导入规则。
4. Reference / Trace UI contract。
5. Skill / Soul 最小边界。
6. 技术栈选择。

## 28. Desktop HostAdapter contract

已确认：Desktop HostAdapter contract 是 FRIDAY Runtime 与桌面端真实环境之间的能力合同。它不等于 Electron / Tauri 的具体 API，也不等于 UI 组件；它定义 Runtime 可以向 host 请求什么、host 必须怎么执行、哪些动作要被权限系统拦截、哪些结果要进入 trace。

核心原则：

- Runtime 不直接读写桌面文件系统，不直接操作窗口、Git、系统命令或 UI。
- Desktop HostAdapter 负责把 Runtime 请求翻译成桌面端真实动作，并返回结构化结果。
- 所有可能影响本地文件、命令、网络、Git 或用户可见状态的动作，都必须经过权限模式和 trace。
- Obsidian host 和 Desktop host 可以实现同一类 contract，但 Desktop 是 v0 主 host。
- Contract 先按能力域定义，不在这一层绑定 Electron / Tauri 技术栈。

v0 需要的能力域：

| 能力域 | 主要职责 |
| --- | --- |
| Project | 当前项目、项目根目录、`FRIDAY/` 布局、Git Profile、项目状态 |
| FileSystem | 项目文件读取、`FRIDAY/` 状态读写、外部导入快照、产物写入、路径安全 |
| Runtime State | Conversation、Turn、Trace、Reference、Artifact、WorkspaceState 的保存和恢复 |
| Permission | 安全 / 标准 / 自主三档、turn 权限快照、确认 / 拒绝 / 停止 |
| Tool Execution | 命令、Git、文件工具、后续模块工具的真实执行入口 |
| Trace / UI Event | 过程区事件、回答引用、确认事项、审计事件 |
| Artifact Surface | ArtifactStore、画布打开、版本变更、写入项目文件树 |
| Project Library | `FRIDAY/context/` metadata、项目文件登记、import 快照入库 |
| Skill / Soul | 项目 / 全局技能列表、基础 Soul 状态 |
| Git | status / diff、远端检测、同步动作、冲突检测 |

最小接口形态可以先用规划名表达：

```text
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

这些名字不是最终 TypeScript 命名。真正实现时可以拆成多个 port，例如 `ProjectHostPort`、`FileSystemHostPort`、`ArtifactHostPort`、`PermissionHostPort`、`TraceHostPort`。

不属于 HostAdapter 的职责：

- 不决定 FRIDAY 怎么思考、怎么规划任务、怎么组织回复。
- 不把 UI 文案或视觉状态写进 Runtime。
- 不直接实现 PI SDK 的 agent loop。
- 不承担完整模块市场、团队协作、云同步或高级 Soul 行为定义。

因此，v0 应先定 HostAdapter contract，再选技术栈。Electron / Tauri 的比较要服务于 host 能力，而不是先选壳再反推能力。

## 29. 桌面端 v0 实施计划与首轮顺序

已确认：桌面端 v0 的下一步不是继续扩展产品范围，而是进入工程拆分。新的可执行计划记录在 `2026-06-11-friday-desktop-v0-implementation-plan.zh.md`。

实施计划采用 HostAdapter 先行：

- 先做 Baseline，确认当前分支 `npm install`、`npm test`、`npm run build` 的真实状态。
- 再做 Desktop HostAdapter ports，冻结 Runtime 与桌面 host 的边界。
- 然后做 ProjectHost、WorkspaceState、FileSystemHost、ImportStore、PermissionHost、TraceHost 和 ToolExecutionHost。
- 在这些边界可跑后，证明 PI Runtime 可以通过 Desktop host 跑一个最小 session。
- 之后再补 Conversation / Turn / Reference、ArtifactStore、ProjectLibrary、Skill / Soul 和 UI 集成。

首轮执行顺序建议为：

1. M0 Baseline and Constraints。
2. M1 Desktop HostAdapter Ports。
3. M2 Desktop Shell Tech Spike。
4. M3 ProjectHost and WorkspaceState。
5. M4 FileSystemHost and RuntimeState Store。
6. M5 PermissionHost, TraceHost and ToolExecution Boundary。
7. M10 PI Runtime Through Desktop Host。

理由：M1 先定义 FRIDAY 需要的 host 能力，M2 立刻用真实 smoke 判断桌面壳，随后再回答“FRIDAY Desktop 是否真的能作为 PI-first Runtime host 跑起来”。如果这个闭环成立，再做产物画布、资料库、资源窗口和完整 UI，风险更低。

技术栈选择不是在产品讨论阶段拍脑袋决定，但也不能无限后置。M2 是明确的技术栈决策门：M1 冻结 HostAdapter 能力后，必须用真实 smoke 判断桌面壳和 runtime ownership；未完成 Electron `BrowserWindow` + preload + renderer smoke 之前，不进入完整 UI integration。

## 30. 桌面壳技术栈决策门

已确认：v0 技术栈选择 **Electron-first**。定稿顺序仍然是 **HostAdapter contract -> 技术栈 spike -> v0 shell 决策**。M2 的结论是：先用 Electron main process 承载 Node/PI runtime，Tauri + Node sidecar 保留为后续平台化或迁移方向。

Electron-first 的分工：

- Electron main process：窗口、菜单、PI SDK、FRIDAY runtime、HostAdapter node implementations、文件读写、命令执行、Git、artifact、library、reference、trace 和 state persistence。
- Preload bridge：只暴露 typed HostAdapter IPC，不泄漏 Node / Electron 全能力。
- Renderer：项目主页、对话页、画布、资源窗口、输入框权限控件和过程展示。

选择原因：

- M2 smoke 已证明 Node 侧 PI SDK、最小 PI session、shell、文件系统和日志原语可跑，Electron main process 可以直接承载这些能力。
- FRIDAY v0 的目标是先证明桌面端作为 PI-first Runtime host 可运行，而不是先建设 sidecar lifecycle、IPC、打包和崩溃恢复体系。
- Electron main / preload / renderer 分层天然匹配 HostAdapter 边界：受信 host 在 main，受控 bridge 在 preload，UI 在 renderer。

新增风险：

- M11 前必须补真实 Electron `BrowserWindow` + preload + renderer smoke。
- Electron main process 权限面更宽，renderer 必须严格隔离，所有 fs / shell / Git 走 HostAdapter 和 PermissionHost。
- Tauri + Node sidecar 的长期价值仍然成立，但不进入 v0 主线，避免第一版被 sidecar 打包和 IPC 复杂度拖慢。
