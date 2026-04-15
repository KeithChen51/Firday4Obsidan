import type { SyncRuntimeStore } from "./SyncRuntimeStore";

interface StatusBarItemLike {
	setText(text: string): void;
}

export class SyncStatusBar {
	private unsubscribe: (() => void) | null = null;

	constructor(
		private readonly store: SyncRuntimeStore,
		private readonly item: StatusBarItemLike,
		private readonly getActiveProjectId: () => string,
	) {
		this.unsubscribe = this.store.subscribe(() => {
			this.refresh();
		});
		this.refresh();
	}

	refresh(): void {
		const activeProjectId = this.getActiveProjectId();
		const state =
			(activeProjectId ? this.store.getProjectState(activeProjectId) : null) ??
			this.store.getStates()[0] ??
			null;
		if (!state) {
			this.item.setText("F.R.I.D.A.Y: Ready");
			return;
		}
		this.item.setText(`Sync: ${state.projectSlug} · ${state.stage}`);
	}

	destroy(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}
}
