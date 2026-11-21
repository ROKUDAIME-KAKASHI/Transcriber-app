---
status: partial
phase: 01-export-share-navigation
source: [01-VERIFICATION.md]
started: 2026-11-21
updated: 2026-11-21
---

## Tests

### 1. Long Hindi meeting exported as PDF on the Xiaomi phone
expected: Real PDF opens, Devanagari shaped correctly, selectable text, no "Couldn't make the PDF" error
result: [pending]

### 2. android.print shim (WR-04)
expected: No IllegalAccessError; if it throws, SHIM_FAILED falls back to the print dialog
result: [pending]

### 3. Native share sheet for TXT, Word, PDF, Share minutes/transcript
expected: Share sheet opens (WhatsApp, Drive, Gmail...) with the file; cancelling shows nothing
result: [pending]

### 4. Old APK without new plugins loading new web code
expected: Exports degrade gracefully (copy text + update hint), no crash
result: [pending]

### 5. Android back key
expected: Closes open sheet first, then goes back; at root minimizes while recording, exits when idle; offline page back exits
result: [pending]

### 6. Deep-linked meeting back arrow and brand link
expected: Back arrow goes to /meetings with no history; brand goes to Record
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0
