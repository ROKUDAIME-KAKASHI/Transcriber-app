# Transcriber

## What This Is

A meeting transcriber for phones and laptops. A Next.js 16 web app (Neon Postgres, NextAuth, deployed on Vercel at https://transcriber-app-ten.vercel.app) wrapped in a Capacitor 8 Android app whose native foreground service keeps recording with the screen locked. It transcribes on-device for free (Moonshine, Whisper via Transformers.js in a Web Worker) or in the cloud with speaker labels (Deepgram Nova-3), then writes AI Minutes of Meeting / Reports (AICredits GLM Flash or Claude Haiku, fallback Gemini). Used by the owner and people they share the APK with.

## Core Value

Record a whole meeting on a phone, anywhere — with or without internet — and come away with a transcript that says who said what, which can be turned into minutes and shared in one tap.

## Requirements

### Validated

- ✓ On-device transcription: Moonshine Base/Tiny (English, live word-by-word) and Whisper Base (English/Hindi/auto) in a Web Worker, WASM, cross-origin isolated — existing
- ✓ Cloud transcription with speaker labels via Deepgram Nova-3 live WebSocket, server swaps key for 60 s token — existing
- ✓ Android app (Capacitor, `server.url` = Vercel site) with native foreground-service recorder (`RecordingService`, `MeetingRecorderPlugin`) that records Deepgram with the screen off; verified on a Xiaomi phone — existing
- ✓ Per-account meetings (Prisma `Meeting` row per recording, scoped by `userId`), autosave every 5 s with incremental `transcriptTail` PATCH — existing
- ✓ Pause/resume, timestamps, mic picker, level meter, no-sound warning, 10-hour meeting robustness — existing
- ✓ AI Minutes / Report with model picker (GLM Flash / Claude Haiku) — existing
- ✓ Signed release APK (`dist/Transcriber.apk`) — existing
- ✓ Professional neutral redesign (taste rules: single accent, hairline cards) — existing, but the user now finds it too static/plain black

### Active

- [ ] Exports actually work inside the Android app: PDF currently fails ("Couldn't make the PDF. Try Word or TXT instead."), Word and TXT buttons do nothing (blob/anchor downloads don't work in the Capacitor WebView)
- [ ] "Share / Export to" opens the native share sheet (Android, and iOS later) with the minutes or transcript as a file or text: WhatsApp, Drive, Telegram, Messages, copy, etc. Also works on web (Web Share API with files, fallback to download)
- [ ] Offline-first: once the app has loaded once, it opens and records with no internet using the on-device models; meetings are stored locally and synced to the server when online; navigation works offline
- [ ] Online-only features are gated: Deepgram Cloud recording and AI minutes generation only enabled with internet, clearly disabled/explained offline
- [ ] Speaker separation (diarization) for the on-device engines (Moonshine, Whisper) so transcripts and minutes attribute speech to Speaker 1/2/…, ideally fully on-device
- [ ] UI redesign: more alive and active (motion, depth, color, feedback), modern for this generation, attractive yet simple and easy; not "full black and static"; based on research into current design systems/approaches
- [ ] Navigation: tapping the "Transcriber" brand goes home/record; clear back arrows on sub-pages; Android back button behaves; all nav works offline

### Out of Scope

- iOS native build — no Mac/iPhone toolchain here; share-sheet code should be iOS-compatible but an iOS app isn't built this milestone
- Vercel deployment by Claude — the user deploys by pushing; Claude must not run Vercel deploys
- Moving API keys into the APK — keys stay on the server
- Public tunnels — not allowed

## Context

- Repo: `C:\coding\life os\transcriber-app`, remote github.com/ROKUDAIME-KAKASHI/Transcriber-app, pushes to main auto-deploy on Vercel.
- Key files: `src/components/Recorder.tsx`, `MeetingView.tsx` (exports via `download()` blob anchor + html2pdf.js), `MeetingList.tsx`, `AppShell.tsx`, `TranscriptView.tsx`, `ui.tsx`, `src/hooks/useRecorder.ts`, `useNativeRecorder.ts`, `src/lib/speech/*`, `src/workers/speech.worker.ts`, `src/lib/nativeRecorder.ts`, `android/app/src/main/java/in/transcriber/app/recorder/*`, `capacitor.config.ts` (server.url, `mobile/www` offline fallback page), `public/` (service worker exists with an offline page only).
- Android app loads the remote site via `server.url`; Capacitor bridge is injected so native plugins work. Offline today → shows `mobile/www/index.html` "Can't reach the server".
- Testing device: Xiaomi phone over USB (adb). C: drive is nearly full (emulator unusable). Release keystore at `C:/Users/jljga/.android/keystores/transcriber-release.jks` with `android/keystore.properties` (never print passwords).
- Free plans: Vercel Hobby, Neon free.

## Constraints

- **Tech stack**: Next.js 16 App Router + Tailwind v4 + Capacitor 8; keep it — rewriting is out.
- **Security**: never print `.env` / keystore secrets; keys stay server-side.
- **Deploy**: no Vercel deploys or public tunnels by Claude.
- **Storage**: C: drive nearly full — avoid big downloads/emulators.
- **Models**: research agents on Opus; implementation on Sonnet, small tasks on Haiku (user preference).
- **Compatibility**: must keep working as a plain website (laptop browsers) as well as inside the Android app.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Native foreground service for cloud recording in the app | WebView pauses mic when screen locks | ✓ Good |
| Keys stay on server, APK points at Vercel URL | Security | ✓ Good |
| GSD workflow, coarse phases, parallel, commits as it goes | User request this milestone | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-20 after initialization*
