import type { PhrasingContent, Root, RootContent, TableCell } from "mdast";
import { formatDuration, type TranscriptPart } from "@/lib/transcript";
import { parseMarkdown, plainText } from "./markdown";

// Hex colours only, so older print engines can render it.
export const EXPORT_CSS = `
@page { size: A4; margin: 18mm; }
html, body { margin: 0; padding: 0; }
body { font-family: "Noto Sans", "Noto Sans Devanagari", "Nirmala UI", Mangal, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111111; }
h1 { font-size: 18pt; font-weight: 600; margin: 0 0 8pt; }
h2 { font-size: 14pt; font-weight: 600; margin: 14pt 0 6pt; }
h3 { font-size: 12pt; font-weight: 600; margin: 10pt 0 4pt; }
p { margin: 0 0 6pt; }
.meta, .t { color: #666666; }
ul, ol { margin: 0 0 6pt; padding-left: 18pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
th, td { border: 1px solid #cccccc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f2f2f2; font-weight: 600; }
blockquote { margin: 0 0 6pt; padding-left: 10pt; border-left: 3px solid #cccccc; color: #444444; }
pre, code { font-family: Consolas, "Courier New", monospace; }
pre { white-space: pre-wrap; margin: 0 0 6pt; }
hr { border: 0; border-top: 1px solid #cccccc; margin: 10pt 0; }
p, li, tr { break-inside: avoid; }
`;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapDocument(title: string, body: string): string {
  return `<!doctype html><html lang="hi"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${EXPORT_CSS}</style></head><body>${body}</body></html>`;
}

function inline(nodes: PhrasingContent[]): string {
  return nodes.map(inl).join("");
}

function inl(n: PhrasingContent): string {
  switch (n.type) {
    case "text":
      return escapeHtml(n.value);
    case "strong":
      return `<strong>${inline(n.children)}</strong>`;
    case "emphasis":
      return `<em>${inline(n.children)}</em>`;
    case "delete":
      return `<del>${inline(n.children)}</del>`;
    case "inlineCode":
      return `<code>${escapeHtml(n.value)}</code>`;
    case "link":
      return /^https?:\/\//i.test(n.url)
        ? `<a href="${escapeHtml(n.url)}">${inline(n.children)}</a>`
        : inline(n.children);
    case "break":
      return "<br>";
    case "html":
      return escapeHtml(n.value);
    default:
      return escapeHtml(plainText(n));
  }
}

function cell(tag: "th" | "td", c: TableCell): string {
  return `<${tag}>${inline(c.children)}</${tag}>`;
}

function block(n: RootContent): string {
  switch (n.type) {
    case "heading": {
      const d = Math.min(n.depth, 3);
      return `<h${d}>${inline(n.children)}</h${d}>`;
    }
    case "paragraph":
      return `<p>${inline(n.children)}</p>`;
    case "list": {
      const tag = n.ordered ? "ol" : "ul";
      const items = n.children
        .map((li) => {
          const box = li.checked === true ? "&#9745; " : li.checked === false ? "&#9744; " : "";
          const inner = li.children
            .map((c) => (c.type === "paragraph" ? inline(c.children) : block(c)))
            .join("");
          return `<li>${box}${inner}</li>`;
        })
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "table": {
      const [head, ...rest] = n.children;
      const thead = head ? `<thead><tr>${head.children.map((c) => cell("th", c)).join("")}</tr></thead>` : "";
      const tbody = `<tbody>${rest.map((r) => `<tr>${r.children.map((c) => cell("td", c)).join("")}</tr>`).join("")}</tbody>`;
      return `<table>${thead}${tbody}</table>`;
    }
    case "blockquote":
      return `<blockquote>${n.children.map(block).join("")}</blockquote>`;
    case "code":
      return `<pre><code>${escapeHtml(n.value)}</code></pre>`;
    case "thematicBreak":
      return "<hr>";
    case "html":
      return `<p>${escapeHtml(n.value)}</p>`;
    default:
      return `<p>${escapeHtml(plainText(n))}</p>`;
  }
}

export function mdastToHtml(root: Root): string {
  return root.children.map(block).join("");
}

export async function buildMinutesHtml(o: { title: string; markdown: string }): Promise<string> {
  const root = await parseMarkdown(o.markdown);
  return wrapDocument(o.title, mdastToHtml(root));
}

export function buildTranscriptHtml(o: { title: string; parts: TranscriptPart[] }): string {
  const multi = new Set(o.parts.map((p) => p.speaker)).size > 1;
  const rows = o.parts
    .map((p) => {
      const time = typeof p.t === "number" ? `<span class="t">[${formatDuration(Math.floor(p.t))}]</span> ` : "";
      const who = multi ? `<strong>Speaker ${p.speaker + 1}:</strong> ` : "";
      return `<p>${time}${who}${escapeHtml(p.text)}</p>`;
    })
    .join("");
  return wrapDocument(o.title, `<h1>${escapeHtml(o.title)}</h1>${rows}`);
}
