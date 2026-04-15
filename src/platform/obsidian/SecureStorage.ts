import type { ProjectGitCredential } from "../../types/project";

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface SafeStorageLike {
	isEncryptionAvailable(): boolean;
	encryptString(value: string): Buffer;
	decryptString(value: Buffer): string;
}

type CredentialStorageMode = "secure" | "plaintext_local";

interface StoredCredentialEnvelope {
	mode: CredentialStorageMode;
	payload: string;
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

function resolveSafeStorage(): SafeStorageLike | null {
	const scope = globalThis as {
		require?: (id: string) => unknown;
		window?: { require?: (id: string) => unknown };
	};
	const requireFn = scope.require ?? scope.window?.require;
	if (typeof requireFn !== "function") {
		return null;
	}
	try {
		const electron = requireFn("electron") as { safeStorage?: SafeStorageLike };
		return electron.safeStorage ?? null;
	} catch {
		return null;
	}
}

export class SecureStorage {
	private readonly mode: CredentialStorageMode;

	constructor(
		private readonly namespace: string,
		private readonly storage: StorageLike = resolveStorage(),
		private readonly safeStorage: SafeStorageLike | null = resolveSafeStorage(),
	) {
		this.mode = this.canEncrypt() ? "secure" : "plaintext_local";
	}

	getMode(): CredentialStorageMode {
		return this.mode;
	}

	async getProjectGitCredential(projectId: string): Promise<ProjectGitCredential | null> {
		const raw = this.storage.getItem(this.buildProjectCredentialKey(projectId));
		if (!raw) {
			return null;
		}
		try {
			const parsed = JSON.parse(raw) as Partial<StoredCredentialEnvelope & ProjectGitCredential>;
			const envelope = this.normalizeEnvelope(parsed);
			if (!envelope) {
				return null;
			}
			const credential =
				envelope.mode === "secure"
					? this.readSecureCredential(envelope.payload)
					: this.readPlaintextCredential(envelope.payload);
			return credential;
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
		const normalized = JSON.stringify({
			username: credential.username.trim(),
			token: credential.token.trim(),
		});
		const envelope: StoredCredentialEnvelope = this.canEncrypt()
			? {
				mode: "secure",
				payload: this.safeStorage!.encryptString(normalized).toString("base64"),
			}
			: {
				mode: "plaintext_local",
				payload: normalized,
			};
		this.storage.setItem(key, JSON.stringify(envelope));
	}

	private canEncrypt(): boolean {
		return Boolean(this.safeStorage?.isEncryptionAvailable());
	}

	private normalizeEnvelope(
		parsed: Partial<StoredCredentialEnvelope & ProjectGitCredential>,
	): StoredCredentialEnvelope | null {
		if (parsed.mode === "secure" && typeof parsed.payload === "string") {
			return {
				mode: "secure",
				payload: parsed.payload,
			};
		}
		if (parsed.mode === "plaintext_local" && typeof parsed.payload === "string") {
			return {
				mode: "plaintext_local",
				payload: parsed.payload,
			};
		}
		if (typeof parsed.username === "string" && typeof parsed.token === "string") {
			return {
				mode: "plaintext_local",
				payload: JSON.stringify({
					username: parsed.username,
					token: parsed.token,
				}),
			};
		}
		return null;
	}

	private readSecureCredential(payload: string): ProjectGitCredential | null {
		if (!this.safeStorage?.isEncryptionAvailable()) {
			return null;
		}
		try {
			const decrypted = this.safeStorage.decryptString(Buffer.from(payload, "base64"));
			return this.readPlaintextCredential(decrypted);
		} catch {
			return null;
		}
	}

	private readPlaintextCredential(payload: string): ProjectGitCredential | null {
		try {
			const parsed = JSON.parse(payload) as Partial<ProjectGitCredential>;
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

	private buildProjectCredentialKey(projectId: string): string {
		return `${this.namespace}:project-git-credential:${projectId.trim()}`;
	}
}
