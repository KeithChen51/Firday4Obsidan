import { RuntimeProfileId } from "./RuntimeProfile";

export interface RuntimeCapabilityMatrix {
	supportsExecTool: boolean;
	supportsExternalRead: boolean;
	supportsSubagent: boolean;
}

const MATRIX: Record<RuntimeProfileId, RuntimeCapabilityMatrix> = {
	"windows-desktop": {
		supportsExecTool: true,
		supportsExternalRead: true,
		supportsSubagent: true,
	},
	"mac-desktop": {
		supportsExecTool: true,
		supportsExternalRead: true,
		supportsSubagent: true,
	},
	unsupported: {
		supportsExecTool: false,
		supportsExternalRead: false,
		supportsSubagent: false,
	},
};

export function getRuntimeCapabilityMatrix(profileId: RuntimeProfileId): RuntimeCapabilityMatrix {
	return MATRIX[profileId];
}
