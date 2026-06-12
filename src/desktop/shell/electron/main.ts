import { app, BrowserWindow, ipcMain } from "electron";
import {
	FRIDAY_DESKTOP_BRIDGE_CHANNELS,
	createFridayDesktopPingResult,
	createFridayDesktopSmokeState,
} from "./bridge";
import { pathToFileURL } from "node:url";
import { isAllowedWorkbenchNavigation } from "./navigation";
import { resolvePreloadScript, resolveWorkbenchHtml } from "./paths";

export function registerFridayDesktopBridgeIpc(): void {
	ipcMain.handle(FRIDAY_DESKTOP_BRIDGE_CHANNELS.ping, () => createFridayDesktopPingResult());
	ipcMain.handle(FRIDAY_DESKTOP_BRIDGE_CHANNELS.getSmokeState, () => createFridayDesktopSmokeState());
}

export interface MainWindowOptions {
	smoke?: boolean;
}

function isElectronSmokeMode(): boolean {
	return process.env.FRIDAY_DESKTOP_ELECTRON_SMOKE === "1";
}

export function applyMainWindowSecurity(window: BrowserWindow, allowedWorkbenchPath = resolveWorkbenchHtml()): void {
	const allowedWorkbenchUrl = pathToFileURL(allowedWorkbenchPath).toString();
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event, targetUrl) => {
		if (!isAllowedWorkbenchNavigation(targetUrl, allowedWorkbenchUrl)) {
			event.preventDefault();
		}
	});
}

export function createMainWindow(options: MainWindowOptions = {}): BrowserWindow {
	const window = new BrowserWindow({
		width: 1280,
		height: 840,
		minWidth: 1040,
		minHeight: 720,
		show: options.smoke !== true,
		title: "FRIDAY Desktop",
		backgroundColor: "#F4F1EB",
		webPreferences: {
			preload: resolvePreloadScript(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});

	applyMainWindowSecurity(window);
	return window;
}

export async function loadMainWindow(options: MainWindowOptions = {}): Promise<BrowserWindow> {
	const window = createMainWindow(options);
	await window.loadFile(resolveWorkbenchHtml());
	return window;
}

export async function runElectronSmoke(window: BrowserWindow): Promise<void> {
	const result = await window.webContents.executeJavaScript(`
		(async () => {
			const ping = await window.fridayDesktop.ping();
			const state = await window.fridayDesktop.getSmokeState();
			document.querySelector('[data-view-target="conversation-canvas"]')?.click();
			document.querySelector('[data-view="conversation-canvas"] [data-resource-tab="fileTree"]')?.click();
			const canvasResourceWindow = document.querySelector('[data-view="conversation-canvas"] [data-canvas-resource-window]');
			return {
				ping,
				stateAppName: state.app.name,
				hasFridayDesktopBridge: typeof window.fridayDesktop?.ping === "function",
				hasCanvasResourceWindow: Boolean(canvasResourceWindow),
				canvasResourcePanels: Array.from(canvasResourceWindow?.querySelectorAll('[data-resource-panel]') ?? [])
					.map((panel) => panel.getAttribute('data-resource-panel')),
			};
		})()
	`, true);
	console.log(`FRIDAY_DESKTOP_ELECTRON_SMOKE ${JSON.stringify(result)}`);
}

export async function startFridayDesktopShell(): Promise<void> {
	registerFridayDesktopBridgeIpc();
	await app.whenReady();
	const smoke = isElectronSmokeMode();
	const window = await loadMainWindow({ smoke });
	if (smoke) {
		try {
			await runElectronSmoke(window);
			app.exit(0);
		} catch (error) {
			console.error(error instanceof Error ? error.stack ?? error.message : String(error));
			app.exit(1);
		}
		return;
	}

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			void loadMainWindow();
		}
	});
}

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

if (process.env.FRIDAY_DESKTOP_ELECTRON_ENTRY !== "test") {
	void startFridayDesktopShell();
}
