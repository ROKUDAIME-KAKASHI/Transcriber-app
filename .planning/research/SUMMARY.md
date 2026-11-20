# Project Research Summary

**Project:** Transcriber (Next.js 16 web app + Capacitor 8 Android shell)
**Researched:** 2026-11-20
**Confidence:** MEDIUM-HIGH

## Executive Summary

Brownfield milestone. Exports/share are broken in the APK for platform reasons: Android WebView has no `navigator.share`, ignores blob anchor downloads, and html2pdf.js (html2canvas) crashes on Tailwind v4 `oklch()`. Replace with Capacitor Filesystem (Cache, base64) + Share, a real DOCX, and native print-to-PDF.

Keep `server.url` (do NOT bundle the app into the APK). Offline = service worker on the Vercel origin (Capacitor 8 injects the bridge into SW-served same-origin documents — verified in source). Routes become static client shells reading IndexedDB (Dexie); server becomes a sync target with client IDs and idempotent upserts. Diarization: WeSpeaker ResNet34 int8 (6.7 MB) embedding per VAD phrase in the existing worker, online centroid labels, re-cluster at stop; store embeddings only, never audio.

Key risks: web/APK version skew (guard all plugins with `isPluginAvailable`; ship all plugins in one APK); SW hazards (cached auth redirects, chunk skew after deploy, skipWaiting mid-recording, COOP/COEP loss); on-device engines stop when the screen locks (offline locked recording is a stretch phase); diarization/motion CPU cost on the Xiaomi phone.

## Key Findings

### Recommended Stack (additions)
- `@capacitor/share` 8.0.3, `@capacitor/filesystem` 8.1.5, `@capacitor/app` 8.1.2, `@capacitor/network` 8.0.1, `@capacitor/haptics` — one APK rebuild
- `@serwist/turbopack` + `serwist` 9.5.15 (Next 16 Turbopack; `@serwist/next` needs webpack) — or a hand-written SW with a build manifest
- `dexie` 4.4.7 + `dexie-react-hooks` 4.4.0
- `docx` 9.16.0 (lazy) + mdast mapper (mdast-util-from-markdown/gfm already in tree)
- Custom Capacitor plugin `DocumentExport.htmlToPdf` (Android print-to-PDF; correct Devanagari, selectable text); web uses a print iframe. Remove html2pdf.js. jsPDF/pdf-lib have no Devanagari shaping.
- WeSpeaker ResNet34 int8 (+ optional pyannote-segmentation-3.0 int8) on the already-shipped ORT WASM / transformers.js 4.3.2; ~80 LOC clustering
- Motion: CSS-first (Tailwind v4, `@starting-style`, `tw-animate-css` 1.4.0); `motion` 14.x LazyMotion only where needed

### Expected Features / Design ("Aurora Ink")
- Dark: bg `#0E0F17`, surface `#171926`, accent `#8EA2FF`, record `#FF6369`. Light: bg `#F7F7FB`, surface `#FFFFFF`, accent `#3651F5`, record `#E5484D`. Geist Sans/Mono. Motion tokens 120/200/320/500 ms, spring easing. Glass only on floating chrome.
- Recorder hero: mic-reactive orb, record→rounded-square stop morph, 56-bar scrolling waveform, haptics; calm mode while recording.
- Table stakes: TXT/DOCX/PDF via one `shareOrDownload`, native share, share-as-text, copy; offline pill with disabled+reason gating; back chevron, brand→/, Android back handler; speakerNames map with rename-all; list with date groups, status/sync chips, empty states.
- Anti-features: heavy glass everywhere, ambient animation, hiding offline features, pure black default, many export formats up front.

### Architecture
1. Service worker (scope `/`): precache shells, `/_next/static`, `/ort`; navigations network-first with cached fallback; RSC network-only (Next falls back to full navigation); never touch `/api/*`; no auto skipWaiting; keep COOP/COEP on fallbacks. Don't use Serwist `defaultCache`; don't enable `experimental.useOffline`.
2. meetingStore (Dexie) + syncEngine: partChunks, embeddings, persisted `savedParts` cursor; field ownership (device owns transcript, server owns AI doc, title LWW); tombstones; 401 pauses queue; reuse `transcriptTail` + 409 resend.
3. AuthGate (cached last-known user; network error ≠ signed out) + connectivity (`/api/health` probe) + FeatureGate `{enabled, reason}`.
4. Diarizer in speech worker, low priority, skip when backlog high; phrases <1 s inherit previous speaker.
5. export builders + deliver + nativeBridge + PageHeader/BackButtonBridge.
Meeting page moves to `/meeting?id=` with `/meetings/[id]` redirect.

### Critical Pitfalls
1. Blob downloads / navigator.share dead in WebView → Filesystem+Share.
2. PDF: oklch crash + anchor save → native print-to-PDF; test long Hindi.
3. Version skew → feature detection, "Update the app".
4. SW breaking the app → static shells, build-integrated precache, network-only RSC, user-triggered updates.
5. Offline ≠ screen-off recording → be honest; stretch phase.
6. Sync duplicates/truncation → client UUIDs, persisted cursor, single owner.
7. Diarization memory/consistency → embeddings + global clustering; benchmark first.
8. Motion vs inference → transform/opacity only, CSS var meter, calm mode, reduced-motion toggle.

## Implications for Roadmap

1. **Export/Share + Navigation + native plugins (one APK)** — independent, quickest win.
2. **Local-first data layer, sync, server API** — needed by 3 and 4; safe to ship alone.
3. **Offline shell, auth, gating** — needs 2; riskiest; research needed (Serwist/Next 16).
4. **On-device diarization** — needs 2; parallel with 3; starts with device spike.
5. **Aurora Ink UI redesign + motion** — after screens settle.
6. **Stretch: screen-off on-device recording** (native PCM capture).

### Research Flags
- Phase 3, Phase 4, Phase 6 need phase research; Phase 1 PDF plugin needs an early prototype (fallback `PrintManager.print()`).

## Gaps to Address
- PDF approach conflict resolved in favour of native print-to-PDF.
- Is ORT single-threaded in the APK (`crossOriginIsolated`)? Check on device; androidx.webkit 1.18 allowlist optional spike.
- `navigator.storage.persist()` in WebView unproven.
- Diarization thresholds (cosine 0.5–0.6) need tuning on real recordings.
- Sync batching (≤2000 parts, 4.5 MB body limit).

---
*Research completed: 2026-11-20 | Ready for roadmap: yes*
