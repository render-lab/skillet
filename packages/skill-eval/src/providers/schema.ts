import type { ToolDefinition } from "./types.js";

/**
 * Inline Zod-to-JSON-Schema conversion. Covers the shapes used by tool
 * definitions (object, string, number, boolean, array, optional).
 *
 * Uses Zod internal `_def` — if this breaks across Zod versions, consider
 * migrating to the `zod-to-json-schema` package.
 */
export function zodToJsonSchema(schema: ToolDefinition["parameters"]): Record<string, unknown> {
	return convertNode(schema);
}

interface ZodDef {
	_def?: {
		typeName?: string;
		shape?: () => Record<string, unknown>;
		type?: unknown;
		innerType?: unknown;
	};
}

function convertNode(schema: unknown): Record<string, unknown> {
	const s = schema as ZodDef;
	if (!s._def) return { type: "object", properties: {} };

	const { typeName } = s._def;

	if (typeName === "ZodObject" && s._def.shape) {
		const shape = s._def.shape();
		const properties: Record<string, unknown> = {};
		const required: string[] = [];
		for (const [key, val] of Object.entries(shape)) {
			properties[key] = convertNode(val);
			const v = val as ZodDef;
			if (v._def?.typeName !== "ZodOptional") required.push(key);
		}
		return { type: "object", properties, required };
	}

	if (typeName === "ZodArray" && s._def.type) {
		return { type: "array", items: convertNode(s._def.type) };
	}

	if (typeName === "ZodOptional" && s._def.innerType) {
		return convertNode(s._def.innerType);
	}

	if (typeName === "ZodString") return { type: "string" };
	if (typeName === "ZodNumber") return { type: "number" };
	if (typeName === "ZodBoolean") return { type: "boolean" };

	return { type: "string" };
}
