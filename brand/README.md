# FRIDAY Brand SVG Assets

This folder contains the source SVG logo assets for the FRIDAY Double Shell Frame identity.

## Directory Structure

- `logo/` - source SVG files for the logo, icon, favicon, app tile, and plugin tile.
- `guidelines/` - VI standards, logo asset catalog, and the HTML brand system manual.
- `icon-system/` - FRIDAY-specific icon system explorations, selected sheets, and future source files.
- `visual-manual/originals/` - original merchandise and real-scene mockup images for the visual manual.
- `visual-manual/watermarked/` - PNG exports with the lower-left FRIDAY watermark baked in.
- `exports/` - derived PNG, ICO, ICNS, app-icon, and publishing exports generated from the source assets.

## Core Documents

- `guidelines/LOGO-ASSET-CATALOG.zh-CN.md` - Chinese logo asset catalog.
- `README.zh-CN.md` - Chinese asset usage notes.
- `guidelines/FRIDAY-VI-STANDARDS.zh-CN.md` - Chinese visual identity standards.
- `guidelines/friday-brand-assets-guide.zh-CN.html` - Chinese FRIDAY Brand System Manual organized into design philosophy, VI standards, visual manual, and asset catalog sections.

## Core Files

- `logo/friday-icon.svg` - safe-area icon mark for light backgrounds.
- `logo/friday-icon-reversed.svg` - safe-area icon mark for graphite or dark backgrounds.
- `logo/friday-icon-mono.svg` - one-color icon for constrained UI and system contexts.
- `logo/friday-icon-tight.svg` - tight-crop source icon for controlled layout systems.
- `logo/friday-logo.svg` - primary horizontal lockup for light backgrounds.
- `logo/friday-logo-reversed.svg` - primary horizontal lockup on Graphite.
- `logo/friday-logo-stacked.svg` - stacked lockup for square-ish compositions.
- `logo/friday-favicon.svg` - browser tab icon source.
- `logo/friday-app-tile-rounded.svg` - rounded app tile.
- `logo/friday-plugin-tile-square.svg` - square plugin tile.

## Colors

- Graphite: `#1E1F21`
- Warm Bone: `#F4F1EB`
- Muted Teal: `#4A7F7B`
- Stone: `#D9D5CA`
- Accent: `#E07A5F`

## Geometry

- The mark is built from filled contours, not strokes.
- Frame outside contours use an 8 px corner logic.
- Inner apertures and structural cut-ins use a 6 px corner logic.
- The safe icon viewBox is `-8 -8 128 150`.
- The tight icon viewBox is `0 0 112 134`.

## Usage Notes

- Use `logo/friday-logo.svg` as the default lockup on Warm Bone, white, or pale neutral backgrounds.
- Use `logo/friday-logo-reversed.svg` on Graphite or dark surfaces.
- Use `logo/friday-icon.svg` where the product is already named nearby.
- Use `logo/friday-icon-mono.svg` only where accent color is unavailable or too small to remain legible.
- Inside the Obsidian plugin, use the registered `friday-double-shell` monochrome icon for Ribbon entries, in-page small icons, and FRIDAY assistant avatars.
- Plugin UI should write the brand as `FRIDAY`, not `F.R.I.D.A.Y`; keep `F.R.I.D.A.Y/` only when referring to legacy Vault paths.
- Do not stretch, skew, rotate, recolor, outline, shadow, or redraw the mark.
- Minimum recommended icon size: 16 px.
- Minimum recommended horizontal lockup width: 120 px.
- Clear space should be at least the height of the integrated F middle bar around all sides of the mark.
- Visual manual images should use a lower-left FRIDAY watermark: `logo/friday-logo-reversed.svg` on a translucent Graphite plate, roughly 10%-14% of the image width.
- Keep `visual-manual/originals/` as the original image set. Use `visual-manual/watermarked/` when a standalone watermarked PNG is needed for slides, PDFs, publishing images, or external documents.



