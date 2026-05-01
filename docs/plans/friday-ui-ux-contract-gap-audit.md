# FRIDAY UI/UX contract gap audit

Report date: 2026-05-01

Scope: report-only review of the current working tree against `DESIGN.md` and `docs/design/obsidian-plugin-ui-contract.md`. No implementation files were changed. Release artifacts were not inspected as sources of truth.

Git status note: the working tree was already dirty before this audit, including modified `DESIGN.md`, `styles.css`, `src/views/DailyBoardView.ts`, many core/service files, and untracked `docs/design/` plus agent-kernel/task files. This report audits the working copy as-is and does not assume those changes are mine.

## 1. Executive Summary

Overall consistency score: **6.5 / 10**

FRIDAY already has a solid native foundation: most settings are built with Obsidian `Setting`, shared CSS is mostly scoped with `friday-`, colors generally use Obsidian variables, and the assistant avatar uses the intended monochrome Double Shell mark. The largest gaps are not basic theming failures; they are interaction semantics, destructive action safety, and assistant/session UI drifting into heavier custom styling than the contract allows.

Most serious issues:

- Several destructive actions delete project registration, Souls, slash commands, or chat sessions without an explicit confirmation step.
- Core clickable surfaces use custom `div` semantics or nested interactive controls, creating keyboard and screen-reader risk.
- The assistant composer is visually functional but lacks a clear accessible label/role, and mention token removal is removed from the tab order.
- Session drawer styling uses gradients, shadows, transforms, and 14 px radii, which conflicts with the flat Obsidian-native contract.
- High-risk Agent runtime controls use emoji labels and ordinary toggles/dropdowns instead of a clearer danger/prerequisite pattern.

Recommended priority:

1. **First**: fix destructive actions and core keyboard/screen-reader gaps.
2. **Second**: normalize assistant/session/project card CSS to flat Obsidian-native recipes.
3. **Third**: polish copy, brand placement, empty states, and minor CSS specificity issues.

## 2. Findings

### FRI-UX-001

- **Severity:** P1
- **Area:** Settings / A11y
- **Location:** `src/settings/FridaySettingTab.ts:1280`, `src/settings/FridaySettingTab.ts:1792`, `src/settings/FridaySettingTab.ts:2014`
- **Current:** Soul deletion, slash command deletion, and project removal are exposed as warning buttons, but the click handler executes immediately. Project group deletion has a two-click inline guard, and legacy root cleanup/archive has stronger confirmation, so the behavior is inconsistent.
- **Expected:** The contract says destructive actions must be separated, explained in plain language, and require an explicit confirmation step.
- **Impact:** Users can permanently remove configuration or project registration through a single accidental click. The inconsistency also makes it hard to predict which dangerous buttons are actually guarded.
- **Recommendation:** Standardize a `friday-danger-setting` pattern: warning row at the end of the group, concise consequence text, and either a second inline confirmation state or Obsidian-native confirmation modal before mutation.
- **Fix size:** medium

### FRI-UX-002

- **Severity:** P1
- **Area:** Assistant / A11y
- **Location:** `src/views/DailyBoardView.ts:2139`, `src/views/DailyBoardView.ts:2435`, `src/views/DailyBoardView.ts:2458`, `src/views/DailyBoardView.ts:2557`
- **Current:** Session menu delete and bulk "删除所选" call `deleteSingleSession` / `deleteSelectedSessions` immediately. No confirmation copy explains whether chat history is recoverable.
- **Expected:** Deleting stored conversation history is destructive and should use explicit confirmation with clear consequences.
- **Impact:** A user can erase one or many conversation records accidentally from the side drawer, especially because menu actions are compact and bulk delete is adjacent to selection controls.
- **Recommendation:** Add confirmation for single and bulk deletion. For bulk, show selected count and whether the active session will be cleared. Keep the final destructive action visually separated.
- **Fix size:** medium

### FRI-UX-003

- **Severity:** P1
- **Area:** Component / A11y
- **Location:** `src/views/DailyBoardView.ts:837`, `src/views/DailyBoardView.ts:842`, `src/views/DailyBoardView.ts:880`
- **Current:** A project card is a clickable `div` with `card.onclick`, but it has no `role`, no `tabIndex`, and no keyboard handler. It also contains child buttons, making the interaction model ambiguous.
- **Expected:** Interactive project cards should either be native buttons/links or have complete keyboard semantics, while nested actions should not conflict with the container action.
- **Impact:** Keyboard users cannot activate the card-level selection affordance, and pointer users can accidentally switch projects while aiming for card controls.
- **Recommendation:** Make only a dedicated header/body button switch projects, or convert the card to a non-interactive container with explicit trailing actions.
- **Fix size:** medium

### FRI-UX-004

- **Severity:** P1
- **Area:** Assistant / A11y
- **Location:** `src/views/components/MentionComposer.ts:52`, `src/views/components/MentionComposer.ts:55`, `src/core/editor/mention/MentionComposerDocument.ts:45`, `src/core/editor/mention/MentionComposerDocument.ts:50`
- **Current:** The ProseMirror composer wrapper only gets a visual `data-placeholder`; no accessible label or multiline textbox semantics are assigned. Mention token remove buttons have an `aria-label`, but `tabindex="-1"` removes them from normal keyboard navigation.
- **Expected:** Core text input must have an accessible label and keyboard-reachable controls. Icon/symbol removal actions need labels and reachable focus.
- **Impact:** Screen-reader users may not understand the assistant input purpose, and keyboard-only users cannot directly focus a mention token's remove button.
- **Recommendation:** Add `aria-label`/`aria-describedby` to the editor host or ProseMirror DOM, mark it as multiline when appropriate, and make token removal keyboard reachable or document a reliable roving-token keyboard model.
- **Fix size:** medium

### FRI-UX-005

- **Severity:** P2
- **Area:** Settings / A11y
- **Location:** `src/settings/FridaySettingTab.ts:196`, `src/settings/FridaySettingTab.ts:207`
- **Current:** Settings section navigation uses buttons with an active CSS class only. There is no `aria-current`, `aria-pressed`, or tablist/tabpanel relationship.
- **Expected:** Section navigation should behave like compact Obsidian controls and expose selected state to assistive technology.
- **Impact:** Visual users can see the active section, but screen-reader users do not get an equivalent selected-state announcement.
- **Recommendation:** Add `type="button"` and `aria-current="page"` or `aria-pressed` to active buttons. If treating the control as tabs, add `role="tablist"`, `role="tab"`, `aria-selected`, and labelled panels consistently.
- **Fix size:** small

### FRI-UX-006

- **Severity:** P2
- **Area:** Assistant / A11y
- **Location:** `src/views/DailyBoardView.ts:2157`, `src/views/DailyBoardView.ts:2158`, `src/views/DailyBoardView.ts:2208`, `src/views/DailyBoardView.ts:2228`
- **Current:** Each session item is a `div` with `role="button"` and `tabIndex=0`, but it can contain a checkbox and a menu button. The checkbox has no label or `aria-label`.
- **Expected:** Native controls should keep clear semantics; nested interactive controls inside a button-like container should be avoided.
- **Impact:** Assistive technology can interpret the row as one button while also encountering nested controls, which makes selection, opening, and menu actions harder to predict.
- **Recommendation:** Use a list item container, then separate child controls: a real checkbox with `aria-label="选择对话: {title}"`, a body button for opening, and a menu button for actions.
- **Fix size:** medium

### FRI-UX-007

- **Severity:** P2
- **Area:** Theme / CSS
- **Location:** `styles.css:2743`, `styles.css:2752`, `styles.css:2758`, `styles.css:2781`, `styles.css:2813`
- **Current:** Session list items use layered gradients, raised shadows, hover transform, 14 px radius, and active gradient states.
- **Expected:** The contract says normal side panes and lists should remain flat, Obsidian-native, and avoid gradients, glow, decorative shadows, and large rounded rectangles.
- **Impact:** The session drawer feels more like a custom web app surface than an Obsidian pane, and the visual language diverges from project cards/settings groups.
- **Recommendation:** Replace gradients with `var(--background-secondary)` / `color-mix()` active fills, remove raised shadows and transform, and use 8-10 px radius for list items.
- **Fix size:** medium

### FRI-UX-008

- **Severity:** P2
- **Area:** Component / CSS
- **Location:** `styles.css:398`, `styles.css:439`, `styles.css:487`, `styles.css:552`, `styles.css:2018`, `styles.css:2751`
- **Current:** Similar controls and cards use mixed radii: 14 px for project group inputs/items/cards/session items, 12 px for project buttons, 10 px for empty/chat panels, 9 px for composer buttons, and 16 px for message bubbles.
- **Expected:** Contract radius scale is 6-8 px for controls, 10-12 px for grouped panels/empty states, and it explicitly avoids mixed 13/14/16 px radii without component justification.
- **Impact:** Shared surfaces no longer feel like one system. Maintenance also becomes harder because each new component has to guess which radius is canonical.
- **Recommendation:** Define a small token set in CSS comments or variables: control 8 px, list/card 10 px, panel 12 px, pill 999 px. Normalize the outliers.
- **Fix size:** medium

### FRI-UX-009

- **Severity:** P2
- **Area:** Theme / CSS
- **Location:** `styles.css:1303`, `styles.css:2021`, `styles.css:3083`
- **Current:** The mention dropdown uses `rgba(0, 0, 0, 0.25)`, and message/popover shadows derive from background variables in ways that can invert poorly across themes.
- **Expected:** Theme adaptation should avoid hard-coded shadow colors and decorative shadows. If depth is necessary, it should be subtle and based on Obsidian tokens.
- **Impact:** Third-party themes can show shadows that are too heavy, too low contrast, or visually inconsistent with Obsidian popovers.
- **Recommendation:** Replace the hard-coded rgba shadow with `var(--background-modifier-box-shadow)` if available, or a very subtle tokenized `color-mix()` based on border/accent. Remove nonessential message shadows.
- **Fix size:** small

### FRI-UX-010

- **Severity:** P2
- **Area:** Branding
- **Location:** `src/views/DailyBoardView.ts:393`, `src/views/DailyBoardView.ts:399`, `src/views/DailyBoardView.ts:403`
- **Current:** The everyday side-pane shell header always shows the Double Shell mark plus a wordmarked `FRIDAY`.
- **Expected:** The contract allows assistant identity and entry points to carry FRIDAY identity, but warns against placing the full wordmark in every panel header or reskinning normal plugin work surfaces.
- **Impact:** The workbench header competes with the active project and page controls, making the pane feel more branded than native.
- **Recommendation:** Keep the small mark or title in assistant-specific contexts, but drop the persistent wordmark from the normal shell header. Let the project selector and Obsidian view title carry the work context.
- **Fix size:** small

### FRI-UX-011

- **Severity:** P2
- **Area:** Empty state / UX
- **Location:** `src/views/DailyBoardView.ts:2678`, `src/views/DailyBoardView.ts:2679`, `src/views/DailyBoardView.ts:2680`
- **Current:** The assistant empty state renders only title and description.
- **Expected:** Empty states should explain what is missing and provide one next action. They may use a small Double Shell mark or compact wordmark as a useful FRIDAY-branded moment.
- **Impact:** First-use chat state does not guide the user toward the next likely action, such as attaching context, choosing a Skill, or asking the first question.
- **Recommendation:** Add one compact primary action appropriate to current readiness, such as "添加上下文" or "查看示例 Skill", and optionally a small monochrome identity mark.
- **Fix size:** small

### FRI-UX-012

- **Severity:** P2
- **Area:** Settings / Copy / A11y
- **Location:** `src/settings/FridaySettingTab.ts:1428`, `src/settings/FridaySettingTab.ts:1434`, `src/settings/FridaySettingTab.ts:1468`, `src/views/DailyBoardView.ts:1405`, `src/views/DailyBoardView.ts:4164`
- **Current:** High-risk Agent runtime controls are ordinary dropdowns/toggles: permission mode labels include emoji, file mutation mode exposes internal values (`review`, `autoApproved`), and `enableExec` uses a warning emoji in the description but no confirmation or prerequisite state.
- **Expected:** Dangerous capabilities should be clear, quiet, explicit, and confirmed when enabling irreversible or high-risk behavior. Copy should explain consequence, not implementation terms.
- **Impact:** Users may enable shell execution or auto-approved mutation without understanding practical risk. Emoji labels also reduce native density and are inconsistent with Obsidian setting copy.
- **Recommendation:** Separate high-risk runtime controls into a danger group, remove emoji from option labels, use plain labels with consequence-focused descriptions, and require confirmation when enabling exec or auto-apply behavior.
- **Fix size:** medium

### FRI-UX-013

- **Severity:** P2
- **Area:** Onboarding / A11y
- **Location:** `src/views/DailyBoardView.ts:359`, `src/views/DailyBoardView.ts:360`, `src/views/DailyBoardView.ts:361`
- **Current:** Onboarding step completion is represented by a check/circle icon and `.is-complete` class, without text or ARIA state.
- **Expected:** Text should not rely on color or icon alone. Completion state should be perceivable to assistive technology.
- **Impact:** Screen-reader users may not know which onboarding steps are complete.
- **Recommendation:** Add hidden or visible status text such as "已完成" / "未完成", or set an `aria-label` on the marker/row that includes completion state.
- **Fix size:** small

### FRI-UX-014

- **Severity:** P3
- **Area:** CSS
- **Location:** `styles.css:362`, `styles.css:623`, `styles.css:629`
- **Current:** Scoped component text alignment uses `!important`.
- **Expected:** The contract says to avoid `!important` and keep specificity low.
- **Impact:** These rules are not breaking users today, but they create a precedent for fighting Obsidian/theme CSS instead of designing a lower-specificity recipe.
- **Recommendation:** Remove `!important` by adjusting selector context or component structure so text alignment wins naturally.
- **Fix size:** small

## 3. Systemic Patterns

- **Dangerous actions are handled case-by-case.** Some flows have two-step confirmation, while others delete immediately. The product needs one shared destructive action recipe.
- **Custom clickable containers are doing native control work.** Project cards and session rows use `div` plus handlers where native buttons, listbox patterns, or separated child controls would be more robust.
- **Assistant/session UI has become its own visual system.** It uses more gradients, shadows, radius variation, and bespoke controls than settings/project surfaces.
- **A11y is strongest on icon buttons and weakest on composite controls.** Many icon buttons have labels, but composer, session list, checkboxes, and onboarding state need semantic work.
- **CSS is scoped well but not fully normalized.** Most selectors are `friday-` scoped, but repeated radius/button/card patterns have drifted.

## 4. Positive Patterns

- `src/settings/FridaySettingTab.ts:170` uses the wordmark only once in the settings title, matching the contract.
- `src/settings/FridaySettingTab.ts:218` provides `createNativeSettingsGroup`, and most settings are built with Obsidian `Setting` rows.
- `styles.css:238` keeps settings groups flat, tokenized, and scoped.
- `src/constants/icon.ts:5` uses `currentColor` for the Double Shell icon, which is correct for theme adaptation.
- `src/views/DailyBoardView.ts:469` creates reusable icon buttons with `aria-label`.
- `src/views/DailyBoardView.ts:2630` and `styles.css:2039` implement the assistant avatar at 22 px with the monochrome mark, which matches the assistant identity recipe.
- Legacy root archive/cleanup and project group deletion already show that inline confirmation patterns exist and can be reused.

## 5. Suggested Fix Plan

### First batch: quick wins

- Add confirmation to Soul delete, slash command delete, project remove, and chat session delete.
- Add selected-state ARIA to settings tabs and top nav buttons.
- Label session management checkboxes and onboarding completion state.
- Replace the hard-coded `rgba(0, 0, 0, 0.25)` shadow in the mention dropdown.
- Remove `!important` text-alignment rules.

### Second batch: component/style unification

- Normalize radii across project cards, session items, assistant bubbles, composer controls, and settings panels.
- Flatten session drawer gradients/shadows into Obsidian-native list item states.
- Split clickable project/session containers into semantic child controls.
- Create shared recipes for destructive setting rows, compact toolbar buttons, list cards, and assistant inline alerts.

### Third batch: changes needing visual verification

- Rework the assistant empty state with one primary action and a small identity marker.
- Reduce the persistent FRIDAY wordmark in the side-pane shell and verify brand presence still feels clear in assistant messages/onboarding.
- Redesign high-risk runtime controls as a danger/prerequisite group and verify wording in both English and Chinese locales.
- Validate light theme, dark theme, and one third-party theme after CSS normalization.
