---
name: maintain-memory
description: 将对话中散落的用户偏好、约束规则和纠错信息提炼到长期文件化记忆仓，支持主动触发和静默触发。
command: maintain-memory
aliases: [remember, memory, save-pref]
tags: [memory, preferences, constraints]
trigger: 用户主动 `/remember`，或 Semantic Compactor 在压缩上下文时静默触发
executionMode: agent_orchestrated
---

# Skill: maintain-memory

> **架构哲学**：Thin Harness, Fat Skills —— 判断力上移到 Skill（本文件），确定性执行下沉到 Harness（代码层）。

## 1. 核心定位

此技能是 F.R.I.D.A.Y 记忆系统（D6）的**写入端**。它将对话历史中散落的用户偏好、约束规则和纠错信息，提炼并持久化到长期文件化记忆仓中，确保 Agent 在后续会话中能够召回这些信息。

记忆仓分为两层，与 §1.7 Vault 目录结构约束对齐：

| 层级 | 存储路径 | 内容 |
|------|----------|------|
| 全局记忆 | `F.R.I.D.A.Y/memory/global_user_memory.md` | 跨项目通用的用户偏好和约束（如"回复尽量简短"） |
| 项目记忆 | `<projectRoot>/memory/project_behavior_memory.md` | 当前项目特定的行文规范和行为约束（如"本项目用 TypeScript"） |

## 2. 强约束

1. **可读可改可审计**：记忆条目必须是人类可读的 Markdown 格式，带来源引用（turnId 或时间戳）。拒绝黑盒隐式 Prompt。
2. **冲突保护**：不得无依据覆盖已有记忆条目。冲突时必须保留旧条目并标记冲突，或执行合并覆盖并保留变更原因。
3. **静默执行**：当 Semantic Compactor 触发时，此过程应在后台静默执行，不弹窗、不阻断主流程。
4. **纠错最高优先级**：如果用户纠正了 Agent 关于某个事实或偏好的错误认知，该纠正必须立即写入记忆，不得延迟或批量处理。

## 3. 依赖工具

| 工具 | 用途 |
|------|------|
| `read` | 读取上下文快照和现有的记忆文件 |
| `write` | 更新或覆盖记忆文件 |
| `append` | 向记忆文件追加新条目 |

## 4. 执行步骤

### Step 1: 记忆识别与提取

1. 扫描当前的 `ContextAssembledSnapshot`（对话历史、用户指令等）。
2. 识别并提取以下模式：
   - **偏好表达**："以后不要用粗体"、"回复尽量简短"
   - **指令修改**："在这个项目中必须用 React"、"代码注释用英文"
   - **错误纠正**："不对，应该是 TypeScript 而不是 JavaScript"
   - **约束声明**："不要引入新的依赖"、"所有 API 必须有错误处理"
3. 为每个提取的记忆生成一段简明的规则描述。

**失败分类**：若上下文快照为空或不可读，返回 `invalid_input` 并终止。

### Step 2: 作用域判定

1. 评估提取的记忆是否具有全局适用性。
2. 判定规则：
   - 若为通用偏好（如"回复尽量简短"、"不要用 emoji"），标记为 `global`。
   - 若为项目特定规范（如"本项目采用 React 框架"、"API 前缀用 /v2"），标记为 `project`。
   - 若无法判定，默认标记为 `project`（避免全局污染）。

### Step 3: 冲突检测与合并

1. 根据作用域，使用 `read` 读取目标记忆文件：
   - `global` → `F.R.I.D.A.Y/memory/global_user_memory.md`
   - `project` → `<projectRoot>/memory/project_behavior_memory.md`
2. 检查文件中是否已存在语义相同或矛盾的旧记忆。
3. 冲突处理策略：
   - **无冲突**：直接追加新条目。
   - **语义相同**：跳过，不重复写入。
   - **矛盾冲突**：以最新提取的记忆为准，更新旧条目，并附加变更记录：
     ```
     [Updated: YYYY-MM-DD] 旧规则 → 新规则 (Reason: 用户纠正/新指令, Source: turnId)
     ```

**失败分类**：若记忆文件不存在，自动创建空文件后继续执行。

### Step 4: 格式化写入

1. 将提炼后的记忆按统一格式组织，按类别分组：

```markdown
# User Memory

## Formatting
- 回复尽量简短，避免冗长段落。 (Source: turn-20260412-001)
- 不要使用 emoji。 (Source: turn-20260411-003)

## Behavior
- 修改文件前必须先确认。 (Source: turn-20260410-002)

## Tech Stack
- 本项目采用 TypeScript + React。 (Source: turn-20260412-005)
  [Updated: 2026-04-12] JavaScript → TypeScript (Reason: 用户纠正)

## Constraints
- 不引入新的外部依赖。 (Source: turn-20260409-001)
```

2. 使用 `write`（全量更新）或 `append`（仅追加新条目）将格式化后的内容写入对应的记忆文件。
3. 确保文件结构清晰，便于人类直接阅读和编辑。

**失败分类**：若写入失败，返回 `tool_runtime_error`，但不阻断主对话流程。

### Step 5: 审计记录

1. 记录本次记忆操作的审计信息：
   - 触发来源（manual: `/remember` / auto: Semantic Compactor）
   - 提取的记忆条目数量
   - 冲突处理情况（无冲突 / 合并 N 项 / 跳过 N 项）
   - 写入目标（global / project）
2. 此审计信息将由 Harness 层写入 `tool_runs` 记录。

## 5. 失败分类汇总

| 失败场景 | 错误分类 | 处理策略 |
|----------|----------|----------|
| 上下文快照为空或不可读 | `invalid_input` | 终止，不写入 |
| 记忆文件不存在 | 自动创建 | 继续执行 |
| 记忆文件写入失败 | `tool_runtime_error` | 不阻断主流程，记录错误 |
| Agent 提炼/判定失败 | `tool_runtime_error` | 终止，不写入 |
