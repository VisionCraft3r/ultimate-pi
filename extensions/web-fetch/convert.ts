import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { extractText } from "unpdf";

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});

function withBaseUrl(
	document: {
		head?: { insertBefore: Function; firstChild: unknown };
		createElement: (tag: string) => { setAttribute: (n: string, v: string) => void };
	},
	url: string,
) {
	if (!url) return;
	try {
		const base = document.createElement("base");
		base.setAttribute("href", url);
		document.head?.insertBefore(base, document.head.firstChild);
	} catch {
		// Conversion can still proceed without a resolvable base href.
	}
}

/** Extract readable article HTML and convert it to Markdown. */
export function htmlToMarkdown(html: string, url: string): string {
	const { document } = parseHTML(String(html ?? ""));
	withBaseUrl(document, url);

	let title = "";
	let contentHtml = "";
	try {
		const article = new Readability(document).parse();
		if (article?.content) {
			contentHtml = article.content;
			title = (article.title ?? "").trim();
		}
	} catch {
		// Fall back to the raw document body when Readability cannot parse.
	}

	if (!contentHtml) {
		contentHtml = document.body?.innerHTML || String(html ?? "");
	}

	const markdown = turndown.turndown(contentHtml).trim();
	if (title && !markdown.startsWith("# ")) {
		return `# ${title}\n\n${markdown}`.trim();
	}
	return markdown;
}

/** Extract text from a PDF and return it as Markdown-friendly plain text. */
export async function pdfToMarkdown(bytes: Uint8Array): Promise<string> {
	const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes as ArrayBuffer);
	const { text } = await extractText(data, { mergePages: true });
	const pages = Array.isArray(text) ? text : [String(text ?? "")];
	return pages
		.map((page) => String(page ?? "").trim())
		.filter(Boolean)
		.join("\n\n")
		.trim();
}
