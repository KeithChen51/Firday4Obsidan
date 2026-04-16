import type { SyncRuntimeStore } from "./SyncRuntimeStore";

interface StatusBarItemLike {
	setText(text: string): void;
	onclick?: ((this: GlobalEventHandlers, ev: MouseEvent) => unknown) | null;
	setAttribute?(name: string, value: string): void;
	style?: {
		color: string;
	};
	dataset?: DOMStringMap;
}

export class SyncStatusBar {
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly store: SyncRuntimeStore,
		private readonly item: StatusBarItemLike,
		private readonly getActiveProjectId: () => string,
		private readonly onClick?: () => void,
	) {
		this.unsubscribe = this.store.subscribe(() => {
			this.refresh();
		});
		if (this.onClick) {
			this.item.onclick = () => {
				this.onClick?.();
			};
			this.item.setAttribute?.("role", "button");
		}
		this.refresh();
	}

	refresh(): void {
		const activeProjectId = this.getActiveProjectId();
		const state =
			(activeProjectId ? this.store.getProjectState(activeProjectId) : null) ??
			this.store.getStates()[0] ??
			null;
		if (!state) {
			this.item.setText("Sync: Ready");
			this.applyStageAppearance("idle");
			return;
		}
		this.item.setText(`Sync ${this.getStageLabel(state.stage)}: ${state.projectSlug}`);
		this.applyStageAppearance(state.stage);
	}

	destroy(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.item.onclick = null;
		this.applyStageAppearance("idle");
	}

	private getStageLabel(stage: string): string {
		switch (stage) {
			case "checking":
				return "Checking";
			case "committing":
				return "Committing";
			case "pulling":
				return "Pulling";
			case "pushing":
				return "Pushing";
			case "resolving":
				return "Resolving";
			case "succeeded":
				return "Ready";
			case "offline":
				return "Offline";
			case "blocked":
				return "Blocked";
			case "failed":
				return "Failed";
			default:
				return "Ready";
		}
	}

	private applyStageAppearance(stage: string): void {
		this.item.setAttribute?.("data-sync-stage", stage);
		if (this.item.dataset) {
			this.item.dataset["syncStage"] = stage;
		}
		if (!this.item.style) {
			return;
		}
		switch (stage) {
			case "offline":
			case "blocked":
			case "failed":
				this.item.style.color = "var(--text-error)";
				return;
			case "succeeded":
				this.item.style.color = "var(--text-success)";
				return;
			default:
				this.item.style.color = "var(--text-normal)";
		}
	}
}
