export interface ContextInputEnvelope {
	userQuery: string;
	system?: string;
	policy?: string;
	history?: string;
	attachments?: string;
	mentions?: string;
	secondaryContext?: string;
	hardLimit?: number;
}
