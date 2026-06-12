(function () {
	const fallbackState = {
		app: {
			name: "FRIDAY Desktop",
			surface: "Electron-first Runtime v0",
		},
	};

	function setActiveView(viewName) {
		for (const view of document.querySelectorAll("[data-view]")) {
			view.classList.toggle("is-active", view.dataset.view === viewName);
		}
	}

	function setActiveResourceTab(tabName) {
		for (const trigger of document.querySelectorAll("[data-resource-tab]")) {
			const isActive = trigger.dataset.resourceTab === tabName;
			trigger.classList.toggle("is-active", isActive);
			trigger.setAttribute("aria-pressed", String(isActive));
		}
		for (const panel of document.querySelectorAll("[data-resource-panel]")) {
			panel.classList.toggle("is-active", panel.dataset.resourcePanel === tabName);
		}
		const activeView = document.querySelector("[data-view].is-active");
		const canvasResourceWindow = activeView?.querySelector("[data-canvas-resource-window]");
		if (canvasResourceWindow) {
			canvasResourceWindow.classList.add("is-open");
		}
	}

	function connectControls() {
		for (const trigger of document.querySelectorAll("[data-view-target]")) {
			trigger.addEventListener("click", () => setActiveView(trigger.dataset.viewTarget));
		}
		for (const trigger of document.querySelectorAll("[data-resource-tab]")) {
			trigger.addEventListener("click", () => setActiveResourceTab(trigger.dataset.resourceTab));
		}
	}

	async function updateBridgeStatus() {
		const status = document.querySelector("[data-bridge-status]");
		if (!status) {
			return;
		}

		if (!window.fridayDesktop) {
			status.textContent = "fridayDesktop bridge unavailable; static renderer fallback loaded";
			return;
		}

		try {
			const [ping, state] = await Promise.all([
				window.fridayDesktop.ping(),
				window.fridayDesktop.getSmokeState(),
			]);
			const resolvedState = state || fallbackState;
			status.textContent = `${resolvedState.app.name} bridge ${ping.ok ? "ready" : "not ready"}`;
		} catch (error) {
			status.textContent = `fridayDesktop bridge error: ${error instanceof Error ? error.message : String(error)}`;
		}
	}

	connectControls();
	setActiveResourceTab("library");
	void updateBridgeStatus();
}());
