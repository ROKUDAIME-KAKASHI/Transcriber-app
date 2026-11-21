import type { Root } from "mdast";

export async function parseMarkdown(md: string): Promise<Root> {
  const [{ fromMarkdown }, { gfmFromMarkdown }, { gfm }] = await Promise.all([
    import("mdast-util-from-markdown"),
    import("mdast-util-gfm"),
    import("micromark-extension-gfm"),
  ]);
  return fromMarkdown(md, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

export function plainText(node: unknown): string {
  const n = node as { value?: string; children?: unknown[] };
  if (typeof n.value === "string") return n.value;
  return (n.children ?? []).map(plainText).join("");
}
