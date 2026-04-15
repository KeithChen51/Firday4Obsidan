import type { ProjectGitCredential } from "../../types/project";

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const memoryStorage = (() => {
	const values = new Map<string, string>();
	return {
		getItem(key: string): string | null {
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string): void {
			values.set(key, value);
		},
		removeItem(key: string): void {
			values.delete(key);
		},
	};
})();

function resolveStorage(): StorageLike {
	const candidate = globalThis as { localStorage?: StorageLike };
	return candidate.localStorage ?? memoryStorage;
}

export class SecureStorage {
	constructor(
		private readonly namespace: string,
		private readonly storage: StorageLike = resolveStorage(),
	) {}

	async getProjectGitCredential(projectId: string): Promise<ProjectGitCredential | null> {
		const raw = this.storage.getItem(this.buildProjectCredentialKey(projectId));
		if (!raw) {
			return null;
		}
		try {
			const parsed = JSON.parse(raw) as Partial<ProjectGitCredential>;
			const username = parsed.username?.trim() ?? "";
			const token = parsed.token?.trim() ?? "";
			if (!username || !token) {
				return null;
			}
			return { username, token };
		} catch {
			return null;
		}
	}

	async setProjectGitCredential(projectId: string, credential: ProjectGitCredential | null): Promise<void> {
		const key = this.buildProjectCredentialKey(projectId);
		if (!credential?.username?.trim() || !credential.token?.trim()) {
			this.storage.removeItem(key);
			return;
		}
		this.storage.setItem(
			key,
			JSON.stringify({
				username: credential.username.trim(),
				token: credential.token.trim(),
			}),
		);
	}

	private buildProjectCredentialKey(projectId: string): string {
		return `${this.namespace}:project-git-credential:${projectId.trim()}`;
	}
}
