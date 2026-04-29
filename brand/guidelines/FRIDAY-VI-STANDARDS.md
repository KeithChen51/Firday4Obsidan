# FRIDAY Visual Identity Standards

## Brand Idea

FRIDAY is a local AI work partner centered on Obsidian. It should feel quiet, reliable, and low-intrusion. The identity does not present AI as a loud command center. It presents AI as a stable working layer that helps users gather context, structure knowledge, reduce friction, and stay in control.

The mark is built around a Double Shell Frame. The rear shell suggests protection, continuity, and background capability. The front shell suggests the organized workspace the user actually touches. The F is not a separate letter placed inside the frame. It is formed by the front frame and its middle structural bar, expressing FRIDAY as a system that turns scattered material into a readable structure.

## Logo System

### Primary Mark

The primary mark is the Double Shell Frame icon with a Muted Teal accent. Use it when FRIDAY is already named in nearby UI, such as sidebars, app headers, plugin lists, tray icons, and document icons.

Source file: `logo/friday-icon.svg`

### Horizontal Lockup

The horizontal lockup combines the icon with a spaced FRIDAY wordmark. Use it for headers, documentation covers, release materials, onboarding screens, and places where brand recognition needs to be explicit.

Source files:

- `logo/friday-logo.svg`
- `logo/friday-logo-reversed.svg`

### Stacked Lockup

The stacked lockup is for square or vertical placements where a horizontal lockup would become too small or too wide.

Source file: `logo/friday-logo-stacked.svg`

### System Tiles

Use tile variants for app icons, plugin cards, operating system surfaces, and exported bitmap icons.

Source files:

- `logo/friday-app-tile-rounded.svg`
- `logo/friday-plugin-tile-square.svg`
- `logo/friday-favicon.svg`

## Geometry

The mark is drawn as filled contours, not strokes. This keeps the logo stable across sizes and avoids stroke rendering differences between browsers, operating systems, and export tools.

The frame uses two corner systems:

- Outside contours: 8 px corner logic.
- Inside apertures and structural cut-ins: 6 px corner logic.

The safe icon uses `viewBox="-8 -8 128 150"` so the mark has export breathing room. The tight icon keeps the raw contour bounds at `viewBox="0 0 112 134"` and should only be used inside controlled layout systems.

## Typography

### English Wordmark

The current FRIDAY wordmark in the SVG lockups uses live SVG text with this font stack:

`Avenir Next, Inter, Segoe UI, Arial, sans-serif`

Current wordmark settings:

- Weight: 600.
- Horizontal lockup size: 44.
- Horizontal lockup letter spacing: 18.
- Stacked lockup size: 34.
- Stacked lockup letter spacing: 14.

Avenir Next is the intended design reference. It is a humanist geometric sans: structured enough to match the Double Shell Frame, but softer than a purely mechanical geometric face. The wide tracking keeps the wordmark quiet and stable instead of loud or promotional.

Because the current SVGs keep the wordmark as text, rendering can fall back to Inter, Segoe UI, or Arial when Avenir Next is unavailable. For final publishing, print, app-store, and high-control brand surfaces, convert the wordmark to outlines to avoid device-specific font drift.

### English UI

Use this stack for English interface and documentation text:

`Avenir Next, Inter, Segoe UI, Arial, sans-serif`

Use 500-650 weights for headings and 400-500 weights for body text. Keep wide tracking for brand lockups and small labels, not for long-running UI copy.

### Chinese Display

Chinese display typography should make FRIDAY feel closer to writing, notes, and long-term knowledge work than to a generic productivity dashboard. The primary Chinese display voice is LXGW WenKai.

Recommended Chinese display stack:

`LXGW WenKai Screen, LXGW WenKai, Source Han Serif SC, Noto Serif CJK SC, STFangsong, FangSong, serif`

Use it for brand headings, documentation covers, VI guide titles, and short emphasis lines. Prefer `LXGW WenKai` for large display and `LXGW WenKai Screen` for screen-sized headings. Serif fonts are fallbacks, not the primary brand voice. Avoid default system Kai fallbacks when possible, because they can make the brand feel overly calligraphic.

### Chinese UI and Body

Chinese typography is split into two layers: brand/editorial writing and product UI.

Recommended Chinese brand/body stack:

`LXGW WenKai Screen, LXGW WenKai, Source Han Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif`

Use this for brand manuals, visual explanations, editorial copy, and long-form product philosophy. Keep body text below full Graphite intensity, usually around 72%-82% ink, so long passages stay calm.

Recommended Chinese UI/body stack:

`MiSans, HarmonyOS Sans SC, Source Han Sans SC, Noto Sans CJK SC, PingFang SC, Microsoft YaHei UI, Microsoft YaHei, sans-serif`

Use this stack for plugin UI, settings, lists, tables, buttons, dense help copy, and any text below 14px. Microsoft YaHei is acceptable as a fallback, but it should not be the first-choice brand display voice.

### Monospace

Use this stack for code, file names, paths, and version numbers:

`SFMono-Regular, Cascadia Mono, Consolas, Liberation Mono, monospace`

## Obsidian Plugin Usage

FRIDAY should appear more quietly inside Obsidian than it does in brand documents or marketing surfaces. The plugin interface is a work surface, so sidebar icons, in-page small icons, and chat avatars should prioritize compact recognition over repeated wordmarks.

### Sidebar and Ribbon Icon

- Use the custom `friday-double-shell` icon, derived from the main Double Shell Frame mark.
- Follow Obsidian Ribbon sizing, with a visual target of 18-20 px.
- Use `currentColor` so the icon follows the active Obsidian theme.
- Do not use the Muted Teal accent square in 16-20 px Ribbon icons; it can read as visual noise at that size.
- Do not replace the mark with generic AI icons such as `cpu`, `bot`, or `sparkles`.

### In-Page Small Icons

- Use the same `friday-double-shell` icon near workspace headers, page titles, status summaries, and settings headers.
- Recommended size: 16-22 px, vertically centered with the text baseline.
- When FRIDAY already appears as a wordmark in the same area, the small icon should act as a recognition anchor rather than repeating a full lockup.
- Keep small icons monochrome. Reserve Muted Teal for selected states, status dots, and system responses.

### Chat Avatar

- FRIDAY assistant messages use a 22-28 px rounded-square avatar containing the monochrome Double Shell icon.
- Recommended avatar corner radius: 6 px, matching the mark's internal corner logic.
- Do not use text, emoji, or generic robot icons for the assistant avatar.
- User avatars should represent the user and should not use the FRIDAY mark.
- In dark themes, use the Obsidian secondary background for the avatar container and keep the icon on `currentColor`.

### Plugin Wordmark

- Product UI should write the brand as `FRIDAY`, not `F.R.I.D.A.Y`.
- Workspace headers, settings titles, and assistant role labels use the English wordmark stack: `Avenir Next, Inter, Segoe UI, Arial, sans-serif`.
- Recommended UI wordmark styling: 600 weight, 0.14-0.18em tracking, uppercase.
- Do not embed or load decorative wordmark fonts in the plugin. Rely on the system font stack to keep the package lighter and rendering more predictable.
- `F.R.I.D.A.Y/` may remain when it refers to legacy Vault paths or migration compatibility. It is not the current UI brand spelling.

## Color Palette

### Core Colors

Graphite `#1E1F21`

Primary mark, wordmark, core headings, and serious UI surfaces. Graphite should replace pure black in almost all brand use. Long body text, card descriptions, table content, and secondary copy should not use 100% Graphite by default; use 70%-88% Graphite opacity or a softened ink close to `#4C4D4B`.

Warm Bone `#F4F1EB`

Primary light background. It keeps the knowledge-work context warm without becoming beige-heavy or decorative.

Muted Teal `#4A7F7B`

Functional accent. Use for the logo accent square, active states, subtle status, selected items, links, and system responses. It should be controlled, not decorative.

Stone `#D9D5CA`

Secondary neutral for rules, dividers, inactive UI, and subdued surfaces.

Accent `#E07A5F`

Use sparingly for warnings, important state changes, or editorial highlights. It is not a primary brand color.

## Logo Color Use

Use Graphite marks on Warm Bone, white, or light neutral backgrounds.

Use Warm Bone marks on Graphite or dark backgrounds.

Keep the Muted Teal accent unchanged in both light and reversed versions unless the mark is rendered in monochrome.

Use the monochrome version only when color is technically unavailable, too small to render clearly, or visually inappropriate.

## Clear Space

Minimum clear space around the mark is equal to the height of the integrated F middle bar. For lockups, apply the same clear space to the full lockup boundary.

Do not place type, icons, borders, or busy imagery inside the clear-space area.

## Minimum Size

Icon-only mark:

- Minimum digital size: 16 px high.
- Preferred UI size: 20 px to 32 px high.
- App tile source: 256 px square or larger.

Horizontal lockup:

- Minimum digital width: 120 px.
- Preferred header width: 160 px or larger.

At very small sizes, prefer `logo/friday-icon-mono.svg` or `logo/friday-favicon.svg`.

## Incorrect Use

Do not:

- Stretch, skew, rotate, or tilt the mark.
- Recreate the F as a separate letter inside the frame.
- Change the Graphite, Warm Bone, or Muted Teal values.
- Add shadows, glow, gradients, glass effects, or AI-style light effects.
- Place the mark on low-contrast or busy image backgrounds.
- Round the mark into a generic app-square shape by clipping the contours.
- Replace Graphite with pure black for the primary mark.
- Set all body copy on light backgrounds in 100% Graphite, creating unnecessarily hard contrast.
- Use cyan, purple, or neon accents as substitutes for Muted Teal.

## Brand Tone

FRIDAY should feel:

- Quiet, not silent.
- Capable, not forceful.
- Local-first, not cloud-dependent.
- Structured, not rigid.
- Helpful, not performative.

The visual system should keep the user's work in the foreground. FRIDAY is the stable entry point, not the main character.

## Asset Index

Use these files as the source set:

- `logo/friday-icon.svg`
- `logo/friday-icon-reversed.svg`
- `logo/friday-icon-mono.svg`
- `logo/friday-icon-tight.svg`
- `logo/friday-logo.svg`
- `logo/friday-logo-reversed.svg`
- `logo/friday-logo-stacked.svg`
- `logo/friday-favicon.svg`
- `logo/friday-app-tile-rounded.svg`
- `logo/friday-plugin-tile-square.svg`



