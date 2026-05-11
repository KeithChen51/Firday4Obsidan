export interface NativeSettingsGroupOptions {
	title?: string;
	description?: string;
	extraClass?: string;
}

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
