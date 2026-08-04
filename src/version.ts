/** Arrs Hub Mobile Tester - single source for display name + semver. */
import packageJson from "../package.json";

export const APP_MAJOR = "v1";
export const APP_NAME = "Arrs Hub Mobile Tester";
export const APP_VERSION = packageJson.version;
export const APP_VERSION_LABEL = `${APP_NAME} ${APP_MAJOR} (${APP_VERSION})`;
