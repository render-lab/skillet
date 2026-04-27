import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function readJson<T = unknown>(filePath: string): Promise<T> {
	const content = await readFile(filePath, "utf-8");
	return JSON.parse(content);
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readText(filePath: string): Promise<string> {
	return readFile(filePath, "utf-8");
}

export async function writeText(filePath: string, content: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, content);
}
