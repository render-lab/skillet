import { describe, expect, it } from "vitest";
import { parseFrontmatter, renderFrontmatter } from "../src/utils/frontmatter.js";

describe("parseFrontmatter", () => {
	it("parses YAML frontmatter and body", () => {
		const input = "---\nname: test\ndescription: A test\n---\n# Body\n\nContent here.";
		const result = parseFrontmatter(input);
		expect(result.frontmatter.name).toBe("test");
		expect(result.frontmatter.description).toBe("A test");
		expect(result.body).toContain("# Body");
		expect(result.body).toContain("Content here.");
	});

	it("returns empty frontmatter when none present", () => {
		const input = "# Just a body\n\nNo frontmatter.";
		const result = parseFrontmatter(input);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe(input);
	});

	it("handles empty frontmatter block", () => {
		const input = "---\n---\n# Body";
		const result = parseFrontmatter(input);
		expect(result.frontmatter).toEqual({});
		expect(result.body).toBe("# Body");
	});
});

describe("renderFrontmatter", () => {
	it("renders data and body into frontmatter format", () => {
		const result = renderFrontmatter({ name: "test" }, "# Body\n");
		expect(result).toContain("---");
		expect(result).toContain("name: test");
		expect(result).toContain("# Body");
	});
});
