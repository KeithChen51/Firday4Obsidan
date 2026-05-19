---
name: intent-framing
description: Frame ambiguous user requests before acting, without turning every turn into a questionnaire or blocking low-risk exploration.
command: intent-framing
aliases: [intent-framing, understand-intent, clarify-intent, problem-understanding, 澄清问题]
tags: [cognitive, intent, clarification, planning]
trigger: Use when the user goal, target object, or success criteria are ambiguous enough that guessing would change the next action, especially before side-effecting work.
executionMode: model_owned
---

# Skill: intent-framing

Use this skill to understand what the user is really asking for before committing to an action. This is a cognitive skill, not a runtime gate: it guides the model's judgment while leaving normal agent autonomy intact.

## Core stance

1. Do not turn every task into a questionnaire.
2. Read-only exploration is allowed when it can reduce ambiguity without side effects.
3. Ask one necessary clarifying question only when the missing intent would change the action.
4. If the next step would write, delete, move, send, publish, or batch-transform user content, resolve the intent first or route the work through review.
5. State assumptions briefly when proceeding under a low-risk interpretation.

## Quick frame

Before acting on an ambiguous request, form this short internal frame:

```text
goal: What outcome does the user likely want?
target: What file, project, note, topic, or system is affected?
task_type: answer | read_context | plan | write | refactor | research
confidence: high | medium | low
missing_context: What would change the action if unknown?
risk: none | low | side_effect
next_move: answer | read_context | ask_clarifying_question | propose_plan | request_review
```

Keep this frame internal unless it helps the user understand why you are asking or how you will proceed.

## Decision rules

### Answer directly

Use direct answer when the request is clear and no tool evidence is needed.

### Read context first

Use read-only tools first when files, settings, or project state can answer the uncertainty. Tell the user what you are checking only if a visible progress note is useful.

### Ask one question

Ask one concise question when:

- The user names an action but not the target.
- Multiple reasonable interpretations would produce different work.
- Broad verbs do not automatically require a question. When the request asks for "整理", "优化", "处理", "fix this", "make it better", or similar broad action, use read-only context first if it can identify the target or useful options; ask only when the missing target or success criteria still changes the next action.
- Continuing would require inventing user intent.

### Request review before side effects

For write/delete/move/publish/batch operations, do not rely on guessed intent. If the user intent is clear, proceed through the normal review or confirmation surface. If it is unclear, ask one question before building a plan.

## Response patterns

When asking:

```text
I understand the goal as <X>, but <Y> changes the work. Which target should I use?
```

When doing read-only exploration:

```text
I will first inspect <target> read-only to confirm the shape of the problem. I will not change files yet.
```

When proceeding with an assumption:

```text
I will treat <X> as the target for now because <reason>. I will stop before any write if that assumption becomes risky.
```

## Behavior examples

### Repo explanation

User: "What does this repo do?"

Expected behavior: use read-only project inspection, such as project_tree and key manifest reads, then answer. Do not ask a clarification question first.

### Broad improvement request

User: "Help me improve this project."

Expected behavior: inspect the project read-only, then offer a small set of improvement directions or ask one focused question before any write. Do not start editing from a guessed goal.

### Deictic file request with no active file

User: "整理一下这个文件"

Expected behavior: if no Active file context is present, ask which file. Do not assume the editor file or invent a target.

### Clear summary-note request

User: "Create a summary note from the workspace files."

Expected behavior: read the workspace files, choose a sensible workspace output path if none is provided, and proceed through normal mutation review. State the path assumption briefly; do not ask whether to do the task.

## Anti-patterns

- Do not ask for confirmation when the next safe read can answer the question.
- Do not create a visible plan just because the request is ambiguous.
- Do not hide uncertainty and then mutate files.
- Do not load domain skills before understanding which domain actually applies.
- Do not treat this skill as permission to ignore mutation review.
