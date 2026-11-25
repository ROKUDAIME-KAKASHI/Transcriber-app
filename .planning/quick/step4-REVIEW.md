# Step 4 (pre-work) review

Fixed on this branch:
- HIGH docx zip bomb: fflate filter trusted the header originalSize (attacker controlled). Now stream-inflates only word/document.xml and aborts once real output passes 10 MB (preworkExtract.ts). Test added.
- HIGH PDF had no limits: added 300-page cap and 30 s timeout.
- MED No magic-byte sniffing: added (%PDF- in first 1 KB, PK for docx, no NUL bytes for txt/md). Size is now also checked on the actual bytes read, not only file.size / headers.
- MED 10-reference cap race: count re-checked after insert; the extra row is soft-deleted and a 400 returned.
- MED Prompt injection: the document could contain the DOCUMENT_START / DOCUMENT_END markers to close the data block; they are now stripped.
- MED Verbatim check passed for tiny quotes (one word); now needs at least 8 characters.
- LOW fflate declared in package.json (^0.8.3, lockfile updated, installed 0.8.3).

Checked and OK: nodejs runtime; owner scoping (plan, list, delete, summarize) with deletedAt filters; multipart/JSON parse failures give 400; extraction errors log only the route and error; per-user limiter applied; chunk cap of 3; lenient JSON parse; migration 5_prework matches the schema (additive, FK cascade, index); Add-to-agenda de-duplicates and respects the 8000 limit, and is disabled offline; PlanPage only passes agenda/onAgenda (user still saves).

Remaining (not fixed):
- Multipart body is fully buffered by formData() before the size check; content-length is checked only when present. Vercel's 4.5 MB body limit bounds this in production.
- Limiter is per server instance and is charged before the AI call, even when it fails.
- Summarize `update` is by id only (after an owned lookup), so a concurrent delete could be resurrected with points; harmless.
