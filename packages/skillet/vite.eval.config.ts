import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const evalUiRoot = path.resolve(__dirname, "eval-ui");
const evalApiOrigin =
	process.env.SKILLET_EVAL_API_ORIGIN ??
	`http://127.0.0.1:${process.env.SKILLET_EVAL_API_PORT ?? "3000"}`;

export default defineConfig(({ command }) => ({
	root: evalUiRoot,
	base: command === "serve" ? "/" : "/__skillet-eval-ui/",
	plugins: [tailwindcss()],
	server: {
		port: 4173,
		proxy: {
			"/api": {
				target: evalApiOrigin,
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: path.resolve(__dirname, "dist", "eval-ui"),
		emptyOutDir: false,
	},
}));
