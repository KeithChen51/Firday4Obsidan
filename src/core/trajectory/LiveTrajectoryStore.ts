import type { RuntimeProgressEvent } from "../../services/AgentRuntimeService";
import type { AgentTrajectoryIdentity, AgentTrajectorySnapshot } from "./AgentTrajectory";
import { projectRuntimeProgress } from "./AgentTrajectoryProjector";

type RuntimeProgressWithIdentity = RuntimeProgressEvent & Partial<AgentTrajectoryIdentity>;

export class LiveTrajectoryStore {
	private progressEvents: RuntimeProgressWithIdentity[] = [];
	private currentSnapshot: AgentTrajectorySnapshot | null = null;
	private completedSnapshot: AgentTrajectorySnapshot | null = null;

	appendProgress(event: RuntimeProgressEvent): AgentTrajectorySnapshot {
		const progressEvent = clonePlain(event as RuntimeProgressWithIdentity);
		if (this.shouldResetForNewTurn(progressEvent)) {
			this.progressEvents = [];
			this.currentSnapshot = null;
			this.completedSnapshot = null;
		}
		this.progressEvents.push(progressEvent);
		this.currentSnapshot = projectRuntimeProgress(this.progressEvents);
		return cloneSnapshot(this.currentSnapshot);
	}

	completeFromProgress(event?: RuntimeProgressEvent): AgentTrajectorySnapshot | null {
		if (event) {
			const progressEvent = clonePlain(event as RuntimeProgressWithIdentity);
			if (this.shouldResetForNewTurn(progressEvent)) {
				this.progressEvents = [];
			}
			this.progressEvents.push(progressEvent);
		}
		if (this.progressEvents.length === 0) {
			return null;
		}
		this.completedSnapshot = projectRuntimeProgress(this.progressEvents);
		this.currentSnapshot = null;
		this.progressEvents = [];
		return cloneSnapshot(this.completedSnapshot);
	}

	reset(): void {
		this.progressEvents = [];
		this.currentSnapshot = null;
	}

	getSnapshot(): AgentTrajectorySnapshot | null {
		return this.currentSnapshot ? cloneSnapshot(this.currentSnapshot) : null;
	}

	getCompletedSnapshot(): AgentTrajectorySnapshot | null {
		return this.completedSnapshot ? cloneSnapshot(this.completedSnapshot) : null;
	}

	private shouldResetForNewTurn(event: RuntimeProgressWithIdentity): boolean {
		if (this.progressEvents.length === 0) {
			return false;
		}
		if (event.phase !== "start" || !event.turnId) {
			return false;
		}
		const currentTurnId = this.findCurrentTurnId();
		return Boolean(currentTurnId && currentTurnId !== event.turnId);
	}

	private findCurrentTurnId(): string {
		for (let index = this.progressEvents.length - 1; index >= 0; index -= 1) {
			const turnId = this.progressEvents[index]?.turnId;
			if (turnId) {
				return turnId;
			}
		}
		return "";
	}
}

function cloneSnapshot(snapshot: AgentTrajectorySnapshot): AgentTrajectorySnapshot {
	return clonePlain(snapshot);
}

function clonePlain<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
