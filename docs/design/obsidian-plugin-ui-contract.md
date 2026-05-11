# FRIDAY Obsidian Plugin UI Contract

Status: draft

Scope: FRIDAY surfaces that run inside Obsidian: settings, side panes, modals,
status rows, project tools, Studio controls, assistant UI, onboarding, and
official content management.

Source of truth: `DESIGN.md` defines the product and brand system. This document
defines the executable UI contract for plugin implementation.

## Core Rule

FRIDAY should look like a native Obsidian feature with a clear product identity,
not like a separate app embedded inside Obsidian.

Default to Obsidian-native UI. Add FRIDAY brand expression only where identity
helps the user understand context: entry points, assistant identity, onboarding,
empty states, Studio, official content, release surfaces, and documentation.

## Design Modes

Use these modes before choosing layout, CSS, color, or icon treatment.

### Obsidian-Native Mode

Use for everyday plugin work:

- Settings pages.
- Forms, toggles, dropdowns, text inputs, and command controls.
- Lists, tables, status rows, filters, and compact toolbars.
- Project management panels and sync/status details.
- Modal confirmation flows and error recovery.

Rules:

- Use Obsidian CSS variables for color, borders, typography, radius, and state.
- Prefer Obsidian `Setting` rows and native controls before custom controls.
- Keep density compact and scannable.
- Let user content and Obsidian theme choices dominate the visual field.

### FRIDAY-Branded Mode

Use selectively:

- First-run or onboarding surfaces.
- Empty states that introduce FRIDAY concepts.
- Assistant identity and speaker markers.
- Studio and official content headers.
- About, release notes, export previews, screenshots, and documentation.

Rules:

- Use FRIDAY identity as a small signal, not a skin.
- Prefer a compact wordmark or monochrome Double Shell mark.
- Use Muted Teal only as a small accent.
- Keep controls inside branded surfaces Obsidian-native.

### Standalone-Future Mode

Use only for future non-plugin surfaces: standalone app, website, launch assets,
brand documentation, and merchandise. Do not import standalone visual language
into normal plugin UI.

## Theme Adaptation

Every plugin UI surface must survive light theme, dark theme, and third-party
themes.

Use:

- `var(--background-primary)` for normal page backgrounds.
- `var(--background-primary-alt)` for grouped settings panels.
- `var(--background-secondary)` and `var(--background-secondary-alt)` for
  nested or list surfaces.
- `var(--text-normal)`, `var(--text-muted)`, and `var(--text-faint)` for text.
- `var(--background-modifier-border)` for borders.
- `var(--interactive-accent)` for selected or primary interactive state.
- `var(--color-red)`, `var(--color-orange)`, `var(--color-yellow)`,
  `var(--color-green)`, and `var(--color-cyan)` for semantic markers when
  available.
- `color-mix()` with Obsidian variables for subtle active, hover, focus, and
  accent states.

Avoid:

- Hard-coded body text, panel, or border colors.
- Large plugin backgrounds using FRIDAY Graphite, Warm Bone, Stone, or Muted
  Teal.
- Gradients, glow, glassmorphism, decorative shadows, bokeh, or AI-themed light
  effects.
- Styling that assumes Obsidian default theme contrast.

If a brand color is needed in plugin UI, mix it with a theme variable or keep it
to a small local accent.

## Settings Page Contract

Settings are the strictest native surface. Users should feel that FRIDAY settings
belong in the Obsidian Settings modal.

### Page Structure

Use this hierarchy:

1. Page title: `FRIDAY` may use the wordmark treatment once.
2. Section navigation: compact segmented/tab-like buttons.
3. Settings groups: one topic per group.
4. Native `Setting` rows: one decision per row.
5. Inline status, help text, or prerequisites inside the relevant row.
6. Destructive or irreversible actions at the end of a group or section.

### Settings Title

Allowed:

- One small `FRIDAY` wordmark in the title.
- Normal Obsidian heading size.
- Text wrapping without layout shift.

Avoid:

- Full logo blocks.
- Large marketing headings.
- Decorative brand backgrounds.
- Wordmark tracking on ordinary labels.

### Section Navigation

Navigation should behave like compact Obsidian controls:

- Height: roughly 32-36 px.
- Radius: 6-8 px.
- Gap: 4-8 px.
- Active state: use `var(--interactive-accent)` through `color-mix()`.
- Text: sentence case or natural Chinese labels, no all-caps except `FRIDAY`.

Do not use large pill navigation, oversized cards, or icon-only tabs unless the
destination is already obvious and tooltips are present.

### Settings Groups

Use the shared settings group pattern for grouped sections.

Recommended structure:

```ts
const group = this.createNativeSettingsGroup(containerEl, {
  title: this.t("settings.example.title", "Example"),
  description: this.t("settings.example.desc", "Explain the group in one short sentence."),
});

new Setting(group)
  .setName(this.t("settings.example.name", "Setting name"))
  .setDesc(this.t("settings.example.desc", "What this changes."))
  .addToggle((toggle) => {
    // ...
  });
```

Group rules:

- One group should contain one coherent topic.
- Header title is optional when the rows are self-explanatory.
- Use a group description only when it reduces repeated row descriptions.
- Row padding should align across all settings sections.
- Avoid nesting groups inside groups.
- Avoid card-like decoration for normal settings.

### Setting Rows

Each row should follow the same information order:

- Name: what the setting controls.
- Description: what changes or what the user should know.
- Control: toggle, dropdown, text input, button, or compact button group.
- Status detail: only when the row needs runtime feedback.

Row rules:

- Prefer one primary control per row.
- Use native toggles for binary choices.
- Use dropdowns for mutually exclusive options.
- Use text inputs for paths, tokens, names, URLs, and numeric values.
- Use buttons for actions, not persistent state.
- Use CTA styling only for the next required action or clearly primary action.
- Use destructive styling and confirmation for destructive actions.

### Status and Prerequisites

Use inline status text near the control it explains. Keep it compact:

- Ready or successful: normal text or muted detail; do not over-celebrate.
- Pending: muted text with explicit missing item.
- Warning: Obsidian warning color or native warning text.
- Error: Obsidian error color and a clear recovery action.
- Loading: disable the action and show a short status label.

Do not create separate alert cards for every minor state. Use a group-level
notice only when the entire group is blocked.

### Dangerous Actions

Dangerous actions include deleting project data, archiving official content,
rewriting files, resetting configuration, and changing sync credentials.

Rules:

- Put dangerous actions at the end of a group or section.
- Explain what will happen in plain language.
- Require an explicit confirmation step for irreversible actions.
- Use Obsidian-native destructive styling where possible.
- Never place a dangerous action next to an unrelated primary action.

## Component Recipes

### Native Settings Group

Use for settings sections and compact configuration panels.

Use when:

- The surface is inside Obsidian Settings.
- The content is a list of controls.
- The user is configuring persistent behavior.

Avoid when:

- The content is a repeated list item.
- The surface is an onboarding, empty state, or authored Studio page.
- The content needs table-like density.

### Compact Toolbar

Use for filters, project selectors, refresh actions, and view controls.

Rules:

- Align items horizontally with wrapping.
- Keep icon buttons square or near-square.
- Use Lucide/Obsidian icons for common actions.
- Keep labels short; use tooltips for icon-only actions.
- Do not use custom FRIDAY icons for generic actions.

### Project Card

Use only for repeated project items where scanning matters.

Rules:

- Surface uses Obsidian background and border variables.
- Active state uses `interactive-accent` through `color-mix()`.
- Keep metadata compact and muted.
- Place actions at the bottom or trailing edge.
- Avoid image-like decoration unless the project has real visual content.

### Empty State

Empty states are valid FRIDAY-branded moments.

Rules:

- Use a small Double Shell mark or compact wordmark.
- Explain what is missing and give the next action.
- Use one primary action.
- Keep the tone useful, not promotional.
- Do not use a hero layout inside plugin panes.

### Assistant Identity

Use FRIDAY identity to distinguish assistant-generated content from user content.

Rules:

- Avatar size: roughly 22-28 px.
- Shape: rounded square.
- Mark: monochrome Double Shell or compact FRIDAY concept icon.
- Color: follow current text color, with optional small Muted Teal accent.
- Do not use robot, human, mascot, or generic AI symbols.

### Inline Alert

Use for local warning, blocked state, or recovery guidance.

Rules:

- Border and background derive from Obsidian variables.
- Keep copy short.
- Include the recovery action when possible.
- Do not use brand color for severity.

### Modal

Modals should use Obsidian structure and density.

Rules:

- Title describes the decision.
- Body explains consequence and context.
- Actions sit in a compact button row.
- Primary action is on the right when following Obsidian convention.
- Destructive confirmation requires explicit wording.

## Visual Tokens

Use this scale unless a native Obsidian component dictates otherwise.

### Spacing

- 2 px: hairline adjustment.
- 4 px: tiny gap, text/icon gap.
- 8 px: compact control gap.
- 12 px: row group gap.
- 16 px: panel padding or major row gap.
- 24 px: section separation.
- 32 px: large section separation.

Avoid spacing outside this scale unless it is required by native Obsidian layout.

### Radius

- 4 px: tiny chips or code-like elements.
- 6 px: compact cards and small controls.
- 8 px: normal buttons, inputs, selectors, nav buttons.
- 10-12 px: grouped panels and empty states.
- 999 px: badges, small counters, and true pill elements only.

Avoid:

- Large rounded rectangles for normal plugin UI.
- Mixed 13/14/16 px radii without a clear component reason.
- Nested rounded panels.

### Typography

Use Obsidian/system typography for plugin UI.

Rules:

- Do not load external fonts for normal plugin UI.
- Do not use WenKai for dense controls, table text, or settings.
- Use `var(--font-monospace)` for code, paths, command names, and tokens.
- Use wordmark letter spacing only for short `FRIDAY` brand marks.
- Keep letter spacing at `0` for normal labels.

### Motion

Use motion only to clarify state.

Allowed:

- Hover, focus, and selected-state transitions: 100-160 ms.
- Panel/content reveal when it prevents abrupt layout changes.
- Loading state changes tied to user action.

Avoid:

- Decorative entrance animation.
- Bouncy motion.
- Long branded transitions.
- Motion that hides latency or blocks interaction.

## CSS Rules

Use class names scoped with `friday-`.

Prefer:

- CSS variables from Obsidian.
- `color-mix()` with Obsidian variables.
- Low specificity selectors.
- Component-specific classes.
- `currentColor` for icons.

Avoid:

- Styling Obsidian internals globally.
- `!important`.
- Deep descendant selectors that depend on private Obsidian DOM.
- Hard-coded colors for surfaces or text.
- Broad selectors like `button`, `input`, `.setting-item`, or `.modal` without a
  `friday-` scope.
- Reusing one class for unrelated visual patterns.

Before adding CSS, check whether an existing recipe already exists:

- `friday-wordmark`
- `friday-nav-button`
- `friday-native-settings-group`
- `friday-card`
- project card/list classes
- empty state classes
- assistant/chat classes

If the new UI needs a new pattern, add the recipe here before or alongside code.

## Copy Rules

Plugin UI copy should be plain, specific, and quiet.

Use:

- `FRIDAY` as product name.
- Natural Chinese labels for Chinese UI.
- Sentence case for English UI.
- Short setting names.
- Descriptions that explain consequence, not marketing value.

Avoid:

- `F.R.I.D.A.Y` except for legacy path compatibility.
- Promotional copy in settings.
- Exclamation-heavy success states.
- Generic AI claims.
- Long paragraph explanations inside controls.

## Accessibility and Interaction

Minimum expectations:

- Controls are reachable by keyboard.
- Focus states remain visible.
- Icon-only controls have accessible labels or tooltips.
- Disabled controls explain why when the reason is not obvious.
- Text does not rely on color alone.
- Contrast depends on Obsidian theme variables, not fixed colors.
- Interactive targets are at least comfortable for pointer use in Obsidian panes.

## Implementation Checklist

Before merging new or changed plugin UI, verify:

- [ ] The surface is assigned to one design mode.
- [ ] Normal UI uses Obsidian variables for backgrounds, text, borders, and state.
- [ ] FRIDAY brand assets appear only at allowed identity moments.
- [ ] Settings use native `Setting` rows or a documented exception.
- [ ] Buttons, toggles, dropdowns, inputs, and icons match native expectations.
- [ ] No large hard-coded brand backgrounds are used in plugin UI.
- [ ] No decorative gradients, glow, glass, or heavy shadows are used.
- [ ] Radius and spacing follow the token scale.
- [ ] Light theme and dark theme both remain readable.
- [ ] Third-party themes are not broken by global selectors.
- [ ] Copy explains the user consequence clearly.
- [ ] Dangerous actions are separated and confirmed.
- [ ] New CSS is scoped with `friday-`.
- [ ] Any new visual pattern is documented in this contract.

## Current Implementation Anchors

Use these existing patterns first:

- `src/ui/obsidian-native/SettingsKit.ts`: first FRIDAY Obsidian Native Kit
  module for reusable settings title, section tabs, and native settings groups.
- `src/settings/FridaySettingTab.ts`: should consume the Native Kit for shared
  settings primitives before adding local UI helpers.
- `styles.css`: `friday-wordmark`, `friday-nav-button`,
  `friday-native-settings-group`, `friday-card`, project list/card styles,
  empty state styles, and assistant/chat styles.
- `DESIGN.md`: brand principles, modes, color usage, logo usage, typography,
  and do/don't rules.

## References

- Obsidian Developer Docs: CSS variables.
- Obsidian Developer Docs: Plugin guidelines.
- Obsidian 1.0 theme migration guide.
- FRIDAY brand assets in `brand/`.
