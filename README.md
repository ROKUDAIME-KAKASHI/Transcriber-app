# Transcriber

A standalone, installable (PWA) version of the Life OS meeting transcriber.
Anyone can create an account, record a meeting from any phone or computer, and see
all of their own meetings on every device they sign in from.

It started as part of Life OS and is now its own repository, with its own
`package.json`, database (Neon Postgres) and env file.

## What it does

- **Free, on-device transcription** with two models, chosen on the Record screen (remembered per device):
  - **Fast · English** — [Moonshine](https://github.com/moonshine-ai/moonshine) Base (~63 MB once).
    Quick and light, with live word-by-word text. Best with clear, standard English.
  - **Accurate · Hindi too** — [Whisper](https://github.com/openai/whisper) Base (~77 MB once).
    Better with Indian-accented English, and understands Hindi; language choice English, Hindi
    (written in Devanagari) or Auto (detects each phrase). Slower: live text updates every
    1.5 s or so, and a phrase's final text lands a few seconds after the pause.

  Both run in the browser via Transformers.js: no API cost, and audio never leaves the device.
  No speaker labels.
- **Optional cloud transcription with speaker labels**: **Cloud · speakers** uses
  [Deepgram](https://deepgram.com) Nova-3 over a live WebSocket. It labels who is talking
  ("Speaker 1", "Speaker 2"…), is strong with Indian accents, Hindi and mixed Hindi-English
  ("Auto" = Nova-3's `multi` mode), and needs no model download. It is paid per minute (new
  Deepgram accounts get free credit) and sends audio to Deepgram. Set `DEEPGRAM_API_KEY` on the
  server with a key that has the **Member** role or higher: the server swaps it for a 60-second
  token (`/api/deepgram/token`), so the key itself never reaches the browser. Audio goes through
  the same filter/resampler and is streamed as 16 kHz PCM, so the level meter, no-sound warning,
  pause (with KeepAlive) and timestamps work the same. If the connection drops, the app
  reconnects up to 3 times and holds up to 30 s of audio meanwhile. The AI minutes attribute
  decisions and action items to speakers when labels are present.
- **Live chat view**: the transcript is shown as chat bubbles, one per phrase, both while
  recording and on saved meetings. Words still being spoken appear in a faded bubble with
  typing dots.
- **Microphone picker, level meter and no-sound warning**: choose the input device (Windows
  PCs often have several, and the default can be a silent one), watch the level while recording
  and get a warning if the mic delivers silence for 5 seconds.
- **"No mic? Try with sample audio"** on the Record screen plays a short public-domain speech
  clip (JFK, 1961, fetched from Hugging Face) through the transcriber instead of the
  microphone, then stops and saves it as a "Sample recording". Handy for demos and for
  browsers or embedded views that block the microphone.
- **Built for meetings**:
  - **Pause / Resume** beside Stop, for breaks and side conversations. While paused nothing is
    transcribed and the clock stops; the mic stays open so resuming is instant.
  - **Timestamps**: every phrase stores when it was said (seconds into the meeting, pauses
    excluded). The chat shows a time divider about once a minute, exports have `[mm:ss]` on each
    line, and the AI minutes cite times so you can find things in the transcript.
  - **Correct duration in background tabs**: the clock is computed from wall-clock time, so it
    stays right while you're in the Zoom/Meet tab (Chrome slows timers in background tabs).
  - **Meeting-style AI minutes**: Summary, Decisions, an Action Items table (task, owner, due,
    time), Discussion by topic, and Open Questions. The Report template covers overview, key
    points, decisions & next steps, risks. Meetings over ~3,500 words skip the cleaned "Full
    Transcript" section (it would hit the model's output limit; the raw transcript is on the
    meeting page). The request may run up to 300 s.
- **Per-account storage**: every recording is a `Meeting` row tied to the signed-in user.
  Nobody can read or edit another account's meetings (every query is scoped by `userId`).
- **Record on many devices at once**: each device creates its own meeting; they all show
  up in that account's *Meetings* list, labelled with the device that recorded them.
- **Autosave every 5 seconds** while recording, plus a save when the app is backgrounded or
  closed, so a dropped call or dead battery doesn't lose the transcript.
- **Screen wake lock** while recording so phones don't sleep and cut the mic.
- **AI documents**: Minutes of Meeting or Report, saved on the meeting. Uses [AICredits.in](https://aicredits.in) (`AICREDITS_API_KEY`) when set, with a per-meeting choice of **Economy · GLM Flash** (`z-ai/glm-flash-latest`, default) or **Best · Claude Haiku** (`anthropic/claude-haiku-latest`), otherwise Gemini (`GOOGLE_GENERATIVE_AI_API_KEY`).
- **Export / share**: TXT, Word, PDF, and the phone's native share sheet.
- **Installable**: web manifest, generated icons, service worker with an offline page.

## On-device models

- The first time someone picks *Free · on-device*, the browser downloads the model from
  Hugging Face and caches it; later recordings load it from the cache in a few seconds.
- Runs in a Web Worker on the CPU (WASM, 8-bit), using up to 4 cores. WebGPU was tried and
  dropped: a 154 MB download and slower per phrase.
- Very noisy rooms can make the voice detection cut phrases badly; a close or headset mic helps.

### How audio becomes text

```
mic ─▶ AudioWorklet ─▶ resampler (anti-alias low-pass 7.2 kHz → 16 kHz, 80 Hz high-pass)
                         │
                         ▼
                   phrase chunker ── live preview every ≥350 ms ─▶ worker (partial) ─▶ grey bubble
                   (pause detection)
                         │ phrase ended
                         ▼
                   boost quiet audio ─▶ worker (final, first in line) ─▶ clean-up ─▶ chat bubble ─▶ autosave
```

What each step does for accuracy:

- **Resampler** (`src/lib/speech/resampler.ts`). Mics deliver 44.1/48 kHz; the model wants
  16 kHz. The old straight interpolation folded sound above 8 kHz back into the speech band,
  smearing consonants like *s*, *f* and *t*. It now low-pass filters first (windowed sinc) and
  keeps filter state between chunks, and removes DC offset and mains hum so they don't count as
  speech.
- **Phrase cutting** (`src/lib/speech/voiceChunker.ts`). Speech = louder than 2.5× the quietest
  level in the last 3 s (absolute minimum RMS 0.0006, so very quiet but clean mics still work).
  A phrase ends after 650 ms of quiet, or 1.1 s if it is still under 1.5 s long, so fragments like
  "So, um" join the sentence after them instead of being transcribed without context. Trailing
  silence is trimmed to 350 ms. Long monologues are split after 15 s at the quietest moment in the
  last 1.5 s, so words aren't chopped in half. Quiet phrases are boosted (up to 20×).
- **Clean-up** (`src/lib/speech/cleanText.ts`). If the model gets stuck repeating itself on a
  final phrase, the worker decodes it again with repeated 3-word runs blocked; any loop left is
  collapsed. Punctuation-only results (coughs) are dropped, and phrases start with a capital.

Tested with the sample clip at 100%, 3% and 1% volume: all three come out word-perfect. Before
these changes, 3% lost a word ("As not") and 1% dropped words.

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

### Whisper notes

- Whisper always encodes a full 30-second window, however short the phrase, so each run costs
  the same. Live previews are therefore spaced at least 1.5 s apart (Moonshine: 0.35 s).
- **Whisper Small was tried and dropped**: word-perfect on the sample, but on an 8-core laptop
  (CPU/WASM) it needed ~1.2× real time per phrase, so it falls behind in a live meeting. It
  could come back later via WebGPU on desktops, at a ~0.5 GB download.
- Whisper sometimes invents subtitle-style lines on noise ("Thanks for watching!", "[Music]");
  these are filtered out. "Thank you." is kept, because people say it.
- On the JFK sample, Whisper Base heard "asked not" for "ask not"; Moonshine got it right. The
  sample is American English, so it can't show Whisper's advantage on Indian accents and Hindi.
- Hindi is not tested yet.

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
  Ignoring the first 2 phrases (phones are slow while warming up), if 4 phrases average slower than
  real time it downloads Tiny in the background (Base keeps transcribing meanwhile), switches, and
  remembers the choice on that phone for 3 days, then tries Base again.
- **Microphone settings**: echo cancellation and noise suppression are off. On phones they switch
  the mic into "phone call" mode, which garbles words for speech recognition (and in meetings
  would also cancel the other side's voice from the speaker). Auto gain is on only for Deepgram;
  the on-device path normalises each phrase's loudness itself.
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

### Testing on a phone

Phones need an **https://** address: browsers block the microphone (and the audio processing the
app uses) on plain `http://192.168.x.x`. The Record screen says so if you open it over http.

**Easiest — a tunnel (trusted HTTPS, no warnings, works on mobile data too):**

```bash
npm run dev          # terminal 1
ngrok http 3001      # terminal 2 — open the https://….ngrok-free.app link on the phone
```

While the tunnel runs, anyone with the link can reach your dev server; stop it (Ctrl+C) when done.

**Same Wi-Fi, no tunnel:**

```bash
npm run dev:phone    # https with a self-signed certificate
```

Open `https://<your-PC's-LAN-IP>:3001` on the phone and accept the certificate warning
(Android: *Advanced → Proceed*; iPhone: *Show Details → visit this website*).

Notes:
- `next.config.ts` allows LAN addresses (`192.168.*.*`, `10.*.*.*`, `172.*.*.*`) and ngrok /
  Cloudflare tunnel hosts in `allowedDevOrigins`. Next.js 16 otherwise blocks its dev scripts for
  any host but localhost: the page shows, but **no button works**. If your network uses another
  range, add it there and restart `npm run dev`.
- Sign-in works on any of these addresses with `NEXTAUTH_URL=http://localhost:3001`.

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
src/hooks/useRecorder.ts      mic → on-device transcription, autosave, wake lock
src/lib/speech/               models, worker client, resampler, phrase chunker, text clean-up
src/workers/speech.worker.ts  runs Moonshine or Whisper off the main thread
src/app/page.tsx              Record screen
src/app/meetings/             list + detail (AI, export, rename, delete)
src/app/api/meetings/         CRUD + /[id]/process (AI minutes, see src/lib/ai.ts)
src/app/manifest.ts, public/sw.js, src/app/api/icons/[size]   PWA bits
```
