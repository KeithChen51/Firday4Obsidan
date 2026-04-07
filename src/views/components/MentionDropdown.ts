export interface MentionSuggestion {
	value: string;
	label: string;
	description?: string;
}

export class MentionDropdown {
	private readonly containerEl: HTMLElement;
	private readonly listEl: HTMLElement;
	private suggestions: MentionSuggestion[] = [];
	private activeIndex = 0;
	private selectHandler: ((item: MentionSuggestion) => void) | null = null;

	constructor(parent: HTMLElement) {
		this.containerEl = parent.createDiv({ cls: "friday-mention-dropdown is-hidden" });
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
		this.suggestions.forEach((item, index) => {
			const row = this.listEl.createDiv({
				cls: `friday-mention-item ${index === this.activeIndex ? "is-active" : ""}`,
			});
			const button = row.createEl("button", {
				cls: "friday-mention-item-button",
				text: item.label,
			});
			button.type = "button";
			button.onmouseenter = () => {
				this.activeIndex = index;
				this.render();
			};
			button.onmousedown = (event) => {
				event.preventDefault();
				this.selectHandler?.(item);
			};
			if (item.description) {
				row.createDiv({ cls: "friday-mention-item-description", text: item.description });
			}
		});
	}
}
