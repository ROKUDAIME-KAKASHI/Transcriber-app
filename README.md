# Transcriber

A standalone, installable (PWA) version of the Life OS meeting transcriber.
Anyone can create an account, record a meeting from any phone or computer, and see
all of their own meetings on every device they sign in from.

It started as part of Life OS and is now its own repository, with its own
`package.json`, database (Neon Postgres) and env file.

## What it does

- **Two transcription engines**, chosen on the Record screen (the choice is remembered per device):
  - **Free · on-device** — [Moonshine](https://github.com/moonshine-ai/moonshine) Base running in the
    browser via Transformers.js. English only, no speaker labels, no API cost, and audio never leaves
    the device. Words appear live as you speak, and each phrase is finalised at the next pause.
  - **Deepgram** — cloud, live word-by-word text with speaker labels (Nova-2), in English, Hindi,
    Tamil, Malayalam, Kannada.
- **"No mic? Try with sample audio"** on the Record screen plays a short public-domain speech
  clip (JFK, 1961, fetched from Hugging Face) through the selected engine instead of the
  microphone, then stops and saves it as a "Sample recording". Handy for demos and for
  browsers or embedded views that block the microphone.
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
The Deepgram key must have the **Member** role or higher to mint tokens. If it doesn't,
recording fails with a clear error; the server never falls back to sending the real key,
because anyone can sign up and would be able to copy it.

## On-device engine (Moonshine)

- The first time someone picks *Free · on-device*, the browser downloads the model from
  Hugging Face and caches it; later recordings load it from the cache in a few seconds.
- Runs in a Web Worker on the CPU (WASM, 8-bit), using up to 4 cores. WebGPU was tried and
  dropped: a 154 MB download and slower per phrase.
- Audio is cut into phrases at pauses (700 ms of quiet), using simple loudness-based voice
  detection (`src/lib/moonshine/voiceChunker.ts`). Long monologues are split after 15 s at the
  quietest moment in the last 1.5 s, so words aren't chopped in half.
- Very noisy rooms can make the voice detection cut phrases badly; switch to Deepgram there.

### Word-by-word live text

Moonshine v1 doesn't stream natively, but it is cheap on short audio. So while someone is
talking, the recorder re-transcribes the phrase so far and shows it as live (grey) text; at the
next pause the finished phrase is transcribed once more and replaces the live text.

- **Finished phrases always come first.** The worker runs final jobs before live previews, and
  keeps only the newest preview. Previews pause while finished phrases are waiting, so a slow
  phone shows fewer live updates but never falls behind on the saved transcript.
- **Self-pacing.** Previews refresh every 350 ms at most, or 1.5× as long as the last preview
  took, whichever is slower. Fast phones update several times a second; slow ones less often.
- **One word behind.** The last word of a live preview is usually cut mid-syllable and misheard,
  so it is held back. The saved transcript has every word.
- **No loops.** Previews use a tighter length cap and block repeated 3-word runs (cut-off audio
  can make the model repeat itself). Final transcripts keep the normal settings, so genuine
  repetitions in speech survive.
- The model does a warm-up run on a second of silence after loading, so the first real phrase
  isn't the slow one.
- Live previews cost extra CPU and battery compared with phrase-only transcription.

### Normal / low-end smartphones

| | Moonshine **Base** (default) | Moonshine **Tiny** (slow phones) |
|---|---|---|
| Download (once) | ~63 MB | ~28 MB |
| Accuracy | best | drops some very short phrases |
| Speed | ~2× slower than Tiny | fastest |

- **Multi-core**: `next.config.ts` sends `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`
  headers so the page is cross-origin isolated, and the ONNX runtime is served from `/ort/`
  (copied from `node_modules` by `scripts/copy-ort.mjs` on `npm install`). Without isolation it
  falls back to one core. If you ever add third-party scripts, images or iframes, they must send
  CORS/CORP headers or the browser will block them.
- **Automatic downgrade**: the worker measures how long each phrase takes compared to its length.
  If, after 3 phrases, it averages more than 0.8× real time, it downloads Tiny in the background
  (Base keeps transcribing meanwhile), switches, and remembers the choice for that phone.
- Phones reporting ≤2 GB RAM (Chrome on Android) start on Tiny straight away.
- If phrases still pile up, the transcript shows "(transcribing… N phrases waiting)". Nothing is
  lost: when you tap Stop, the app finishes the queue before saving.
- Keep the screen on while recording (the app requests a wake lock). iPhones stop the
  microphone when the app goes to the background.

## Run it locally

```bash
cp .env.example .env          # fill in the keys
npm install
npm run db:push               # create tables
npm run dev                   # http://localhost:3001
```

**Database:** the app uses [Neon](https://neon.tech) Postgres. From the Neon console's
*Connect* dialog, put the **pooled** connection string in `DATABASE_URL` (the app uses it)
and the **direct** one in `DATABASE_URL_UNPOOLED` (Prisma uses it for `db push` and migrations).

To work fully offline instead, run `docker compose up -d` (Postgres on port 5433) and set
both variables to `postgresql://transcriber:transcriber_password@localhost:5433/transcriber_db`.

### Test on your phone

Browsers only allow the microphone on HTTPS (or localhost). Run

```bash
npm run dev:phone
```

then open `https://<your-PC's-LAN-IP>:3001` on a phone on the same Wi-Fi and accept the
certificate warning. Set `NEXTAUTH_URL` to that same address.

## Install on a phone

Deploy it anywhere with HTTPS (e.g. Vercel, with the same env vars as `.env`), then:

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
src/hooks/useRecorder.ts      mic → Deepgram socket or Moonshine, autosave, reconnect, wake lock
src/lib/moonshine/            worker client + pause-based phrase chunker
src/workers/moonshine.worker.ts   runs the Moonshine model off the main thread
src/app/page.tsx              Record screen
src/app/meetings/             list + detail (AI, export, rename, delete)
src/app/api/deepgram/token    short-lived Deepgram tokens
src/app/api/meetings/         CRUD + /[id]/process (Gemini)
src/app/manifest.ts, public/sw.js, src/app/api/icons/[size]   PWA bits
```
