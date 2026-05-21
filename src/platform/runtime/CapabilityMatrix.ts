import { RuntimeProfileId } from "./RuntimeProfile";

export interface RuntimeCapabilityMatrix {
	supportsExecTool: boolean;
	supportsExternalRead: boolean;
}

const MATRIX: Record<RuntimeProfileId, RuntimeCapabilityMatrix> = {
	"windows-desktop": {
		supportsExecTool: true,
		supportsExternalRead: true,
	},
	"mac-desktop": {
		supportsExecTool: true,
		supportsExternalRead: true,
	},
	"linux-desktop": {
		supportsExecTool: true,
		supportsExternalRead: true,
	},
	unsupported: {
		supportsExecTool: false,
		supportsExternalRead: false,
	},
};

export function getRuntimeCapabilityMatrix(profileId: RuntimeProfileId): RuntimeCapabilityMatrix {
	return MATRIX[profileId];
}
