---
name: compile-wiki
description: 将当前项目的 Raw 笔记编译为高密度的双层 Wiki 页面（Compiled Truth + Timeline），并维护项目级索引 index.md、关系图和标签归档。
command: compile-wiki
aliases: [compile, build-wiki, sync-wiki]
tags: [knowledge, wiki, ingest]
trigger: 用户主动 `/compile-wiki`，或 Agent 在写入大量新 Raw 笔记后主动触发
executionMode: agent_orchestrated
---

# Skill: compile-wiki

> **架构哲学**：Thin Harness, Fat Skills —— 判断力上移到 Skill（本文件），确定性执行下沉到 Harness（代码层）。

## 1. 核心定位

此技能是 F.R.I.D.A.Y 知识体系的**写入端**。它将当前项目 `<projectRoot>/raw/` 或 `<projectRoot>/workspace/`（经用户审核后）下的散乱笔记、对话片段编译并浓缩为标准的双层结构 Wiki 页面，存储到 `<projectRoot>/wiki/pages/`。同时同步维护 `<projectRoot>/wiki/index.md`、关系图谱和标签归档。

此技能与 `lookup-wiki`（读取端）共同构成知识的**存取闭环**。

## 2. 强约束

1. **重写而非增强**：Compiled Truth 部分必须是基于最新全量理解的**完全重写**，形成当前共识快照。禁止在旧文本上做增量拼接。
2. **不可篡改的 Timeline**：Timeline 区域是追加式（Append-only）的原始证据链接。严禁修改或删除已有的 Timeline 条目。
3. **相对路径引用**：所有文件操作必须使用 `<projectRoot>/...` 形式的相对路径，不得硬编码全局路径。
4. **标签保护**：用户在 Obsidian 中手工维护的文档标签是一级输入信号，不可被 AI 无依据覆写。AI 可在规则命中时补充标签，但必须记录证据。
5. **归档可追溯**：每次编译操作必须可追溯到"命中规则 + 标签来源 + 路由决策"的审计记录。

## 3. 依赖工具

| 工具 | 用途 |
|------|------|
| `read` | 读取源文件、现有 Wiki 页面、标签规则 |
| `write` | 写入新的 Wiki 页面或覆盖 Compiled Truth |
| `append` | 向 Timeline 追加证据条目 |
| `search_text` | 在项目中搜索相关实体或上下文 |

## 4. 执行步骤

### Step 1: 输入解析与源材料读取

1. 识别触发源：当前编辑的文件、指定的 `raw/` 子目录、`workspace/` 中已审核的文件，或对话选区。
   > `workspace/` 是人机共享暂存区，AI 生成文件默认落地于此，用户草稿亦可存放。只有经用户审核确认的内容才应被编译入 Wiki。
2. 使用 `read` 工具读取源内容。
3. 提取核心实体（人物、概念、项目、决策）、定义、关键事实和关系。

**失败分类**：若触发源不存在或不可读，返回 `invalid_input` 错误并终止。

### Step 2: 标签规则加载与分类

1. 使用 `read` 读取 `<projectRoot>/wiki/_governance/tag-policy/` 下的标签规则文件。
2. 根据规则对源材料进行分类（文档类型 → 标签 → 归档路由）。
3. 提取源材料中用户已手工标注的标签（`#tag` 或 frontmatter tags），将其作为一级输入信号。
4. 若 AI 判断需要补充标签，必须基于规则命中，并在后续审计记录中注明证据。

**失败分类**：若标签规则文件不存在，降级为"无规则模式"继续执行，但在输出中标注 `tag_policy_missing` 警告。

### Step 3: 评估与路由

1. 判断提取的信息属于"新实体（CREATE）"还是"现有实体的补充（UPDATE）"。
2. 若为 UPDATE，使用 `read` 读取 `<projectRoot>/wiki/pages/` 下的当前 Wiki 页面。
3. 若为 CREATE，确定新页面的 slug（文件名），遵循项目命名规范。
4. 根据标签分类结果，确定归档路由（页面应存放在 `wiki/pages/` 的哪个子路径下）。

### Step 4: 提炼 Compiled Truth (上半部分 — 重写)

1. 综合源内容与现有知识（若为 UPDATE），**完全重写**一份高密度的"共识快照"。
2. 结构要求：
   - **一段式执行摘要**：如果只读这一段，就能了解该实体的当前状态。
   - **结构化状态字段**：如 `Status`、`Owner`、`Tags`、`Related` 等。
   - **Open Threads**：当前未解决的活跃问题（解决后移入 Timeline）。
   - **See Also**：指向相关 Wiki 页面的 `[[双链]]`。
3. 抹除冗余的时间线噪音，只保留当前有效的结论。

### Step 5: 构建 Timeline 证据链 (下半部分 — 追加)

1. 将本次编译的原始片段或源文件链接（附带时间戳）追加到页面的 Timeline 区域。
2. 格式：`- [YYYY-MM-DD] [来源路径或链接]: [原始事件/事实描述]`
3. 如果 Open Threads 中有已解决的问题，将其从 Compiled Truth 移入 Timeline 并标注解决方案。
4. **严禁修改或删除已有的 Timeline 条目。**

### Step 6: 页面组装与写入

1. 按以下结构组装最终的 Markdown 页面：

```markdown
---
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
slug: entity-name
---

# [页面标题]

## Compiled Truth

[一段式执行摘要]

**Status:** ...
**Owner:** ...
**Tags:** ...

### Open Threads
- ...

### See Also
- [[related-page-1]]
- [[related-page-2]]

---

## Timeline

- [YYYY-MM-DD] [来源]: [事件描述]
- [YYYY-MM-DD] [来源]: [事件描述]
```

2. 使用 `write` 工具将组装好的内容写入 `<projectRoot>/wiki/pages/[slug].md`。

**失败分类**：若写入失败，返回 `tool_runtime_error` 并保留源材料不丢失。

### Step 7: 更新索引与关系图

1. 使用 `read` 读取 `<projectRoot>/wiki/index.md`。
2. 若是新页面，在合适的分类下追加其路径、功能标签和一句话描述。
3. 若是更新页面，刷新 `index.md` 中该页面的描述和标签。
4. 提取页面中的 `[[双链]]` 和 `#标签`，更新关系图谱：
   - **节点**：文档（必须）、章节（可选二级节点）。
   - **边**：`wikilink`、反向链接、标签共现、目录父子、显式引用。
5. 使用 `write` 保存更新后的 `index.md`。

**失败分类**：若 `index.md` 更新失败，返回 `tool_runtime_error`，但已写入的 Wiki 页面不回滚（允许后续重试索引更新）。

### Step 8: 审计记录

1. 记录本次编译操作的审计信息：
   - 触发来源（manual / auto）
   - 操作类型（CREATE / UPDATE）
   - 命中的标签规则
   - 标签变更（新增/保留/AI 补充）
   - 归档路由决策
   - 关系图变更摘要
2. 此审计信息将由 Harness 层写入 `tool_runs` 记录。

## 5. 失败分类汇总

| 失败场景 | 错误分类 | 处理策略 |
|----------|----------|----------|
| 触发源不存在或不可读 | `invalid_input` | 终止，返回错误 |
| 标签规则文件缺失 | `dependency_unavailable`（降级） | 继续执行，标注警告 |
| Wiki 页面写入失败 | `tool_runtime_error` | 终止，保留源材料 |
| index.md 更新失败 | `tool_runtime_error` | 页面已写入，允许重试索引 |
| Agent 计划/提炼失败 | `tool_runtime_error` | 终止，保留源材料 |

## 6. 页面模板示例

```markdown
---
tags: [architecture, decision]
created: 2026-04-12
updated: 2026-04-12
slug: context-compression-strategy
---

# 上下文压缩策略

## Compiled Truth

F.R.I.D.A.Y 采用 Semantic Compactor 进行上下文压缩，替代硬比例截断方案。
压缩器在 token 预算即将耗尽时触发，通过语义分析保留高价值信息，丢弃冗余内容。

**Status:** 已确认（D4）
**Owner:** Agent Runtime
**Tags:** #context #compression #D4

### Open Threads
- 压缩比例的最优阈值尚未通过实测确定。

### See Also
- [[context-assembler]]
- [[agent-loop-lifecycle]]

---

## Timeline

- [2026-04-10] raw/meeting-notes-0410.md: 讨论确认采用 Semantic Compactor 替代硬截断。
- [2026-04-09] raw/decision-log-d4.md: D4 维度决策初稿，提出三种压缩方案。
```
