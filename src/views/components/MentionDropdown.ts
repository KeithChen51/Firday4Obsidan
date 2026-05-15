import type { MentionToken } from "../../core/context/mention/MentionResolver";

export type MentionFileTypeIconKind = "markdown" | "canvas" | "code" | "note";

export interface MentionSuggestion {
	label: string;
	description?: string;
	value?: string;
	kind?: "slash" | "mention_category" | "mention_token" | "skill";
	trigger?: "@" | "/";
	category?: "active_note" | "note" | "folder";
	fileTypeIcon?: MentionFileTypeIconKind;
	fileTypeLabel?: string;
	replacementText?: string;
	token?: MentionToken;
}

export class MentionDropdown {
	private readonly containerEl: HTMLElement;
	private readonly listEl: HTMLElement;
	private suggestions: MentionSuggestion[] = [];
	private activeIndex = 0;
	private selectHandler: ((item: MentionSuggestion) => void) | null = null;

	constructor(parent: HTMLElement) {
		this.containerEl = parent.createDiv({
			cls: "friday-mention-dropdown is-hidden",
			attr: {
				role: "listbox",
				"aria-activedescendant": "",
			},
		});
		this.listEl = this.containerEl.createDiv({ cls: "friday-mention-dropdown-list" });
	}

	destroy(): void {
		this.containerEl.remove();
	}

	isOpen(): boolean {
		return !this.containerEl.hasClass("is-hidden");
	}

	hide(): void {
		this.suggestions = [];
		this.activeIndex = 0;
		this.containerEl.addClass("is-hidden");
		this.containerEl.setAttribute("aria-activedescendant", "");
		this.listEl.empty();
	}

	show(items: MentionSuggestion[]): void {
		if (items.length === 0) {
			this.hide();
			return;
		}
		this.suggestions = items;
		this.activeIndex = 0;
		this.containerEl.removeClass("is-hidden");
		this.render();
	}

	onSelect(handler: (item: MentionSuggestion) => void): void {
		this.selectHandler = handler;
	}

	handleKeydown(event: KeyboardEvent): boolean {
		if (!this.isOpen()) {
			return false;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.activeIndex = Math.min(this.activeIndex + 1, this.suggestions.length - 1);
			this.render();
			return true;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			this.activeIndex = Math.max(this.activeIndex - 1, 0);
			this.render();
			return true;
		}

		if (event.key === "Enter" || event.key === "Tab") {
			event.preventDefault();
			const current = this.suggestions[this.activeIndex];
			if (current) {
				this.selectHandler?.(current);
			}
			return true;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			this.hide();
			return true;
		}

		return false;
	}

	private render(): void {
		this.listEl.empty();
		this.containerEl.setAttribute("aria-activedescendant", this.getOptionId(this.activeIndex));
		this.suggestions.forEach((item, index) => {
			const optionId = this.getOptionId(index);
			const row = this.listEl.createDiv({
				cls: [
					"friday-mention-item",
					index === this.activeIndex ? "is-active" : "",
					item.fileTypeIcon ? "" : "is-text-only",
				].filter(Boolean).join(" "),
				attr: {
					id: optionId,
					role: "option",
					"aria-selected": index === this.activeIndex ? "true" : "false",
				},
			});
			const selectFromPointer = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				this.activeIndex = index;
				this.selectHandler?.(item);
			};
			row.onmouseenter = () => {
				this.activeIndex = index;
				this.render();
			};
			row.onmousedown = selectFromPointer;
			row.onclick = selectFromPointer;
			const copyParent = item.fileTypeIcon ? this.renderFileTypeIcon(row, item) : row;
			copyParent.createDiv({
				cls: "friday-mention-item-button",
				text: item.label,
			});
			if (item.description) {
				copyParent.createDiv({ cls: "friday-mention-item-description", text: item.description });
			}
		});
	}

	private renderFileTypeIcon(row: HTMLElement, item: MentionSuggestion): HTMLElement {
		const iconKind = item.fileTypeIcon ?? "note";
		const iconEl = row.createEl("span", {
			cls: `kit-file-type-icon-v1 is-${iconKind}`,
			attr: {
				"aria-label": item.fileTypeLabel ?? this.getFileTypeLabel(iconKind),
			},
		});
		iconEl.createEl("span", {
			cls: "friday-icon",
			text: this.getFileTypeGlyph(iconKind),
			attr: { "aria-hidden": "true" },
		});
		return row.createDiv({ cls: "friday-mention-item-copy" });
	}

	private getFileTypeLabel(kind: MentionFileTypeIconKind): string {
		switch (kind) {
			case "markdown":
				return "Markdown";
			case "canvas":
				return "Canvas";
			case "code":
				return "Code";
			default:
				return "Note";
		}
	}

	private getFileTypeGlyph(kind: MentionFileTypeIconKind): string {
		switch (kind) {
			case "markdown":
				return "M";
			case "canvas":
				return "C";
			case "code":
				return "<>";
			default:
				return "N";
		}
	}

	private getOptionId(index: number): string {
		return `friday-mention-option-${index}`;
	}
}
