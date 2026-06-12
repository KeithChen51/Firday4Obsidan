import { contextBridge, ipcRenderer } from "electron";
import {
	FRIDAY_DESKTOP_BRIDGE_CHANNELS,
	type FridayDesktopBridge,
} from "./bridge";

const fridayDesktopBridge: FridayDesktopBridge = {
	ping: () => ipcRenderer.invoke(FRIDAY_DESKTOP_BRIDGE_CHANNELS.ping),
	getSmokeState: () => ipcRenderer.invoke(FRIDAY_DESKTOP_BRIDGE_CHANNELS.getSmokeState),
};

contextBridge.exposeInMainWorld("fridayDesktop", fridayDesktopBridge);

declare global {
	interface Window {
		fridayDesktop: FridayDesktopBridge;
	}
}
