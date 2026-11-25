# Phase 14: Human UAT

Test on a Vercel preview wired to a Neon preview branch, never production. Check phone width and laptop, light and dark.

## Before 5_prework is applied
- [ ] Open a saved plan: there is no Pre-work section and everything else works (save, record, share).
- [ ] The meeting page's Planned meeting card shows no reference list.

## Apply `npx prisma migrate deploy` on the preview branch, then
- [ ] Plan page: a Pre-work panel appears with the note that files aren't stored.
- [ ] Add a text PDF: it appears with its size. Add a .docx (try one with Hindi text), a .txt and a .md: all appear.
- [ ] A scanned PDF (image only) says "This PDF has no selectable text (it may be a scan)". A .jpg or .doc is refused. A file over 4 MB is refused with a clear message.
- [ ] Paste text with a name: it appears as a reference. The 11th reference is refused.
- [ ] Summarise: up to 8 short points appear with numbers and dates from the file; Source opens the exact quote. A point with an Unverified badge is not ticked.
- [ ] Untick one, tap Add to agenda: the others appear as "• point" lines under "Background" in the agenda. Tap it again: nothing is duplicated and a message says so. Edit a line, Save: the agenda keeps it.
- [ ] A very long PDF (200+ pages) shows "Text cut at 200k characters".
- [ ] Delete a reference: it disappears and does not come back after a reload.
- [ ] Record from the plan, open the meeting: the Planned meeting card lists the reference names with their point counts.
- [ ] Vercel logs for these requests contain no file text.
- [ ] Offline: Add reference, Paste text and Summarise are disabled with "You're offline".
- [ ] Admin > Feature switches > Pre-work off: the panel and the card's list disappear, plans still work.
- [ ] Screen reader: delete buttons name the file, point checkboxes read the point, the file picker has a label.
