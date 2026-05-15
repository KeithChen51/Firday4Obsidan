import type { Setting } from "obsidian";

export interface NativeSettingsGroupOptions {
	title?: string;
	description?: string;
	extraClass?: string;
}

export type NativeSettingsTone = "muted" | "success" | "warning" | "danger" | "active";
export type NativePrerequisiteState = "ready" | "pending" | "blocked";

export interface NativeSectionTabItem<TId extends string = string> {
	id: TId;
	label: string;
}

export interface RenderNativeSectionTabsOptions<TId extends string = string> {
	items: NativeSectionTabItem<TId>[];
	activeId: TId;
	onSelect: (id: TId) => void;
}

export interface RenderFridaySettingsTitleOptions {
	titleText: string;
	brandText: string;
	wordmarkFontFamily?: string;
}

export interface RenderNativeSettingStatusOptions {
	text: string;
	tone?: NativeSettingsTone;
	title?: string;
}

export interface RenderNativeSettingsFeedbackOptions {
	title?: string;
	message: string;
	tone?: NativeSettingsTone;
	detail?: string;
	progressPercent?: number;
	progressLabel?: string;
	extraClass?: string;
}

export interface NativePrerequisiteItem {
	label: string;
	state: NativePrerequisiteState;
	stateLabel?: string;
	detail?: string;
	actionLabel?: string;
	onAction?: () => void;
}

export interface RenderNativePrerequisiteListOptions {
	items: NativePrerequisiteItem[];
	ariaLabel?: string;
}

export interface RenderNativeSettingsEmptyStateOptions {
	title: string;
	description: string;
	actionLabel?: string;
	onAction?: () => void;
	showBrandMark?: boolean;
	extraClass?: string;
}

export interface RenderNativeInlineAlertOptions {
	title?: string;
	message: string;
	tone?: Exclude<NativeSettingsTone, "active">;
	actionLabel?: string;
	onAction?: () => void;
	extraClass?: string;
}

function joinClassNames(...items: Array<string | undefined | false>): string {
	return items.filter(Boolean).join(" ");
}

export function createNativeSettingsGroup(
	containerEl: HTMLElement,
	options: NativeSettingsGroupOptions = {},
): HTMLDivElement {
	const group = containerEl.createDiv({
		cls: ["friday-native-settings-group", options.extraClass].filter(Boolean).join(" "),
	});
	if (options.title || options.description) {
		const header = group.createDiv({ cls: "friday-native-settings-group-header" });
		if (options.title) {
			header.createDiv({
				cls: "friday-native-settings-group-title",
				text: options.title,
			});
		}
		if (options.description) {
			header.createDiv({
				cls: "friday-native-settings-group-description",
				text: options.description,
			});
		}
	}
	return group;
}

export function renderNativeSectionTabs<TId extends string>(
	containerEl: HTMLElement,
	options: RenderNativeSectionTabsOptions<TId>,
): HTMLDivElement {
	const nav = containerEl.createDiv({ cls: "friday-top-nav" });
	for (const item of options.items) {
		const isActive = options.activeId === item.id;
		const button = nav.createEl("button", {
			cls: `friday-nav-button${isActive ? " is-active" : ""}`,
			text: item.label,
		});
		button.type = "button";
		button.setAttribute("aria-pressed", isActive ? "true" : "false");
		button.onclick = () => options.onSelect(item.id);
	}
	return nav;
}

export function renderNativeSettingStatus(
	setting: Setting,
	options: RenderNativeSettingStatusOptions,
): HTMLDivElement {
	const tone = options.tone ?? "muted";
	setting.settingEl.classList.add("friday-native-setting-has-status");
	const statusEl = setting.descEl.createDiv({
		cls: joinClassNames("friday-native-setting-status", `is-${tone}`),
		text: options.text,
	});
	statusEl.setAttribute("data-native-kit", "setting-status");
	if (options.title) {
		statusEl.setAttribute("title", options.title);
	}
	return statusEl;
}

export function markNativeDangerSetting(setting: Setting): Setting {
	setting.settingEl.classList.add("friday-native-danger-setting");
	setting.settingEl.setAttribute("data-native-kit", "danger-setting");
	return setting;
}

export function renderNativeSettingsFeedback(
	containerEl: HTMLElement,
	options: RenderNativeSettingsFeedbackOptions,
): HTMLDivElement {
	const tone = options.tone ?? "muted";
	const feedbackEl = containerEl.createDiv({
		cls: joinClassNames("friday-native-settings-feedback", `is-${tone}`, options.extraClass),
	});
	feedbackEl.setAttribute("data-native-kit", "settings-feedback");
	feedbackEl.setAttribute("role", tone === "danger" || tone === "warning" ? "alert" : "status");
	if (options.title) {
		feedbackEl.createDiv({
			cls: "friday-native-settings-feedback-title",
			text: options.title,
		});
	}
	feedbackEl.createDiv({
		cls: "friday-native-settings-feedback-message",
		text: options.message,
	});
	if (typeof options.progressPercent === "number") {
		const progressWrap = feedbackEl.createDiv({ cls: "friday-native-settings-feedback-progress" });
		const progressEl = progressWrap.createEl("progress") as HTMLProgressElement;
		progressEl.max = 100;
		progressEl.value = Math.max(0, Math.min(100, Math.round(options.progressPercent)));
		progressEl.setAttribute("aria-label", options.title ?? options.message);
		progressWrap.createSpan({
			cls: "friday-native-settings-feedback-progress-label",
			text: options.progressLabel ?? `${progressEl.value}%`,
		});
	}
	if (options.detail) {
		feedbackEl.createEl("pre", {
			cls: "friday-native-settings-feedback-detail",
			text: options.detail,
		});
	}
	return feedbackEl;
}

export function renderNativePrerequisiteList(
	containerEl: HTMLElement,
	options: RenderNativePrerequisiteListOptions,
): HTMLUListElement {
	const list = containerEl.createEl("ul", { cls: "friday-native-prerequisite-list" });
	list.setAttribute("data-native-kit", "prerequisite-list");
	if (options.ariaLabel) {
		list.setAttribute("aria-label", options.ariaLabel);
	}
	for (const item of options.items) {
		const row = list.createEl("li", {
			cls: joinClassNames("friday-native-prerequisite-item", `is-${item.state}`),
		});
		row.setAttribute("data-state", item.state);
		const copy = row.createDiv({ cls: "friday-native-prerequisite-copy" });
		copy.createSpan({ cls: "friday-native-prerequisite-label", text: item.label });
		if (item.detail) {
			copy.createSpan({ cls: "friday-native-prerequisite-detail", text: item.detail });
		}
		row.createSpan({
			cls: "friday-native-prerequisite-state",
			text: item.stateLabel ?? item.state,
		});
		if (item.actionLabel && item.onAction) {
			const action = row.createEl("button", {
				cls: "friday-native-prerequisite-action",
				text: item.actionLabel,
			});
			action.type = "button";
			action.onclick = item.onAction;
		}
	}
	return list;
}

export function renderNativeSettingsEmptyState(
	containerEl: HTMLElement,
	options: RenderNativeSettingsEmptyStateOptions,
): HTMLDivElement {
	const emptyEl = containerEl.createDiv({
		cls: joinClassNames("friday-native-empty-state", "friday-empty-state", options.extraClass),
	});
	emptyEl.setAttribute("data-native-kit", "empty-state");
	if (options.showBrandMark) {
		emptyEl.createDiv({ cls: "friday-native-empty-state-mark friday-wordmark", text: "FRIDAY" });
	}
	const copy = emptyEl.createDiv({ cls: "friday-native-empty-state-copy" });
	copy.createEl("h4", { cls: "friday-native-empty-state-title", text: options.title });
	copy.createEl("p", { text: options.description });
	if (options.actionLabel && options.onAction) {
		const action = emptyEl.createEl("button", {
			cls: "friday-native-empty-state-action",
			text: options.actionLabel,
		});
		action.type = "button";
		action.onclick = options.onAction;
	}
	return emptyEl;
}

export function renderNativeInlineAlert(
	containerEl: HTMLElement,
	options: RenderNativeInlineAlertOptions,
): HTMLDivElement {
	const tone = options.tone ?? "warning";
	const alertEl = containerEl.createDiv({
		cls: joinClassNames("friday-native-inline-alert", `is-${tone}`, options.extraClass),
	});
	alertEl.setAttribute("data-native-kit", "inline-alert");
	alertEl.setAttribute("role", tone === "danger" || tone === "warning" ? "alert" : "status");
	const copy = alertEl.createDiv({ cls: "friday-native-inline-alert-copy" });
	if (options.title) {
		copy.createDiv({ cls: "friday-native-inline-alert-title", text: options.title });
	}
	copy.createDiv({ cls: "friday-native-inline-alert-message", text: options.message });
	if (options.actionLabel && options.onAction) {
		const action = alertEl.createEl("button", {
			cls: "friday-native-inline-alert-action",
			text: options.actionLabel,
		});
		action.type = "button";
		action.onclick = options.onAction;
	}
	return alertEl;
}

export function renderFridaySettingsTitle(
	containerEl: HTMLElement,
	options: RenderFridaySettingsTitleOptions,
): HTMLHeadingElement {
	const brandIndex = options.titleText.indexOf(options.brandText);
	if (brandIndex < 0) {
		return containerEl.createEl("h2", { text: options.titleText });
	}

	const titleEl = containerEl.createEl("h2", { cls: "friday-settings-title" });
	const prefixText = options.titleText.slice(0, brandIndex).trim();
	const suffixText = options.titleText.slice(brandIndex + options.brandText.length).trim();

	if (prefixText) {
		titleEl.createSpan({ cls: "friday-settings-title-prefix", text: prefixText });
	}
	const brandEl = titleEl.createSpan({
		cls: "friday-settings-title-brand friday-wordmark",
		text: options.brandText,
	});
	if (options.wordmarkFontFamily) {
		brandEl.style.fontFamily = options.wordmarkFontFamily;
	}
	if (suffixText) {
		titleEl.createSpan({ cls: "friday-settings-title-suffix", text: suffixText });
	}
	return titleEl;
}
