# Minutely (formerly Transcriber)

## What This Is

A meeting transcriber for phones and laptops. A Next.js 16 web app (Neon Postgres, NextAuth, deployed on Vercel at https://transcriber-app-ten.vercel.app) wrapped in a Capacitor 8 Android app whose native foreground service keeps recording with the screen locked. It transcribes on-device for free (Moonshine, Whisper via Transformers.js in a Web Worker) or in the cloud with speaker labels (Deepgram Nova-3), then writes AI Minutes of Meeting / Reports (AICredits GLM Flash or Claude Haiku, fallback Gemini). After a meeting it can extract action items for review, keep a task tracker (`/tasks`), prepare a follow-up agenda, and schedule follow-ups and public booking links (`/schedule`, `/book`), with optional email confirmations via Resend. Used by the owner and people they share the APK with.

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
- ✓ Signed release APK (`dist/Transcriber.apk`, now Minutely 1.2) — existing
- ✓ Exports (TXT, Word, PDF) and native share in the APK and on the web — Phase 1
- ✓ Local-first meetings with idempotent sync, offline shell and feature gating — Phases 2–3
- ✓ On-device speaker labels, renames and speaker-aware minutes — Phase 4 (device UAT pending)
- ✓ Aurora Ink redesign, signed APK release — Phase 5
- ✓ Automatic speaker names from self-introductions — Phase 7 (device UAT pending)
- ✓ Offline recording with the screen locked in the APK — Phase 8 (device UAT pending)
- ✓ Action items, task tracker, follow-up agenda, scheduling and booking pages, profile and in-app update, admin usage dashboard — post-roadmap quick tasks

### Active

- [ ] Device UAT for Phases 4–8 and APK 1.2 on the Xiaomi phone
- [ ] Backlog items in ROADMAP.md (usage limits, booking-to-recording link, reminders, Google Calendar sync, tab-audio capture)

### Out of Scope

- iOS native build — no Mac/iPhone toolchain here; share-sheet code should be iOS-compatible but an iOS app isn't built this milestone
- Vercel deployment by Claude — the user deploys by pushing; Claude must not run Vercel deploys
- Moving API keys into the APK — keys stay on the server
- Public tunnels — not allowed

## Context

- Repo: `C:\coding\life os\transcriber-app`, remote github.com/ROKUDAIME-KAKASHI/Transcriber-app, pushes to main auto-deploy on Vercel. Renamed to Minutely in the UI; the repo name is unchanged.
- Key files: `src/components/Recorder.tsx`, `MeetingView.tsx`, `MeetingList.tsx`, `AppShell.tsx`, `TranscriptView.tsx`, `ui.tsx`, `src/hooks/useRecorder.ts`, `useNativeRecorder.ts`, `src/lib/speech/*`, `src/workers/speech.worker.ts`, `src/lib/nativeRecorder.ts`, `src/lib/scheduling.ts`, `android/app/src/main/java/in/transcriber/app/recorder/*`, `capacitor.config.ts` (server.url, `mobile/www` offline fallback page), `public/` (service worker).
- Android app loads the remote site via `server.url`; Capacitor bridge is injected so native plugins work. Offline today → shows `mobile/www/index.html` "Can't reach the server" only before the first successful load.
- Testing device: Xiaomi phone over USB (adb). C: drive is nearly full (emulator unusable). Release keystore lives outside the repo (secrets never printed).
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
| APK applicationId stays `in.transcriber.app` through the rename to Minutely | Installed APKs update in place; changing the id would need a fresh install and lose local data | ✓ Good |
| Storage keys keep the "transcriber" names (per-user Dexie DB `transcriber-{userId}`, localStorage `transcriber.*`) | Renaming would orphan existing offline meetings and settings on devices | ✓ Good |
| Admin password is stored only as an scrypt hash in the `ADMIN_PASSWORD_HASH` env var | No plaintext secret in the repo or the database | ✓ Good |
| Booking links are public (no sign-in for the guest) | Guests book with a link, not an account | ✓ Good |
| Email is optional via Resend (`RESEND_API_KEY`, `BOOKING_FROM_EMAIL`) | The app works without email configured; bookings are still saved | — Pending (keys not yet set) |

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
*Last updated: 2026-11-25 after rename to Minutely and the post-roadmap quick-task batch*
