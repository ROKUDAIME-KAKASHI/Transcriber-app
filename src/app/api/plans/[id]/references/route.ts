import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUserId, unauthorized } from "@/lib/auth";
import { logServerError } from "@/lib/serverLog";
import { NO_STORE, badRequest, failed, notFound } from "@/lib/planningDb";
import {
  REFERENCE_SELECT, isPreworkMissing, ownedPlan, preworkMissing, preworkPaused, toReferenceDTO,
} from "@/lib/preworkDb";
import { fileToText, sniffMatches } from "@/lib/preworkExtract";
import {
  MAX_REFERENCES, MAX_REFERENCE_BYTES, capText, cleanFileName, normalizeText, referenceKind,
} from "@/lib/prework";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

const PastedBody = z.object({
  fileName: z.string().max(200).optional(),
  text: z.string().min(1).max(MAX_REFERENCE_BYTES),
});

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const TOO_BIG = "That file is over 4 MB. Use a smaller file or paste the text.";

function unprocessable(message: string): Response {
  return Response.json({ error: message }, { status: 422, headers: NO_STORE });
}

export async function GET(_req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await preworkPaused();
  if (paused) return paused;
  const { id } = await params;
  try {
    if (!(await ownedPlan(id, userId))) return notFound();
    const rows = await prisma.planReference.findMany({
      where: { plannedMeetingId: id, userId, deletedAt: null },
      select: REFERENCE_SELECT,
      orderBy: { createdAt: "asc" },
    });
    return Response.json({ references: rows.map(toReferenceDTO) }, { headers: NO_STORE });
  } catch (err) {
    if (isPreworkMissing(err)) return preworkMissing();
    logServerError("GET /api/plans/[id]/references", err);
    return failed("Couldn't load the reference files. Try again.");
  }
}

/** Add a reference: a multipart file (pdf, docx, txt, md) or JSON {fileName, text} for pasted notes. Only the text is kept. */
export async function POST(req: Request, { params }: Ctx) {
  const userId = await getUserId();
  if (!userId) return unauthorized();
  const paused = await preworkPaused();
  if (paused) return paused;
  const { id } = await params;

  // Vercel rejects bodies over ~4.5 MB; refuse early with a clear message instead.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_REFERENCE_BYTES + 64 * 1024) {
    return Response.json({ error: TOO_BIG }, { status: 413, headers: NO_STORE });
  }

  let fileName: string;
  let mimeType: string;
  let sizeBytes: number;
  let raw: string;
  try {
    if (!(await ownedPlan(id, userId))) return notFound();
    const count = await prisma.planReference.count({ where: { plannedMeetingId: id, userId, deletedAt: null } });
    if (count >= MAX_REFERENCES) {
      return badRequest(`A meeting can have at most ${MAX_REFERENCES} reference files. Delete one first.`);
    }

    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = PastedBody.safeParse(await req.json().catch(() => null));
      if (!body.success) return badRequest("Paste some text first.");
      fileName = cleanFileName(body.data.fileName ?? "", "Pasted notes");
      mimeType = "text/plain";
      raw = body.data.text;
      sizeBytes = new TextEncoder().encode(raw).length;
    } else {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!file || typeof file === "string") return badRequest("Choose a file to add.");
      fileName = cleanFileName(file.name);
      const kind = referenceKind(fileName);
      if (!kind) return badRequest("Use a PDF, Word (.docx), .txt or .md file.");
      if (file.size > MAX_REFERENCE_BYTES) return Response.json({ error: TOO_BIG }, { status: 413, headers: NO_STORE });
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > MAX_REFERENCE_BYTES) return Response.json({ error: TOO_BIG }, { status: 413, headers: NO_STORE });
      if (!sniffMatches(kind, bytes)) return badRequest("That file doesn't look like a " + (kind === "text" ? "text" : kind === "pdf" ? "PDF" : "Word (.docx)") + " file.");
      sizeBytes = bytes.length;
      mimeType = MIME[kind] ?? "text/plain";
      try {
        raw = await fileToText(kind, bytes);
      } catch (err) {
        logServerError("POST /api/plans/[id]/references extract", err);
        return unprocessable(
          kind === "pdf"
            ? "Couldn't read this PDF. It may be damaged or password-protected."
            : kind === "docx"
              ? "Couldn't read this Word file. Save it as .docx and try again."
              : "Couldn't read this file."
        );
      }
      if (!normalizeText(raw)) {
        return unprocessable(
          kind === "pdf" ? "This PDF has no selectable text (it may be a scan)" : "This file has no readable text."
        );
      }
    }
    const { text, truncated } = capText(normalizeText(raw));
    if (!text) return unprocessable("This file has no readable text.");

    const row = await prisma.planReference.create({
      data: { plannedMeetingId: id, userId, fileName, mimeType, sizeBytes, text, truncated },
      select: REFERENCE_SELECT,
    });
    // Re-check the cap after insert so two parallel uploads can't both slip past the earlier count.
    const after = await prisma.planReference.count({ where: { plannedMeetingId: id, userId, deletedAt: null } });
    if (after > MAX_REFERENCES) {
      await prisma.planReference.updateMany({ where: { id: row.id, userId }, data: { deletedAt: new Date() } });
      return badRequest(`A meeting can have at most ${MAX_REFERENCES} reference files. Delete one first.`);
    }
    return Response.json({ reference: toReferenceDTO(row) }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (isPreworkMissing(err)) return preworkMissing();
    logServerError("POST /api/plans/[id]/references", err);
    return failed("Couldn't save the reference. Try again.");
  }
}
