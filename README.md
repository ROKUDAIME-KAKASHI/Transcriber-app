# Transcriber

A standalone, installable (PWA) version of the Life OS meeting transcriber.
Anyone can create an account, record a meeting from any phone or computer, and see
all of their own meetings on every device they sign in from.

It lives inside the Life OS repo but is a separate project with its own
`package.json`, database and env file. Life OS ignores this folder.

## What it does

- **Live transcription** with speaker labels (Deepgram Nova-2) in English, Hindi, Tamil, Malayalam, Kannada.
- **Per-account storage**: every recording is a `Meeting` row tied to the signed-in user.
  Nobody can read or edit another account's meetings (every query is scoped by `userId`).
- **Record on many devices at once**: each device creates its own meeting; they all show
  up in that account's *Meetings* list, labelled with the device that recorded them.
- **Autosave every 5 seconds** while recording, plus a save when the app is backgrounded or
  closed, so a dropped call or dead battery doesn't lose the transcript.
- **Auto-reconnect** (up to 3 tries) if the network blips mid-meeting.
- **Screen wake lock** while recording so phones don't sleep and cut the mic.
- **AI documents**: Minutes of Meeting or Report via Gemini, saved on the meeting.
- **Export / share**: TXT, Word, PDF, and the phone's native share sheet.
- **Installable**: web manifest, generated icons, service worker with an offline page.

## Security change vs Life OS

Life OS sends the Deepgram key to the browser (`NEXT_PUBLIC_DEEPGRAM_API_KEY`). That's fine
for a personal app but would let anyone steal the key in a public one. Here the key stays on
the server; `/api/deepgram/token` gives signed-in users a 60-second token instead.
The Deepgram key must have the **Member** role or higher to mint tokens.

## Run it locally

```bash
cd transcriber-app
cp .env.example .env          # fill in the keys
docker compose up -d          # Postgres on port 5433
npm install
npm run db:push               # create tables
npm run dev                   # http://localhost:3001
```

### Test on your phone

Browsers only allow the microphone on HTTPS (or localhost). Run

```bash
npm run dev:phone
```

then open `https://<your-PC's-LAN-IP>:3001` on a phone on the same Wi-Fi and accept the
certificate warning. Set `NEXTAUTH_URL` to that same address.

## Install on a phone

Deploy it anywhere with HTTPS (e.g. Vercel + a hosted Postgres like Neon/Supabase), then:

- **Android (Chrome)**: menu ⋮ → *Install app* (or the install banner).
- **iPhone (Safari)**: Share → *Add to Home Screen*.

## Known limits of a PWA

- On iPhone, recording stops if the user switches apps or locks the screen. Android is
  more forgiving but can also pause. The app autosaves, so nothing already transcribed is lost.
- "Capture tab audio" (Zoom/Meet) only works on desktop browsers, so it's hidden on phones.
- For true background recording and Play Store / App Store listing, wrap this app with
  [Capacitor](https://capacitorjs.com/) later; the backend and APIs stay the same.

## Layout

```
prisma/schema.prisma          User, Meeting
src/hooks/useRecorder.ts      mic → Deepgram socket, autosave, reconnect, wake lock
src/app/page.tsx              Record screen
src/app/meetings/             list + detail (AI, export, rename, delete)
src/app/api/deepgram/token    short-lived Deepgram tokens
src/app/api/meetings/         CRUD + /[id]/process (Gemini)
src/app/manifest.ts, public/sw.js, src/app/api/icons/[size]   PWA bits
```
