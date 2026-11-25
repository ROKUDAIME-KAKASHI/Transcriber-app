# Step 1 review (dedupe + history)

Scope: `git diff main..step-1-dedupe-history`. No critical issues found.

## Verified OK
- Soft delete: the only ActionItem readers are the 4 route files; all use `withLive` (list, meeting list, save-time dedupe, PATCH, history). PATCH on a deleted item gives 404. There are no other readers (no agenda/admin queries on ActionItem).
- `withLive` retries once only on P2022, with no loop. A second failure propagates to the route's catch (no raw 500 crash). DELETE falls back to a hard delete on P2022.
- Migration `2_history` is identical to `prisma migrate diff` output from main's schema. It is additive, with the FK cascading and an index on (actionItemId, createdAt).
- History GET is owner-scoped (task ownership check plus `userId` in the events query). Values are capped at 300 chars. `recordEvents` never throws and runs outside any transaction. dueDate (Date or ISO) is formatted as YYYY-MM-DD.
- Focus trap: handles Shift+Tab, focus lost to body (disabled textarea during polish) and an empty focusable list.

## Fixed
- MEDIUM `dedupe.ts` normalize: ZWJ/ZWNJ (Cf) inside Devanagari conjuncts were turned into spaces, splitting words (false negatives). They are now removed. Test added.
- MEDIUM `findTaskDuplicates`: pairwise scan re-normalized both texts per pair (O(n^2) normalizations, run on every tracker edit). Token sets are now precomputed and the per-meeting scan is capped at 200.

## Left (low)
- Owner/note whitespace-only edits record no event (by design).
- `AgendaDraft` duplicates not deduped (documented deviation).
- Extraction review recomputes `matchTask` per render (small lists).
