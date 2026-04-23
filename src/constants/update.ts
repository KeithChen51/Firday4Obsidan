export const PLUGIN_UPDATE_REPO_URL = "https://devops.byd.com/QCSHFW/houshichangjiazhifazhanbu/F.R.I.D.A.Y.git";
export const PLUGIN_UPDATE_BRANCH = "release";
export const PLUGIN_UPDATE_MANIFEST_PATH = "plugin/latest.json";
export const PLUGIN_UPDATE_ARTIFACT_DIR = "plugin/artifacts";
export const PLUGIN_UPDATE_MAIN_JS_PATH = `${PLUGIN_UPDATE_ARTIFACT_DIR}/main.js`;
export const PLUGIN_UPDATE_MANIFEST_JSON_PATH = `${PLUGIN_UPDATE_ARTIFACT_DIR}/manifest.json`;
export const PLUGIN_UPDATE_STYLES_PATH = `${PLUGIN_UPDATE_ARTIFACT_DIR}/styles.css`;
export const PLUGIN_UPDATE_ARTIFACT_PATHS = [
	PLUGIN_UPDATE_MAIN_JS_PATH,
	PLUGIN_UPDATE_MANIFEST_JSON_PATH,
	PLUGIN_UPDATE_STYLES_PATH,
] as const;
