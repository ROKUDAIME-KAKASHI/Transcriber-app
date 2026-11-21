import type { PhrasingContent, RootContent, List, TableCell } from "mdast";
import { formatDuration, type TranscriptPart } from "@/lib/transcript";
import { parseMarkdown, plainText } from "./markdown";

type D = typeof import("docx");
type Block = import("docx").Paragraph | import("docx").Table;
type Run = import("docx").ParagraphChild;

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  mono?: boolean;
  size?: number;
}

export function preloadDocx(): void {
  void import("docx");
  void parseMarkdown("");
}

function inlineRuns(d: D, nodes: PhrasingContent[], st: RunStyle = {}): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push(mkRun(d, n.value, st));
        break;
      case "strong":
        out.push(...inlineRuns(d, n.children, { ...st, bold: true }));
        break;
      case "emphasis":
        out.push(...inlineRuns(d, n.children, { ...st, italics: true }));
        break;
      case "delete":
        out.push(...inlineRuns(d, n.children, { ...st, strike: true }));
        break;
      case "inlineCode":
        out.push(mkRun(d, n.value, { ...st, mono: true }));
        break;
      case "link":
        if (/^https?:\/\//i.test(n.url)) {
          out.push(new d.ExternalHyperlink({ link: n.url, children: inlineRuns(d, n.children, st) as import("docx").TextRun[] }));
        } else {
          out.push(...inlineRuns(d, n.children, st));
        }
        break;
      case "break":
        out.push(new d.TextRun({ break: 1 }));
        break;
      case "html":
        out.push(mkRun(d, n.value, st));
        break;
      default:
        out.push(mkRun(d, plainText(n), st));
    }
  }
  return out;
}

function mkRun(d: D, text: string, st: RunStyle) {
  return new d.TextRun({
    text,
    bold: st.bold,
    italics: st.italics,
    strike: st.strike,
    size: st.size,
    font: st.mono ? "Consolas" : undefined,
  });
}

interface Ctx {
  d: D;
  instance: number;
}

function blocks(ctx: Ctx, nodes: RootContent[], level = 0, indent = 0): Block[] {
  const out: Block[] = [];
  for (const n of nodes) out.push(...blockOf(ctx, n, level, indent));
  return out;
}

function blockOf(ctx: Ctx, n: RootContent, level: number, indent: number): Block[] {
  const { d } = ctx;
  const ind = indent ? { indent: { left: indent } } : {};
  switch (n.type) {
    case "heading": {
      const depth = Math.min(n.depth, 3);
      const heading = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3][depth - 1];
      const size = [36, 28, 24][depth - 1];
      return [
        new d.Paragraph({
          heading,
          spacing: { before: 240, after: 120 },
          children: inlineRuns(d, n.children, { bold: true, size }),
        }),
      ];
    }
    case "paragraph":
      return [new d.Paragraph({ ...ind, spacing: { after: 120 }, children: inlineRuns(d, n.children) })];
    case "list":
      return listBlocks(ctx, n, level);
    case "table": {
      const border = { style: d.BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
      const borders = { top: border, bottom: border, left: border, right: border };
      const mk = (c: TableCell, header: boolean) =>
        new d.TableCell({
          borders,
          shading: header ? { type: d.ShadingType.CLEAR, fill: "F2F2F2", color: "auto" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new d.Paragraph({ children: inlineRuns(d, c.children, header ? { bold: true } : {}) })],
        });
      return [
        new d.Table({
          width: { size: 100, type: d.WidthType.PERCENTAGE },
          borders: { ...borders, insideHorizontal: border, insideVertical: border },
          rows: n.children.map((r, i) => new d.TableRow({ tableHeader: i === 0, children: r.children.map((c) => mk(c, i === 0)) })),
        }),
        new d.Paragraph({ children: [] }),
      ];
    }
    case "blockquote":
      return blocks(ctx, n.children, level, 720);
    case "code":
      return n.value.split("\n").map(
        (line) => new d.Paragraph({ ...ind, children: [mkRun(d, line, { mono: true })] })
      );
    case "thematicBreak":
      return [
        new d.Paragraph({
          children: [],
          border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: "CCCCCC", space: 1 } },
        }),
      ];
    default:
      return [new d.Paragraph({ ...ind, children: [mkRun(d, plainText(n), {})] })];
  }
}

function listBlocks(ctx: Ctx, list: List, level: number): Block[] {
  const { d } = ctx;
  const lvl = Math.min(level, 2);
  const instance = list.ordered ? ++ctx.instance : 0;
  const out: Block[] = [];
  for (const li of list.children) {
    const prefix = li.checked === true ? "☑ " : li.checked === false ? "☐ " : "";
    const numbering = { reference: list.ordered ? "ordered" : "bullet", level: lvl, instance };
    let first = true;
    for (const c of li.children) {
      if (c.type === "list") {
        out.push(...listBlocks(ctx, c, level + 1));
      } else if (c.type === "paragraph") {
        const runs = inlineRuns(d, c.children);
        if (first && prefix) runs.unshift(new d.TextRun({ text: prefix }));
        out.push(new d.Paragraph({ numbering: first ? numbering : undefined, indent: first ? undefined : { left: 720 * (lvl + 1) }, children: runs }));
        first = false;
      } else {
        out.push(...blockOf(ctx, c, level, 720 * (lvl + 1)));
      }
    }
  }
  return out;
}

function makeDocument(d: D, children: Block[], title: string) {
  const levels = (format: string, text: (i: number) => string) =>
    [0, 1, 2].map((level) => ({
      level,
      format: format as never,
      text: text(level),
      alignment: d.AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    }));
  return new d.Document({
    title,
    styles: {
      default: {
        document: {
          run: { font: { ascii: "Arial", hAnsi: "Arial", cs: "Nirmala UI", eastAsia: "Arial" }, size: 22, language: { value: "en-IN", bidirectional: "hi-IN" } },
        },
      },
    },
    numbering: {
      config: [
        { reference: "bullet", levels: levels(d.LevelFormat.BULLET, () => "•") },
        { reference: "ordered", levels: levels(d.LevelFormat.DECIMAL, (i) => `%${i + 1}.`) },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1020, bottom: 1020, left: 1020, right: 1020 } } }, children }],
  });
}

export async function buildMinutesDocx(o: { title: string; markdown: string }): Promise<Blob> {
  const d = await import("docx");
  const root = await parseMarkdown(o.markdown);
  const doc = makeDocument(d, blocks({ d, instance: 0 }, root.children), o.title);
  return d.Packer.toBlob(doc);
}

export async function buildTranscriptDocx(o: { title: string; parts: TranscriptPart[] }): Promise<Blob> {
  const d = await import("docx");
  const multi = new Set(o.parts.map((p) => p.speaker)).size > 1;
  const children: Block[] = [
    new d.Paragraph({
      heading: d.HeadingLevel.HEADING_1,
      spacing: { after: 160 },
      children: [new d.TextRun({ text: o.title, bold: true, size: 36 })],
    }),
  ];
  for (const p of o.parts) {
    const runs: Run[] = [];
    if (typeof p.t === "number") runs.push(new d.TextRun({ text: `[${formatDuration(Math.floor(p.t))}] `, color: "666666" }));
    if (multi) runs.push(new d.TextRun({ text: `Speaker ${p.speaker + 1}: `, bold: true }));
    runs.push(new d.TextRun({ text: p.text }));
    children.push(new d.Paragraph({ spacing: { after: 100 }, children: runs }));
  }
  return d.Packer.toBlob(makeDocument(d, children, o.title));
}
