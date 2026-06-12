import {
	createWorkbenchSmokeState,
	type WorkbenchSmokeState,
} from "../../ui/workbench/WorkbenchSmokeModel";

export const FRIDAY_DESKTOP_BRIDGE_CHANNELS = {
	ping: "friday-desktop:ping",
	getSmokeState: "friday-desktop:get-smoke-state",
} as const;

export interface FridayDesktopPingResult {
	ok: boolean;
	appName: string;
	surface: string;
}

export interface FridayDesktopBridge {
	ping(): Promise<FridayDesktopPingResult>;
	getSmokeState(): Promise<WorkbenchSmokeState>;
}

export function createFridayDesktopSmokeState(): WorkbenchSmokeState {
	return createWorkbenchSmokeState();
}

export function createFridayDesktopPingResult(): FridayDesktopPingResult {
	const state = createFridayDesktopSmokeState();
	return {
		ok: true,
		appName: state.app.name,
		surface: state.app.surface,
	};
}
