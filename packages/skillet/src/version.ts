declare const SKILLET_VERSION: string;

export const VERSION =
	typeof SKILLET_VERSION !== "undefined"
		? SKILLET_VERSION
		: (process.env.npm_package_version ?? "0.0.0");
