---
name: lookup-wiki
description: 执行 Brain-First Lookup 四步回退协议，为 Agent 提供项目背景知识。完全替代 semantic_search 作为首版检索主路径。
command: lookup-wiki
aliases: [lookup, search-wiki, find-wiki]
tags: [knowledge, search, retrieve]
trigger: Agent 在执行任务前评估需要补充背景知识时自动触发，或用户提问涉及项目知识时
executionMode: agent_orchestrated
---

# Skill: lookup-wiki

> **架构哲学**：Thin Harness, Fat Skills —— 判断力上移到 Skill（本文件），确定性执行下沉到 Harness（代码层）。

## 1. 核心定位

此技能是 F.R.I.D.A.Y 知识体系的**读取端**，实现了 Brain-First Lookup 四步回退协议。它的核心思想是：在不依赖 Embedding 或复杂向量检索的前提下，通过智能的层级降级策略，优先读取高密度的 Compiled Truth，从而提供高召回率和可解释的检索结果。

此技能与 `compile-wiki`（写入端）共同构成知识的**存取闭环**。`semantic_search` 已降级为 P2 后置候选，首版检索完全由本技能接管。

## 2. 强约束

1. **严格四步回退**：必须按 Keyword Match → Direct Read → Relation Walk → Fallback 的顺序执行。**禁止在前三步已获得充足信息时调用 Fallback。**
2. **相对路径引用**：所有文件操作必须使用 `<projectRoot>/...` 形式的相对路径。
3. **优先 Compiled Truth**：检索结果必须优先返回 Wiki 页面的 Compiled Truth 部分（`---` 分隔线以上的内容）。
4. **sourceMap 必须**：每次检索结果必须附带 sourceMap，记录来源路径和命中步骤。
5. **关系路径可解释**：当通过 Relation Walk 获取信息时，必须给出关系路径摘要（如 `A → B(tag:xxx) → C`）。

## 3. 依赖工具

| 工具 | 用途 |
|------|------|
| `read` | 读取 Wiki 页面（尤其是 Compiled Truth 部分） |
| `search_text` | 在 index.md 或全库执行关键字匹配 |

## 4. 执行步骤

### Step 1: Keyword Match (入口点)

1. 从用户问题或当前任务需求中提取检索关键词。
2. 使用 `search_text` 工具在 `<projectRoot>/wiki/index.md` 中进行关键字匹配。
3. 若 `index.md` 中有命中，提取最相关的 Wiki 页面路径（如 `<projectRoot>/wiki/pages/xxx.md`）。
4. 若 `index.md` 未命中，尝试在 `<projectRoot>/wiki/pages/` 目录结构中进行浅层关键字匹配（基于文件名和目录名）。
5. 若仍未命中，跳转至 Step 4 (Fallback)。

**失败分类**：若 `index.md` 不存在，标注 `dependency_unavailable` 警告，直接跳转 Step 4。

### Step 2: Direct Read (高密度读取)

1. 如果在 Step 1 成功定位了 Wiki 页面路径，使用 `read` 工具读取该页面。
2. **关键动作**：优先提取该页面的 Compiled Truth 部分（即 `---` 分隔线以上的内容）。
3. 评估读取到的信息是否足以回答用户问题或满足当前任务的背景需求。
4. **终止条件**：若信息充足，**立即结束检索**，组装输出并返回。不得继续执行后续步骤。

### Step 3: Relation Walk (关系扩散)

> 仅当 Step 2 的信息不足时才进入此步骤。

1. 提取当前 Wiki 页面中的 `[[双链]]`、`#标签` 和 `See Also` 引用。
2. 如果项目维护了关系图谱（`raw_relation_graph`），读取当前节点的 1-hop 邻居列表。
3. 从邻居中选择最相关的 1-2 个 Wiki 页面，使用 `read` 读取其 Compiled Truth。
4. 综合多个页面的信息，评估是否充足。
5. **终止条件**：若信息充足，**立即结束检索**，组装输出并返回。不得继续执行 Step 4。
6. 记录关系路径摘要（如 `context-compression-strategy → [[context-assembler]](tag:D4) → [[agent-loop-lifecycle]]`）。

### Step 4: Fallback (兜底搜索)

> 仅当前三步均未命中，或信息严重不足时才进入此步骤。

1. 使用 `search_text` 在全库范围执行关键字检索，搜索范围包括：
   - `<projectRoot>/raw/`（原始笔记）
   - `<projectRoot>/wiki/pages/`（Wiki 页面全文）
   - `<projectRoot>/workspace/`（人机共享暂存区，含 AI 生成文件和用户草稿）
   - 其他相关目录
2. 收集零散的匹配片段作为补充证据。
3. 若仍无结果，返回"未找到相关知识"的明确回复，不编造信息。

**失败分类**：若 `search_text` 工具本身执行失败，返回 `tool_runtime_error`。

## 5. 输出契约

每次检索完成后，必须返回以下结构化信息：

1. **核心事实与摘要**：从 Compiled Truth 或其他来源提取的关键信息。
2. **sourceMap**（必须）：

| 字段 | 说明 |
|------|------|
| `hitStep` | 命中步骤（`keyword_match` / `direct_read` / `relation_walk` / `fallback`） |
| `sourcePath` | 信息来源的文件路径 |
| `sourceSection` | 信息来源的页面区域（`compiled_truth` / `timeline` / `raw`） |
| `relationPath` | 若通过 Relation Walk 获取，记录关系路径摘要 |

3. **置信度评估**：基于命中步骤和信息密度，给出简要的置信度说明（如"高置信：直接命中 Compiled Truth"或"低置信：仅 Fallback 片段匹配"）。

## 6. 检索示例

**场景**：用户问"F.R.I.D.A.Y 的上下文压缩策略是什么？"

**Step 1 (Keyword Match)**：
- 在 `index.md` 中搜索"上下文压缩"。
- 命中条目：`wiki/pages/context-compression-strategy.md — 上下文压缩策略`。

**Step 2 (Direct Read)**：
- 读取 `<projectRoot>/wiki/pages/context-compression-strategy.md` 的 Compiled Truth。
- 获得完整的压缩策略描述。
- 信息充足，**终止检索**。

**输出**：
```
核心事实：F.R.I.D.A.Y 采用 Semantic Compactor 进行上下文压缩...
sourceMap: { hitStep: "direct_read", sourcePath: "<projectRoot>/wiki/pages/context-compression-strategy.md", sourceSection: "compiled_truth" }
置信度：高（直接命中 Compiled Truth）
```
