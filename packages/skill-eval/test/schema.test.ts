import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "../src/providers/schema.js";

describe("zodToJsonSchema", () => {
	it("converts a simple object schema", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		});
		const result = zodToJsonSchema(schema);
		expect(result).toEqual({
			type: "object",
			properties: {
				name: { type: "string" },
				age: { type: "number" },
			},
			required: ["name", "age"],
		});
	});

	it("handles optional fields", () => {
		const schema = z.object({
			name: z.string(),
			nickname: z.string().optional(),
		});
		const result = zodToJsonSchema(schema);
		expect(result.required).toEqual(["name"]);
		expect(result.properties).toHaveProperty("nickname");
	});

	it("converts boolean fields", () => {
		const schema = z.object({
			active: z.boolean(),
		});
		const result = zodToJsonSchema(schema);
		expect((result.properties as Record<string, unknown>).active).toEqual({
			type: "boolean",
		});
	});

	it("converts array fields", () => {
		const schema = z.object({
			tags: z.array(z.string()),
		});
		const result = zodToJsonSchema(schema);
		expect((result.properties as Record<string, unknown>).tags).toEqual({
			type: "array",
			items: { type: "string" },
		});
	});

	it("handles nested objects", () => {
		const schema = z.object({
			address: z.object({
				street: z.string(),
				city: z.string(),
			}),
		});
		const result = zodToJsonSchema(schema);
		const address = (result.properties as Record<string, unknown>).address as Record<
			string,
			unknown
		>;
		expect(address.type).toBe("object");
		expect(address.properties).toHaveProperty("street");
		expect(address.properties).toHaveProperty("city");
	});

	it("returns fallback for unknown types", () => {
		const result = zodToJsonSchema("not a zod schema" as never);
		expect(result).toEqual({ type: "object", properties: {} });
	});
});
