import type { Lockfile } from "../schemas/lockfile.js";
import { hashDirectory } from "../utils/hash.js";

export interface VerifyResult {
	id: string;
	expected: string;
	actual: string;
	valid: boolean;
}

/**
 * Verify that cached skill directories match lockfile SHAs.
 */
export async function verifyIntegrity(
	lockfile: Lockfile,
	getLocalPath: (id: string, sha: string) => Promise<string | null>,
): Promise<VerifyResult[]> {
	const results: VerifyResult[] = [];

	for (const [key, entry] of Object.entries(lockfile.resolved)) {
		const id = key.split("@")[0];
		const localPath = await getLocalPath(id, entry.sha256);

		if (!localPath) {
			results.push({
				id,
				expected: entry.sha256,
				actual: "",
				valid: false,
			});
			continue;
		}

		const actual = await hashDirectory(localPath);
		results.push({
			id,
			expected: entry.sha256,
			actual,
			valid: actual === entry.sha256,
		});
	}

	return results;
}
