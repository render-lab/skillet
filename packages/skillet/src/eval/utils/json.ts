import { jsonrepair } from "jsonrepair";

/** Extract a JSON object from LLM output that may be wrapped in markdown fences,
 *  then repair common issues (literal newlines in strings, invalid escapes, etc.). */
export function extractJson(text: string): string {
	let json: string;
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenced) {
		json = fenced[1].trim();
	} else {
		const braces = text.match(/\{[\s\S]*\}/);
		json = braces ? braces[0] : text;
	}

	try {
		JSON.parse(json);
		return json;
	} catch {
		if (/^\s*[{\[]/.test(json)) {
			return jsonrepair(json);
		}
		return json;
	}
}
