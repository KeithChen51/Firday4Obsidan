export type CapabilityHandler = (args: Record<string, unknown>, agentId: string) => Promise<unknown>;

export class CapabilityResolver {
	constructor(private readonly handlers: Record<string, CapabilityHandler>) {}

	resolve(name: string): CapabilityHandler | null {
		const normalized = name.trim().toLowerCase();
		if (!normalized) {
			return null;
		}
		return this.handlers[normalized] ?? null;
	}
}
