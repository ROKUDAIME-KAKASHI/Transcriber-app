# Phase 14: Pre-work - Summary

**Status:** Complete in code, needs UAT and `5_prework` applied.
**Requirements:** PRE-01, PRE-02
**Flag:** `prework` (default on), Admin > Feature switches > "Pre-work". It also needs `plannedMeetings` on.

## What was built

- **Model** `PlanReference` (plan id with cascade, user id, file name up to 200, MIME type, size, extracted `text` up to 200,000 characters with a `truncated` flag, `points` Json, `summarizedAt`, `deletedAt`). The file itself is never stored, only its text. Migration `prisma/migrations/5_prework/migration.sql` was generated offline with `prisma migrate diff` from main's schema. Additive only.
- **API** (owner-scoped, `no-store`, Node runtime): `GET` and `POST /api/plans/[id]/references` (multipart `file`, or JSON `{fileName, text}` for pasted notes; max 4 MB per file, 10 references per plan), `DELETE /api/plans/[id]/references/[refId]` (soft), `POST .../[refId]/summarize`. 503 "Pre-work needs a database update" before the migration, 503 "paused" when the flag is off. A scanned PDF answers 422 "This PDF has no selectable text (it may be a scan)".
- **Extraction** (`src/lib/preworkExtract.ts`, pure parts in `src/lib/prework.ts`): PDF with `unpdf` (pages merged), DOCX by reading only `word/document.xml` from the zip with `fflate` (guarded against huge entries) and turning `<w:t>` runs into text with paragraph breaks and tabs between table cells (Unicode such as Devanagari kept), `.txt` and `.md` as UTF-8. File contents are never logged; errors log only the route and error name.
- **Summary:** on an explicit tap only. `summaryModel("glm")`, the same per-user limiter pattern as the other AI routes (30 an hour), a prompt that labels the document as data and not instructions, up to 8 short points with an exact `source_quote`. The reply is parsed leniently; a point is verified only when its quote appears word for word in the document (case and whitespace ignored), otherwise it is kept and marked Unverified. Documents over about 40k characters are cut into at most 3 chunks, then merged and de-duplicated (verified first, max 12). Points are saved on the reference.
- **UI:** a "Pre-work" panel on the plan page (saved, not cancelled plans): Add reference (file picker for .pdf .docx .txt .md) and Paste text, the list with size and a "Text cut at 200k characters" note, Summarise, a checklist of points (verified ones ticked) with an expandable source quote, "Add to agenda" which appends "• point" lines under a "Background" heading (no duplicates, respects the 8000 character agenda limit; the user still taps Save), and delete. Disabled offline with a reason. States that files aren't stored. The meeting page's Planned meeting card lists the reference names with their point counts.
- **Tests:** `tests/prework.test.ts` (docx xml to text, normalisation, truncation, lenient parsing, quote verification, merge, chunking, agenda append).

## Dependencies

- Added `unpdf` 2.2.2.
- `fflate` 0.8.3 was already installed through `docx`, so it is imported without being added to `package.json`.

## Deviations

- Unverified points are kept (marked, not ticked) rather than dropped, so the user can still read and use them.
- A document longer than three chunks (about 120k characters) is summarised from its first part only; the app says so.
- The per-user limiter is per server instance like the other AI routes (the existing FailureLimiter), not a shared store.

## Not done / later

- Reading `.doc`, `.pptx`, images or scanned PDFs (no OCR).
- Pre-work on a series' later meetings (references belong to one plan).
