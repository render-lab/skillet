import YAML from "yaml";

interface ParsedFile {
	frontmatter: Record<string, unknown>;
	body: string;
}

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)---[ \t]*\r?\n?([\s\S]*)$/;

export function parseFrontmatter(content: string): ParsedFile {
	const match = content.match(FRONTMATTER_RE);
	if (!match) {
		return { frontmatter: {}, body: content };
	}
	const yamlStr = match[1].trim();
	const frontmatter = yamlStr ? (YAML.parse(yamlStr) ?? {}) : {};
	return { frontmatter, body: match[2] };
}

export function renderFrontmatter(data: Record<string, unknown>, body: string): string {
	const yaml = YAML.stringify(data).trimEnd();
	return `---\n${yaml}\n---\n${body}`;
}
