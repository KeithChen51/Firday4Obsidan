---
name: resolve-conflict
description: 在同步或文件修改发生冲突时，由 Agent 驱动生成修复建议（Fix Proposal），提交用户审批，替代传统报错阻断流程。
command: resolve-conflict
aliases: [resolve, fix-conflict, merge]
tags: [collaboration, git, merge, conflict]
trigger: SyncService 抛出合并冲突事件，或多文件 Apply 发生冲突时触发
executionMode: agent_orchestrated
---

# Skill: resolve-conflict

> **架构哲学**：Thin Harness, Fat Skills —— 判断力上移到 Skill（本文件），确定性执行下沉到 Harness（代码层）。

## 1. 核心定位

此技能是 F.R.I.D.A.Y 冲突处理机制（D10）的**仲裁端**。当系统检测到文件冲突时，它主动介入并基于项目上下文生成结构化的合并建议（Fix Proposal），提交给用户审批。这将传统的"抛出报错等人工"流程，升级为"AI 主动提案等审批"流程。

## 2. 强约束

1. **必须审批**：Fix Proposal 必须提交用户审批，**不得自动强行覆盖**任何文件。
2. **洞察说明**：Proposal 必须包含"本地意图 + 远端意图 + 合并策略"的可解释摘要，让用户理解合并的后果。
3. **回退机制**：用户拒绝 Proposal 后，必须能回退到手动解决流程，保持文件中的冲突标记不变。
4. **non-modal 交互**：审批流程优先使用页面内嵌区块或侧边面板，不使用弹窗（Modal），遵循全局交互约束（§1.6）。

## 3. 依赖工具

| 工具 | 用途 |
|------|------|
| `read` | 读取冲突文件中的 Diff 标记和上下文 |
| `shell` | 调用 Git 命令提取差异（如 `git diff`、`git log`） |
| `write` | 将合并结果写回原文件 |

可选调用：
| 技能 | 用途 |
|------|------|
| `lookup-wiki` | 检索项目背景知识以辅助意图推断 |

## 4. 执行步骤

### Step 1: 冲突检测与 Diff 提取

1. 接收冲突事件，获取冲突文件路径。
2. 使用 `read` 读取冲突文件，定位包含冲突标记的区域：
   - `<<<<<<< HEAD`（本地版本）
   - `=======`（分隔符）
   - `>>>>>>> [branch/commit]`（远端版本）
3. 如果需要更详细的差异信息，使用 `shell` 调用 `git diff` 或 `git log` 获取变更历史。
4. 提取本地版本、远端版本的代码/文本片段。

**失败分类**：若冲突文件不存在或无法读取，返回 `invalid_input` 并终止。

### Step 2: 语义分析与意图推断

1. 分析冲突块的语义和上下文意图：
   - 本地修改的目的是什么？（修 Bug？重构？新增功能？）
   - 远端修改的目的是什么？
   - 两者的修改是否可以共存？是否存在逻辑冲突？
2. 如果冲突涉及核心逻辑或复杂概念，可调用 `lookup-wiki` 检索相关的项目背景知识（如架构决策、API 变更记录）。
3. 结合检索到的上下文，验证和丰富意图推断。

### Step 3: 生成 Fix Proposal

1. 基于分析结果，生成一份结构化的 Fix Proposal，包含以下部分：

```markdown
# Fix Proposal

## 冲突摘要
- **文件**: <projectRoot>/path/to/file.ts
- **冲突区域**: 第 42-58 行
- **冲突类型**: 逻辑冲突 / 文本冲突 / 格式冲突

## 意图分析

### 本地修改意图
[解释本地修改试图解决什么问题]

### 远端修改意图
[解释远端修改试图解决什么问题]

## 合并策略
[解释为什么选择保留某一方，或者如何将两者的修改融合]

## 合并后的代码
```[language]
[解决冲突后的完整代码/文本块]
```

## 风险评估
- [潜在的副作用或需要注意的事项]
```

2. 如果一个文件中有多个冲突块，为每个冲突块生成独立的分析和建议。

**失败分类**：若 Agent 无法推断意图或生成合理的合并建议，返回 `tool_runtime_error`，并建议用户手动解决。

### Step 4: 交付审批

1. 将 Fix Proposal 格式化为可读的 Markdown 报告。
2. 通过 non-modal 交互方式（页面内嵌区块或侧边面板）提交给用户。
3. 等待用户响应。

### Step 5: 应用或回退

**用户确认（Approve）**：
1. 使用 `write` 将合并后的代码写回原文件，移除所有冲突标记。
2. 解除冲突状态，允许系统继续后续操作（如 Commit / Sync）。
3. 记录审计信息：合并策略、用户确认时间。

**用户拒绝（Reject）**：
1. 保持文件中的冲突标记不变。
2. 提示用户可以手动编辑文件解决冲突。
3. 记录审计信息：拒绝原因（如果用户提供）。

**失败分类**：若写入合并结果失败，返回 `tool_runtime_error`，保持文件原状。

## 5. 失败分类汇总

| 失败场景 | 错误分类 | 处理策略 |
|----------|----------|----------|
| 冲突文件不存在或不可读 | `invalid_input` | 终止，返回错误 |
| Git 命令执行失败 | `tool_runtime_error` | 降级为仅基于文件内容分析 |
| Agent 无法生成合理建议 | `tool_runtime_error` | 终止，建议用户手动解决 |
| 合并结果写入失败 | `tool_runtime_error` | 保持文件原状，不丢失数据 |

## 6. Fix Proposal 示例

```markdown
# Fix Proposal

## 冲突摘要
- **文件**: <projectRoot>/src/services/AgentRuntimeService.ts
- **冲突区域**: 第 128-145 行
- **冲突类型**: 逻辑冲突

## 意图分析

### 本地修改意图
修复了 `runTurn` 方法中的空指针异常：在访问 `context.session` 前增加了 null check。

### 远端修改意图
重构了 `runTurn` 方法的参数签名：将 `context` 参数拆分为 `sessionContext` 和 `turnContext` 两个独立参数。

## 合并策略
两者的修改可以共存。采用远端的参数重构，同时在新的 `sessionContext` 参数上保留本地的 null check 逻辑。

## 合并后的代码
```typescript
async runTurn(sessionContext: SessionContext | null, turnContext: TurnContext): Promise<TurnResult> {
  if (!sessionContext) {
    throw new AgentError('SESSION_CONTEXT_NULL', 'sessionContext is required');
  }
  // ... rest of the method
}
```

## 风险评估
- 需要检查所有调用 `runTurn` 的地方是否已适配新的双参数签名。
```
