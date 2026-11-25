# Meeting Bot Options for Minutely (research, 2026-11-25)

Goal: user pastes a Meet/Zoom/Teams link on a phone; a bot joins, returns audio and, ideally, participant names. Volume 10-40 meeting-hours/month, India-based users.
Confidence: vendor pricing pages fetched today = HIGH. Zoom/Meet/Teams consent behaviour and India region = MEDIUM/LOW (marked below).

## Comparison

| | Recall.ai | MeetingBaaS | Skribby | Nylas Notetaker | Attendee (OSS) |
|---|---|---|---|---|---|
| Price / bot-hour | $0.50 recording (prorated per second). +$0.15 built-in transcription, or BYO. Storage: 7 days free, then $0.05/h for 30 days | From $0.35 (prepaid token packs: $50=100 h, $0.50/h; $0.35/h only at the $1,500 pack). Gladia transcription +0.25 token; BYO key +0.05 | $0.35 base, transcription +$0.39 to $1.36/h by model. Realtime/video/storage +$0.05 each | Free 5 h; Essentials $15/mo for 10 h then $0.80/h; Pro $49/mo for 70 h then $0.70/h | Free software. Hosted plan price not published |
| Free tier / minimum | 5 free hours, no minimum listed | 8 free hours, tokens never expire. Pro $99/mo is only for more bots/day | "No credit card", free amount not stated | 5 h free | Hosted signup free. Self-host needs Django + Postgres + Redis, Kubernetes for prod |
| Platforms | Zoom, Meet, Teams, Webex, GoTo, Slack Huddles | Zoom, Meet, Teams | Zoom, Meet, Teams | Zoom, Meet, Teams | Zoom, Meet, Teams (Webex soon). Older README said Zoom only; docs now claim all three |
| Speaker names | Yes. Participant events (id, display name, can be null) plus speaker timeline; per-participant audio async and realtime (realtime separate audio was Zoom/Teams native bots only, verify) | Diarization included in recording; names not confirmed | Diarization only; names not confirmed on the pricing page | Diarization (AssemblyAI); names unconfirmed | Transcript has speaker_name; Recall's rival page claims a single merged audio track (competitor claim) |
| Webhooks | Svix status webhooks per regional dashboard, plus realtime endpoints | Yes (not detailed) | Yes (not detailed) | Yes | Not in the README I read (roadmap); check the current docs |
| Data region | US-West, US-East, EU, Tokyo. No India. Retention configurable, including zero retention | Not confirmed | Not confirmed | Not confirmed | Self-host anywhere; hosted is US, 30-day minimum retention (per Recall's page) |

Notes
- Recall pricing page: https://www.recall.ai/pricing (fetched 2026-11-25). Regions: https://docs.recall.ai/docs/regions. Retention: https://docs.recall.ai/docs/data-retention. Participants: https://docs.recall.ai/docs/meeting-participants-events.
- MeetingBaaS: https://www.meetingbaas.com/pricing. Skribby: http://skribby.io/pricing. Nylas: https://nylas.com/pricing/ (third-party pages conflict on free hours and overage; trust the pricing page). Attendee: https://github.com/attendee-labs/attendee and https://www.recall.ai/recall-ai-vs-attendee (vendor claims, not neutral).
- Comparison roundup (Nylas blog, biased): https://www.nylas.com/blog/best-meeting-bot-apis/. Vexa is another OSS self-host option (https://github.com/Vexa-ai/vexa), not evaluated here.

## Platform behaviour and bot policies

- **Appearance and refusal:** all of these join as a visible, named participant (you set the bot name, e.g. "Minutely Notetaker"). The host can deny entry or remove it. Nothing here bypasses the host.
- **Google Meet:** by Google's own admin docs, third-party bots such as note takers that use "Ask to join" are denied automatically if the host has turned knocking off. Workspace admins can also block outside participants, and organizers cannot override this. https://support.google.com/a/answer/7304109. So a bot into someone else's company Meet can fail. A meeting hosted in the user's own account, or on personal Gmail with permissive settings, is the reliable case.
- **Zoom:** a bot can join from a link alone but typically waits in the waiting room, and recording needs permission. Recall's docs say the Zoom OAuth integration grants consent, and for all external meetings Zoom app (Meeting SDK) submission is required. Unapproved SDK credentials only work inside your own Zoom account (https://docs.recall.ai/docs/zoom-key-concepts via search result; page itself 404'd, so MEDIUM). Zoom review takes days to weeks (UNCERTAIN). Zoom also shows its own "recording" banner and a host/participant consent prompt.
- **Teams:** bots join as anonymous/guest users and sit in the lobby. Tenant policy can block anonymous joins (not verified in this research; LOW). Teams shows a recording notice.
- Consent display: the platform's native "recording" notice plus the bot's name. Recall also supports a chat message on join (not verified in detail).

## India legal notes (not legal advice)
- DPDP Rules notified 2025-11-13. Notice and consent duties (Rules 3, 5-16) and cross-border processing rules start around May 2027, so most of it is not yet enforceable today. Sources: https://www.legal500.com/firms/237811-saga-legal/c-india/news-and-developments/the-privacy-timer-starts-now-analysing-the-dpdp-rules-and-its-18-month-countdown and https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/ (dates differ slightly between sources).
- Practical: tell participants before recording (bot name, a chat line "recording for minutes"), delete audio after processing. Voices and names are personal data. Recall has no India region (Tokyo is closest; transcription may route to the US per Cronofy's claim, unverified), so audio leaves India. Cross-border transfer is allowed by default under Rule 15 unless the government restricts it.
- Under the Indian Telegraph and IT Acts, one-party-consent recording of one's own calls is generally treated as lawful, but recording others without telling them is a risk (LOW, no source found).

## Cheapest reliable path for 10-40 h/month

Recommendation: **Recall.ai pay-as-you-go, recording only (no Recall transcription), audio into the existing Deepgram pipeline, names from Recall participant events/speaker timeline.**
- Why: it is the only one in the set with documented participant names plus per-participant audio, and it covers Zoom without you building a Zoom OAuth app. It is also the most proven for reliability. The first 5 hours are free.
- Cost: $0.50 per hour for recording, plus Deepgram at about $0.26/h (Nova-3 prerecorded, about $0.0043/min, UNVERIFIED, check your current rate), so about $0.76/h. At 10 h that is about $8/month, at 40 h about $30/month. Use Recall's transcription instead (+$0.15, no Deepgram) for about $0.65/h, or $6.50 to $26. Download media within 7 days to avoid the $0.05/h storage fee.
- Cheaper alternatives: Skribby ($0.35 + $0.39 = about $0.74/h with transcription, so about $3.50 to $14 recording only) and MeetingBaaS (about $0.50/h at small packs, 8 free hours). Both are smaller vendors and speaker names are not documented. Run a 2-3 meeting trial before choosing them. Savings are only $3 to $10/month, so reliability wins at this scale.
- Skip: Nylas (plan fees; $0.70+ per hour and calendar-focused), self-hosting Attendee/Vexa (infra and Zoom app work outweigh a roughly $20/month saving).
- Open risk: Zoom external meetings need recording permission (host click or OAuth/app approval). Meet in locked-down Workspaces will refuse the bot. In that case the fallback is the existing on-phone record path.

## Integration outline (Next.js on Vercel + Neon)
1. Sign-up: recall.ai account, pick **US-East or Tokyo** region (Tokyo is nearer India but Recall's transcription location is unconfirmed). Create an API key and a webhook endpoint in that regional dashboard. A separate key per region.
2. Vercel env: `RECALL_API_KEY`, `RECALL_REGION_BASE` (e.g. `https://ap-northeast-1.recall.ai`), `RECALL_WEBHOOK_SECRET` (Svix signing secret). Existing `DEEPGRAM_API_KEY` is reused. Nothing is committed, and the keys stay server-side.
3. `POST /api/bot/join` (auth required): body `{meetingUrl}`. Server calls `POST {base}/api/v1/bot` with `meeting_url`, `bot_name`, and a recording config for audio plus participant events. Store `{meetingId, botId, status}` in Neon, with the bot id in `metadata`.
4. `POST /api/webhooks/recall`: verify the Svix signature, then on `bot.status_change` update status (joining, in_call, call_ended, done). On done, fetch the bot, then download the audio via the recording's download URL and the participant-events and speaker-timeline artifacts (https://docs.recall.ai/docs/download-urls). Keep the handler short and offload via a queued route or `waitUntil`, because Vercel function time is limited.
5. Send the audio to the existing Deepgram route (diarize on), map Deepgram speaker turns to names with the speaker timeline (time overlap), store transcript segments with names, then run the existing minutes step. Delete Recall media afterward (`DELETE` bot media) and keep audio in your own storage only if needed.
6. UI: "Join a call" field on Record (phone-friendly), status polling, and an inline consent hint ("Bot named Minutely Notetaker will join and record; tell attendees").
7. Effort: about 1-2 days (2 routes, a table, one poll UI), plus a manual test on one Zoom, one Meet and one Teams call. Zoom external meetings may need the Zoom app review first.

## Uncertain / to verify before building
- Recall's exact Zoom consent flow for external meetings and the review timeline (docs page 404'd; summary came via search snippets).
- Whether Recall's realtime per-participant audio now covers Meet bots. Async participant audio is documented.
- India data residency (no Mumbai region found). Deepgram per-hour cost. Skribby/MeetingBaaS name support. Nylas and Attendee numbers that conflict across sources.
