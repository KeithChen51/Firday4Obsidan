---
name: FRIDAY for Obsidian
version: 0.1.0
status: draft
scope: obsidian-plugin
brand_assets: ./brand
principle: "Native to Obsidian first; branded only at identity moments."
modes:
  obsidian_native:
    priority: default
    description: "Use Obsidian variables, density, typography, and interaction patterns for normal plugin UI."
  friday_branded:
    priority: selective
    description: "Use FRIDAY identity assets for entry points, assistant identity, onboarding, Studio, official content, release material, and brand documentation."
  standalone_future:
    priority: reference
    description: "Use the full FRIDAY brand system for future standalone app, website, launch assets, and merch."
colors:
  brand:
    graphite: "#1E1F21"
    warm_bone: "#F4F1EB"
    muted_teal: "#4A7F7B"
    stone: "#D9D5CA"
    accent: "#E07A5F"
  obsidian:
    background_primary: "var(--background-primary)"
    background_primary_alt: "var(--background-primary-alt)"
    background_secondary: "var(--background-secondary)"
    text_normal: "var(--text-normal)"
    text_muted: "var(--text-muted)"
    text_faint: "var(--text-faint)"
    border: "var(--background-modifier-border)"
    interactive_accent: "var(--interactive-accent)"
typography:
  wordmark:
    family: '"Avenir Next", Inter, "Segoe UI", Arial, sans-serif'
    weight: 600
    letter_spacing: "0.16em"
    transform: uppercase
  plugin_ui:
    family: 'MiSans, "HarmonyOS Sans SC", "Source Han Sans SC", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif'
  brand_chinese:
    family: '"LXGW WenKai Screen", "LXGW WenKai", "Source Han Serif SC", "Noto Serif CJK SC", serif'
spacing:
  xs: 4
  sm: 8
  md: 12
  lg: 16
  xl: 24
  xxl: 32
radii:
  ui_control: 8
  ui_panel: 12
  logo_outer_logic: 8
  logo_inner_logic: 6
assets:
  logo_dir: ./brand/logo
  guidelines_dir: ./brand/guidelines
  visual_manual_dir: ./brand/visual-manual
  icon_system_dir: ./brand/icon-system
---

# FRIDAY for Obsidian Design Guidelines

FRIDAY is currently shipped as an Obsidian plugin. The product should feel native to Obsidian before it feels like a separate branded application. The complete FRIDAY identity in `brand/` is the long-term source for the independent app, website, release material, visual manual, and merch. This file is the execution layer for the current Obsidian plugin.

The operating rule is simple: use Obsidian's design system for everyday work surfaces, and use FRIDAY branding only at clear identity moments.

Implementation details for plugin UI are defined in `docs/design/obsidian-plugin-ui-contract.md`. Read that contract before changing settings pages, side panes, modals, empty states, assistant UI, Studio controls, or any shared CSS pattern.

## Overview

FRIDAY is a local AI work partner centered on Obsidian. It should reduce context friction without asking users to adopt a visually foreign workspace. In plugin UI, FRIDAY should behave like a well-made Obsidian-native feature: compact, theme-aware, quiet, and predictable.

The full FRIDAY brand system is still important. It defines the logo, wordmark, color philosophy, visual manual, and future standalone direction. But those assets should not be applied as a skin across every plugin surface. Over-branding inside Obsidian would conflict with the product philosophy of low intrusion.

Use three design modes:

- **Obsidian-native mode**: default for settings, forms, lists, panels, command flows, daily board, project tools, status rows, and most plugin controls.
- **FRIDAY-branded mode**: selective use for plugin entry, FRIDAY assistant identity, onboarding, empty states, Studio, official content, release assets, docs, and brand pages.
- **Standalone-future mode**: reference only for the future independent app, website, app store material, and physical collateral.

## Colors

For plugin UI, prefer Obsidian CSS variables:

- Backgrounds: `var(--background-primary)`, `var(--background-primary-alt)`, `var(--background-secondary)`.
- Text: `var(--text-normal)`, `var(--text-muted)`, `var(--text-faint)`.
- Borders: `var(--background-modifier-border)`.
- Actions and highlights: `var(--interactive-accent)`.

Use FRIDAY brand colors sparingly in the plugin:

- `Graphite #1E1F21`: logo and external brand surfaces. Do not force it over Obsidian theme text in normal UI.
- `Warm Bone #F4F1EB`: brand documentation, visual manual, release graphics, and future standalone surfaces. Avoid using it as a large plugin background unless the surface is clearly branded.
- `Muted Teal #4A7F7B`: small identity accents, assistant markers, selected brand moments, and visual manual material.
- `Stone #D9D5CA`: brand-document separators and neutral support surfaces.
- `Accent #E07A5F`: rare warnings or important signals in brand collateral. In plugin UI, prefer Obsidian's existing warning/error variables.

Plugin text should not use full brand Graphite as a hard-coded body color. Let the active Obsidian theme determine contrast.

## Typography

Normal plugin UI should use Obsidian-compatible system typography and the existing FRIDAY UI font stack:

```ts
MiSans, "HarmonyOS Sans SC", "Source Han Sans SC", "Noto Sans CJK SC",
"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif
```

Use the FRIDAY wordmark stack only for explicit brand names in compact identity positions:

```ts
"Avenir Next", Inter, "Segoe UI", Arial, sans-serif
```

Wordmark rules:

- Write the product name as `FRIDAY`, not `F.R.I.D.A.Y`, in UI labels and documentation.
- Use letter spacing around `0.16em` only for short wordmark instances.
- Do not apply wordmark tracking to normal labels, buttons, menu items, or paragraphs.
- Keep `F.R.I.D.A.Y/` only when referring to legacy vault paths or migration compatibility.

Chinese brand writing may use `LXGW WenKai Screen` / `LXGW WenKai` in brand manuals, editorial pages, release visuals, and future standalone marketing surfaces. Do not use WenKai as the default small-size plugin UI font; it is less suitable for dense settings, tables, and controls.

## Layout

Plugin layouts should follow Obsidian density and behavior:

- Prefer compact panels over landing-page composition.
- Keep repeated controls aligned to Obsidian settings and sidebar conventions.
- Use 4 / 8 / 12 / 16 / 24 / 32 px spacing steps.
- Avoid large decorative hero sections inside the plugin.
- Avoid floating card stacks unless the content is a real repeated item, modal, or framed tool.

Use branded layout only when the user is in a brand-aware context:

- onboarding or first-run entry
- empty states explaining FRIDAY
- Studio or official content pages
- assistant identity surfaces
- docs, release, or export previews

## Elevation & Depth

Obsidian-native surfaces should be mostly flat:

- Use theme borders and background layers instead of heavy shadows.
- If depth is needed, use very light inset or border contrast.
- Do not add glassmorphism, glow, bokeh, gradient orbs, or strong AI light effects.

FRIDAY brand imagery may use quiet depth in visual manual mockups and external release assets, but that should not leak into normal plugin controls.

## Shapes

UI shapes should preserve Obsidian's native feel:

- Controls: usually 6-8 px radius.
- Plugin panels or grouped tool surfaces: up to 12 px radius when already consistent with the surrounding UI.
- Cards: use only for repeated items, modals, or framed tools. Do not put cards inside cards.

Logo geometry is separate from UI geometry:

- Double Shell Frame outer logic: 8 px.
- Inner aperture and structural cut-ins: 6 px.
- Do not redraw the integrated F as a separate letter.

## Components

### Buttons and Controls

Use Obsidian-native button styling unless the control is part of a branded onboarding or release surface. Icon buttons should use familiar symbols from Obsidian/Lucide where available. Do not replace common UI icons with bespoke FRIDAY brand icons just for decoration.

### Settings

Settings should feel like Obsidian settings:

- Use native section hierarchy, labels, descriptions, toggles, dropdowns, and text inputs.
- Use `FRIDAY` wordmark only in the page title or small brand header.
- Avoid brand backgrounds, large logo blocks, and marketing copy.

### Sidebar / Ribbon

Use the registered `friday-double-shell` monochrome icon. It should follow `currentColor` and Obsidian theme states. Do not use the full-color logo in the Ribbon.

### Assistant Avatar

Use a compact rounded-square avatar containing the monochrome Double Shell mark. Recommended size is 22-28 px. Do not use robot heads, human faces, or the full wordmark in chat avatars.

### Empty States and Onboarding

These are valid FRIDAY-branded moments. Use the full icon, wordmark, Muted Teal accent, and concise product copy. Still keep the layout quiet and useful. Do not turn onboarding into a marketing landing page.

### Studio and Official Content

Studio may carry more FRIDAY identity than normal settings or lists because it represents authored material and workflows. Use brand accent, iconography, and editorial typography with restraint. Controls inside Studio should still behave like Obsidian-native controls.

## Iconography

Use a two-tier icon strategy:

- **Obsidian/Lucide icons** for generic UI actions: search, close, settings, copy, download, expand, collapse, add, delete, filter, sort, external link.
- **FRIDAY-specific icons** for product concepts: App, Chat, Knowledge, Memory, Context, Sync, Tasks, Calendar, Local, Settings, Studio, and future core concepts.

FRIDAY-specific icons should follow the selected icon-system direction:

- rounded square tile for brand/system previews
- graphite strokes
- Muted Teal as a small functional accent
- sturdy, quiet, legible geometry
- no neon, sci-fi, robot, or generic AI symbolism

Inside the Obsidian plugin, use the bespoke icon system only when it improves recognition of FRIDAY concepts. Do not replace native action icons with branded icons.

## Logo Usage

Use files from `brand/logo/`:

- `friday-icon.svg`: light-background brand icon with safe area.
- `friday-icon-reversed.svg`: dark-background brand icon.
- `friday-icon-mono.svg`: constrained or very small one-color contexts.
- `friday-logo.svg`: default horizontal lockup for light external surfaces.
- `friday-logo-reversed.svg`: horizontal lockup on Graphite or dark surfaces.
- `friday-favicon.svg`: browser tab and tiny export source.
- `friday-app-tile-rounded.svg`: future standalone app icon source.
- `friday-plugin-tile-square.svg`: plugin market, repository cover, or square publication tile.

Within the plugin, use full logo assets only for:

- about or welcome pages
- branded onboarding
- release notes or official content pages
- assistant identity when there is enough room
- exported screenshots or documentation

Do not place the full wordmark in every panel header.

## Do's and Don'ts

Do:

- Make the plugin feel like it belongs inside Obsidian.
- Use Obsidian CSS variables for normal UI.
- Use `FRIDAY` consistently as the product name.
- Reserve brand color and logo moments for identity, onboarding, assistant presence, Studio, and documentation.
- Keep interactions predictable, compact, and keyboard-friendly.
- Let user content remain visually dominant.

Do not:

- Re-skin Obsidian with Warm Bone, Graphite, or Muted Teal across every surface.
- Use AI glow, purple-blue gradients, glass effects, decorative orbs, robot symbols, or aggressive futurism.
- Use full-color brand icons in the Ribbon or dense native UI.
- Apply wordmark letter spacing to normal labels.
- Use WenKai for dense plugin controls or small table text.
- Treat the future standalone brand system as the current plugin UI system.
- Use `F.R.I.D.A.Y` as a visible UI brand spelling, except for legacy path references.

## References

- Plugin UI execution contract: `docs/design/obsidian-plugin-ui-contract.md`
- Full brand asset package: `brand/`
- Logo SVG sources: `brand/logo/`
- Visual identity standards: `brand/guidelines/FRIDAY-VI-STANDARDS.zh-CN.md`
- HTML brand system manual: `brand/guidelines/friday-brand-assets-guide.zh-CN.html`
- Logo asset catalog: `brand/guidelines/LOGO-ASSET-CATALOG.zh-CN.md`
