export type SkillReviewNotePopoverPlacement = "bottom" | "top" | "right" | "left";

export interface SkillReviewNotePopoverAnchor {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface SkillReviewNotePopoverSize {
	width: number;
	height: number;
}

export interface SkillReviewNotePopoverViewport {
	width: number;
	height: number;
}

export interface SkillReviewNotePopoverLayout {
	placement: SkillReviewNotePopoverPlacement;
	left: number;
	top: number;
	width: number;
	maxHeight: number;
}

interface SkillReviewNotePopoverOptions {
	gap?: number;
	padding?: number;
	order?: SkillReviewNotePopoverPlacement[];
}

interface SkillReviewNotePopoverCandidate {
	placement: SkillReviewNotePopoverPlacement;
	width: number;
	maxHeight: number;
	score: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_PADDING = 12;
const DEFAULT_ORDER: SkillReviewNotePopoverPlacement[] = ["bottom", "top", "right", "left"];
const MIN_WIDTH = 280;
const MAX_WIDTH = 520;
const PREFERRED_VERTICAL_WIDTH = 380;
const PREFERRED_HORIZONTAL_WIDTH = 440;
const TARGET_VERTICAL_HEIGHT = 320;
const TARGET_HORIZONTAL_HEIGHT = 360;

function clamp(value: number, min: number, max: number): number {
	if (max <= min) {
		return min;
	}
	return Math.min(Math.max(value, min), max);
}

function resolveWidth(availableWidth: number, preferredWidth: number): number {
	if (availableWidth <= 0) {
		return 0;
	}
	return Math.min(availableWidth, Math.min(MAX_WIDTH, preferredWidth));
}

function buildCandidate(
	placement: SkillReviewNotePopoverPlacement,
	anchor: SkillReviewNotePopoverAnchor,
	viewport: SkillReviewNotePopoverViewport,
	orderIndex: number,
	padding: number,
	gap: number,
): SkillReviewNotePopoverCandidate {
	const right = anchor.left + anchor.width;
	const bottom = anchor.top + anchor.height;
	const fullWidth = Math.max(0, viewport.width - padding * 2);
	const fullHeight = Math.max(0, viewport.height - padding * 2);
	const isHorizontal = placement === "left" || placement === "right";
	const availableWidth = isHorizontal
		? Math.max(0, placement === "right" ? viewport.width - padding - right - gap : anchor.left - padding - gap)
		: fullWidth;
	const availableHeight = isHorizontal
		? fullHeight
		: Math.max(0, placement === "bottom" ? viewport.height - padding - bottom - gap : anchor.top - padding - gap);
	const preferredWidth = isHorizontal ? PREFERRED_HORIZONTAL_WIDTH : PREFERRED_VERTICAL_WIDTH;
	const targetHeight = isHorizontal ? TARGET_HORIZONTAL_HEIGHT : TARGET_VERTICAL_HEIGHT;
	const width = resolveWidth(availableWidth, preferredWidth);
	const maxHeight = Math.max(0, Math.floor(availableHeight));
	const widthRatio = Math.min(width / preferredWidth, 1);
	const heightRatio = Math.min(maxHeight / targetHeight, 1);
	const preferenceBias = (DEFAULT_ORDER.length - orderIndex) * 0.001;

	return {
		placement,
		width,
		maxHeight,
		score: widthRatio + heightRatio + preferenceBias,
	};
}

export function computeSkillReviewNotePopoverPosition(
	anchor: SkillReviewNotePopoverAnchor,
	size: SkillReviewNotePopoverSize,
	viewport: SkillReviewNotePopoverViewport,
	placement: SkillReviewNotePopoverPlacement,
	options: SkillReviewNotePopoverOptions = {},
): Pick<SkillReviewNotePopoverLayout, "left" | "top"> {
	const gap = options.gap ?? DEFAULT_GAP;
	const padding = options.padding ?? DEFAULT_PADDING;
	const right = anchor.left + anchor.width;
	const bottom = anchor.top + anchor.height;
	const centerX = anchor.left + anchor.width / 2;
	const centerY = anchor.top + anchor.height / 2;

	let left = 0;
	let top = 0;
	switch (placement) {
		case "top":
			left = centerX - size.width / 2;
			top = anchor.top - size.height - gap;
			break;
		case "right":
			left = right + gap;
			top = centerY - size.height / 2;
			break;
		case "left":
			left = anchor.left - size.width - gap;
			top = centerY - size.height / 2;
			break;
		case "bottom":
		default:
			left = centerX - size.width / 2;
			top = bottom + gap;
			break;
	}

	return {
		left: clamp(left, padding, viewport.width - padding - size.width),
		top: clamp(top, padding, viewport.height - padding - size.height),
	};
}

export function computeSkillReviewNotePopoverLayout(
	anchor: SkillReviewNotePopoverAnchor,
	viewport: SkillReviewNotePopoverViewport,
	options: SkillReviewNotePopoverOptions = {},
): SkillReviewNotePopoverLayout {
	const gap = options.gap ?? DEFAULT_GAP;
	const padding = options.padding ?? DEFAULT_PADDING;
	const order = options.order && options.order.length > 0 ? options.order : DEFAULT_ORDER;
	const candidates = order.map((placement, index) =>
		buildCandidate(placement, anchor, viewport, index, padding, gap),
	);
	const fallback = candidates[0] ?? buildCandidate("bottom", anchor, viewport, 0, padding, gap);
	const chosen = candidates.reduce((best, candidate) => {
		if (candidate.score > best.score) {
			return candidate;
		}
		return best;
	}, fallback);
	const minWidth = Math.min(MIN_WIDTH, Math.max(0, viewport.width - padding * 2));
	const width = Math.max(Math.floor(chosen.width), Math.floor(minWidth));
	const maxHeight = Math.max(0, Math.floor(chosen.maxHeight));
	const position = computeSkillReviewNotePopoverPosition(
		anchor,
		{
			width,
			height: maxHeight,
		},
		viewport,
		chosen.placement,
		options,
	);

	return {
		placement: chosen.placement,
		left: position.left,
		top: position.top,
		width,
		maxHeight,
	};
}
