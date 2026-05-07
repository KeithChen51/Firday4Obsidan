# FRIDAY Approval Composer Decision

> **For implementation handoff:** approval is not a modal, not a floating dock, and not a normal chat message. Pending approval occupies the chat composer itself.

**Goal:** Make all blocking approvals appear where the user is already about to act: the bottom chat input area.

**Decision:** When FRIDAY is waiting for approval, the composer enters an approval state. The normal text area is replaced by an approval panel, while the composer chrome remains visible.

**Architecture:** Process timeline explains what happened. The approval composer handles what the user must decide now. Final answer remains reserved for results.

---

## Product Decision

Approval UI must occupy the chat composer itself.

Do not render blocking approvals as:

- a modal;
- a floating dock above the composer;
- a normal assistant message inside the transcript;
- a detailed item embedded inside the process timeline.

When approval is pending:

- the bottom text input area is replaced by a compact approval panel;
- the model selector, permission mode, `+Skill`, and `@` affordances remain visible as composer chrome;
- primary approval actions live inside the composer approval panel;
- users may still type, but submitted messages are queued until approval is resolved;
- the process timeline only shows a concise waiting state.

The composer approval state should make the blocking decision obvious without hiding context or interrupting with a modal.

## Approval Scenario Inventory

### 1. File Mutation Review

Includes:

- create file;
- write full file;
- edit existing file;
- delete Vault file.

Composer copy:

- Title: `需要确认文件修改`
- Summary: `FRIDAY 准备修改 {count} 个文件，请确认是否应用。`
- Primary action: `应用修改`
- Secondary actions: `查看差异`, `拒绝`

Rules:

- Standard mode uses this single approval path only.
- Do not also request tool approval for the same file mutation.
- Auto mode should auto-apply create/write/edit.
- Delete may remain protected unless a separate dangerous-auto policy is explicitly introduced.
- Strict mode should block mutation or ask the user to switch mode, instead of silently creating pending review.

### 2. Mutation Conflict

Occurs when a prepared file change is no longer cleanly applicable because the target file changed.

Composer copy:

- Title: `文件已变化，需要重新确认`
- Summary: `{path} 在修改准备后发生变化。`
- Primary action: `查看冲突`
- Secondary actions: `重新生成`, `放弃修改`

Rules:

- Do not show `应用修改` until conflict resolution is available.
- Keep the original prepared change recoverable when possible.
- The process timeline should show this as a review-stage interruption, not as a raw tool error.

### 3. Mutation Apply Failure

Occurs when FRIDAY prepared a change, but applying it failed.

Composer copy:

- Title: `修改未能应用`
- Summary: `FRIDAY 未能应用 {path} 的修改。`
- Primary action: `重试应用` when retryable.
- Secondary actions: `查看原因`, `放弃修改`

Rules:

- If the agent can continue, process status should be `running_with_warning`, not terminal failed.
- Terminal failure UI appears only after the turn actually stops.

### 4. High-Risk Tool Approval

Includes non-file side effects:

- `exec`;
- external access;
- future tools that can affect system state outside normal Vault file mutation.

Composer copy:

- Title: `需要授权工具操作`
- Summary: `FRIDAY 想要执行 {tool}。`
- Primary action: `允许执行`
- Secondary actions: `拒绝`, optional `本次会话允许`

Rules:

- This is separate from file mutation review.
- Do not use high-risk tool approval for ordinary create/write/edit file changes.
- If the tool has target path or command preview, show a compact preview in the composer panel.

### 5. Unsupported Or Destructive Action

Includes:

- folder delete;
- path outside project boundary;
- unsupported compile or disabled capability;
- operation that cannot be safely represented as a reviewable mutation.

Composer copy:

- Title: `此操作暂不支持`
- Summary: `FRIDAY 无法安全执行这个操作。`
- Primary action: `了解原因`
- Secondary action: `取消`

Rules:

- Prefer clear blocking over pretending the action is reviewable.
- If there is a safe alternative, offer it as the primary action.

### 6. User Input Required

Occurs when FRIDAY cannot proceed without clarification.

Composer copy:

- Title: `需要你补充信息`
- Summary: a direct question or missing input requirement.
- Primary action: normal send action.

Rules:

- Keep the text input editable.
- This is an input state, not approve/reject.
- The composer should visually indicate the missing information while preserving normal typing.

### 7. Queue While Blocked

Occurs when the user types while approval is pending.

Composer copy:

- Hint: `当前任务等待确认，新消息会排队。`
- Queue badge: `待发送 {count}`

Rules:

- Sending a message queues it.
- Queuing must not dismiss approval.
- Approval controls remain the primary focus.

### 8. Multiple Pending Approvals

Occurs when more than one independent approval is pending.

Composer copy:

- Title: `{count} 项待确认`
- Summary: show the current blocking approval first.

Rules:

- Avoid stacking multiple full approval cards inside the composer.
- Use compact navigation or a grouped list.
- If approvals are sequentially dependent, show only the current blocker.

## Placement Contract

The approval composer replaces the input body but keeps the composer footprint.

Required regions:

- approval header;
- compact target summary;
- optional inline diff or command preview;
- action row;
- composer chrome row with model/mode/skill/reference controls;
- queue hint when relevant.

The chat transcript may contain a short assistant message such as `FRIDAY 已准备好文件修改，等待你确认后继续。`, but the actionable controls must stay in the composer.

## Acceptance Checks

- Pending file mutation visibly replaces the bottom input body with approval controls.
- Approval is not rendered as a modal.
- Approval is not rendered as a dock above the composer.
- Approval is not rendered as a normal assistant message card.
- Process timeline only shows waiting status and does not duplicate the action buttons.
- Composer still exposes model/mode/skill/reference controls.
- User can queue a new message while approval is pending.
- Applying/rejecting immediately clears the approval composer or advances to the next pending approval.
