import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { EditorState, TextSelection, type Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import {
	createEmptyMentionComposerSnapshot,
	createMentionNode,
	mentionComposerSchema,
	restoreMentionComposerSelection,
	restoreMentionComposerDoc,
	serializeMentionComposerDoc,
	type MentionComposerSnapshot,
} from "../../core/editor/mention/MentionComposerDocument";
import type { MentionToken } from "../../core/context/mention/MentionResolver";
import { MentionDropdown, type MentionSuggestion } from "./MentionDropdown";

export interface MentionComposerQuery {
	trigger: "@" | "/";
	query: string;
	mode: "category" | "search";
	category?: "notes" | "folders";
}

export interface MentionComposerOptions {
	parent: HTMLElement;
	placeholder: string;
	initialSnapshot?: MentionComposerSnapshot;
	disabled?: boolean;
	onChange?: (snapshot: MentionComposerSnapshot) => void;
	onSubmit?: () => void;
	getSuggestions?: (query: MentionComposerQuery) => Promise<MentionSuggestion[]>;
}

interface TriggerState {
	trigger: "@" | "/";
	from: number;
	to: number;
	query: string;
	mode: "category" | "search";
	category?: "notes" | "folders";
}

export class MentionComposer {
	private readonly rootEl: HTMLElement;
	private readonly editorEl: HTMLElement;
	private readonly dropdown: MentionDropdown;
	private readonly view: EditorView;
	private activeTrigger: TriggerState | null = null;
	private snapshot: MentionComposerSnapshot;

	constructor(private readonly options: MentionComposerOptions) {
		this.rootEl = options.parent.createDiv({ cls: "friday-mention-composer-root" });
		this.editorEl = this.rootEl.createDiv({
			cls: "friday-mention-composer-editor",
			attr: { "data-placeholder": options.placeholder },
		});
		this.dropdown = new MentionDropdown(this.rootEl);
		const initialDoc = restoreMentionComposerDoc(options.initialSnapshot ?? createEmptyMentionComposerSnapshot());
		const initialSelection = restoreMentionComposerSelection(options.initialSnapshot, initialDoc);
		this.snapshot = serializeMentionComposerDoc(initialDoc);
		this.view = new EditorView(this.editorEl, {
			state: EditorState.create({
				doc: initialDoc,
				schema: mentionComposerSchema,
				selection: initialSelection ?? undefined,
				plugins: [keymap(baseKeymap)],
			}),
			editable: () => !this.options.disabled,
			dispatchTransaction: (transaction) => {
				this.applyTransaction(transaction);
			},
			handleKeyDown: (_view, event) => this.handleKeyDown(event),
			handleDOMEvents: {
				mousedown: (_view, event) => this.handleMouseDown(event),
			},
		});
		this.dropdown.onSelect((item) => {
			void this.applySuggestion(item);
		});
		this.editorEl.onclick = () => {
			this.focus();
		};
		this.syncSnapshot(true);
	}

	destroy(): void {
		this.dropdown.destroy();
		this.view.destroy();
		this.rootEl.remove();
	}

	focus(): void {
		this.view.focus();
	}

	getSnapshot(): MentionComposerSnapshot {
		return this.snapshot;
	}

	hasFocus(): boolean {
		return this.view.hasFocus();
	}

	insertText(text: string): void {
		const { from, to } = this.view.state.selection;
		const transaction = this.view.state.tr.insertText(text, from, to);
		const nextPos = from + text.length;
		transaction.setSelection(TextSelection.create(transaction.doc, nextPos));
		this.view.dispatch(transaction);
	}

	openAtPicker(): void {
		this.focus();
		this.insertText("@");
		this.activeTrigger = {
			trigger: "@",
			from: Math.max(1, this.view.state.selection.from - 1),
			to: this.view.state.selection.from,
			query: "",
			mode: "category",
		};
		void this.refreshSuggestions();
	}

	private applyTransaction(transaction: Transaction): void {
		const nextState = this.view.state.apply(transaction);
		this.view.updateState(nextState);
		this.syncSnapshot();
		void this.refreshSuggestions();
	}

	private syncSnapshot(initial = false): void {
		const { anchor, head } = this.view.state.selection;
		this.snapshot = {
			...serializeMentionComposerDoc(this.view.state.doc),
			selectionAnchor: anchor,
			selectionHead: head,
		};
		this.editorEl.toggleClass("is-empty", this.snapshot.text.length === 0 && this.snapshot.tokens.length === 0);
		if (!initial) {
			this.options.onChange?.(this.snapshot);
		}
	}

	private async refreshSuggestions(): Promise<void> {
		const trigger = this.detectTriggerState();
		if (!trigger) {
			this.activeTrigger = null;
			this.dropdown.hide();
			return;
		}
		if (
			this.activeTrigger
			&& this.activeTrigger.trigger === "@"
			&& this.activeTrigger.mode === "search"
			&& trigger.trigger === "@"
		) {
			trigger.mode = "search";
			trigger.category = this.activeTrigger.category;
		}
		this.activeTrigger = trigger;
		const suggestions = await this.options.getSuggestions?.({
			trigger: trigger.trigger,
			query: trigger.query,
			mode: trigger.mode,
			category: trigger.category,
		}) ?? [];
		this.dropdown.show(suggestions);
	}

	private detectTriggerState(): TriggerState | null {
		const { from, empty } = this.view.state.selection;
		if (!empty) {
			return null;
		}
		const textBefore = this.view.state.doc.textBetween(0, from, "\n", " ");
		const slashMatch = textBefore.match(/(?:^|\s)\/([^\s/]*)$/);
		if (slashMatch) {
			const query = slashMatch[1] ?? "";
			return {
				trigger: "/",
				query,
				from: from - query.length - 1,
				to: from,
				mode: "search",
			};
		}
		const mentionMatch = textBefore.match(/(?:^|\s)@([^\s@]*)$/);
		if (!mentionMatch) {
			return null;
		}
		const query = mentionMatch[1] ?? "";
		return {
			trigger: "@",
			query,
			from: from - query.length - 1,
			to: from,
			mode: "category",
		};
	}

	private handleKeyDown(event: KeyboardEvent): boolean {
		if (this.dropdown.handleKeydown(event)) {
			return true;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			this.options.onSubmit?.();
			return true;
		}
		if (event.key === "Backspace") {
			return this.deleteAdjacentMention("before");
		}
		if (event.key === "Delete") {
			return this.deleteAdjacentMention("after");
		}
		return false;
	}

	private handleMouseDown(event: Event): boolean {
		const target = event.target instanceof HTMLElement ? event.target : null;
		const removeButton = target?.closest<HTMLElement>("[data-mention-remove='true']");
		if (!removeButton) {
			return false;
		}
		const tokenEl = removeButton.closest<HTMLElement>("[data-mention-id]");
		const mentionId = tokenEl?.getAttribute("data-mention-id") ?? "";
		if (!mentionId) {
			return false;
		}
		event.preventDefault();
		this.removeMentionById(mentionId);
		return true;
	}

	private deleteAdjacentMention(direction: "before" | "after"): boolean {
		const { $from, empty } = this.view.state.selection;
		if (!empty) {
			return false;
		}
		const target = direction === "before" ? $from.nodeBefore : $from.nodeAfter;
		if (!target || target.type.name !== "mention") {
			return false;
		}
		const from = direction === "before" ? $from.pos - target.nodeSize : $from.pos;
		const to = direction === "before" ? $from.pos : $from.pos + target.nodeSize;
		this.view.dispatch(this.view.state.tr.delete(from, to));
		return true;
	}

	private removeMentionById(mentionId: string): void {
		let deleteFrom = -1;
		let deleteTo = -1;
		this.view.state.doc.descendants((node, pos) => {
			if (node.type.name !== "mention") {
				return true;
			}
			if ((node.attrs as { id?: string }).id === mentionId) {
				deleteFrom = pos;
				deleteTo = pos + node.nodeSize;
				return false;
			}
			return true;
		});
		if (deleteFrom < 0 || deleteTo < 0) {
			return;
		}
		const transaction = this.view.state.tr.delete(deleteFrom, deleteTo);
		this.view.dispatch(transaction);
	}

	private async applySuggestion(item: MentionSuggestion): Promise<void> {
		if (item.kind === "mention_category") {
			if (this.activeTrigger?.trigger === "@") {
				this.activeTrigger = {
					...this.activeTrigger,
					mode: "search",
					category: item.category === "folder" ? "folders" : "notes",
				};
				const suggestions = await this.options.getSuggestions?.({
					trigger: "@",
					query: "",
					mode: "search",
					category: this.activeTrigger.category,
				}) ?? [];
				this.dropdown.show(suggestions);
			}
			return;
		}
		if (item.trigger === "/" && item.replacementText) {
			this.replaceActiveTriggerWithText(item.replacementText);
			return;
		}
		if (!item.token) {
			return;
		}
		this.replaceActiveTriggerWithMention(item.token);
	}

	private replaceActiveTriggerWithText(text: string): void {
		const trigger = this.activeTrigger;
		if (!trigger) {
			this.insertText(text);
			this.dropdown.hide();
			return;
		}
		const transaction = this.view.state.tr.insertText(text, trigger.from, trigger.to);
		const nextPos = trigger.from + text.length;
		transaction.setSelection(TextSelection.create(transaction.doc, nextPos));
		this.activeTrigger = null;
		this.view.dispatch(transaction);
		this.dropdown.hide();
	}

	private replaceActiveTriggerWithMention(token: MentionToken): void {
		const trigger = this.activeTrigger;
		const mentionNode = createMentionNode(token);
		const transaction = this.view.state.tr;
		if (trigger) {
			transaction.replaceWith(trigger.from, trigger.to, [mentionNode, mentionComposerSchema.text(" ")]);
			transaction.setSelection(TextSelection.create(transaction.doc, trigger.from + mentionNode.nodeSize + 1));
		} else {
			const { from, to } = this.view.state.selection;
			transaction.replaceWith(from, to, [mentionNode, mentionComposerSchema.text(" ")]);
			transaction.setSelection(TextSelection.create(transaction.doc, from + mentionNode.nodeSize + 1));
		}
		this.activeTrigger = null;
		this.view.dispatch(transaction);
		this.dropdown.hide();
	}
}
