export interface ContextInputEnvelope {
	userQuery: string;
	system?: string;
	policy?: string;
	history?: string;
	attachments?: string;
	secondaryContext?: string;
	hardLimit?: number;
}
