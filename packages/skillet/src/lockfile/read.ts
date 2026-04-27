import path from "node:path";
import { type Lockfile, LOCKFILE_NAME, LockfileSchema } from "../schemas/lockfile.js";
import { fileExists, readJson } from "../utils/fs.js";

export async function readLockfile(projectDir: string): Promise<Lockfile | null> {
	const lockPath = path.join(projectDir, LOCKFILE_NAME);
	if (!(await fileExists(lockPath))) {
		return null;
	}
	const raw = await readJson(lockPath);
	return LockfileSchema.parse(raw);
}
