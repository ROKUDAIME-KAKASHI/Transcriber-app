# Real speaker names for Minutely: every realistic route (research, 2026-11-25)

Goal: for Meet, Zoom and Teams, get (a) the participant list with real names and (b) which named person is speaking when, so minutes say "Rahul: ..." instead of "Speaker 1". This builds on `MEETING-BOT.md` (Recall.ai at $0.50/h) and does not repeat it.
Confidence: HIGH = official docs read today. MEDIUM = vendor docs or snippets, or several forum posts that agree. LOW = a single forum post or my inference.

## 0. Hard limits (true for every option)

- **A normal web page cannot read another tab.** It cannot see Meet's, Zoom's or Teams' DOM, participant list, captions or active-speaker ring. Browser same-origin isolation blocks it, and only an extension (ruled out) or a desktop app can get round that. HIGH (browser security model).
- What a page **can** get: the audio and video of a tab the user shares with `getDisplayMedia` (Minutely already uses this for tab audio). The video frames show the meeting UI, so names on tiles and captions could in theory be OCR'd. See 6c.
- **Phones:** none of the platforms lets another app on the phone read the Meet, Zoom or Teams app. On a phone, names come only from a **bot** (server side), from **platform APIs after the meeting**, or from Minutely's own diarization plus enrolment or AI naming. HIGH.
- **Meetings hosted by other organisations:** platform APIs (Meet REST, Graph, Zoom recordings) return data only for meetings the user's account or tenant owns or attended, under that org's admin settings. Bots are the only route that does not depend on the host org's API settings, and a host can still refuse or remove a bot.

## 1. Hosted meeting-bot APIs (corrections and updates to MEETING-BOT.md)

| | Names + per-speaker timeline | Meet / Zoom / Teams | Calendar auto-join | Notes |
|---|---|---|---|---|
| **Recall.ai** | **Yes on all three.** "Perfect diarization" transcribes each participant's **separate audio stream** and labels it with the participant name, real-time and async, on Zoom, Teams and Meet. Speaker-timeline diarization (the platform's active-speaker events on mixed audio) also returns names. A speaker timeline JSON (`participant {id,name}`, start/end timestamps) is in the Participant Events artifact. HIGH: https://docs.recall.ai/docs/diarization, https://docs.recall.ai/docs/speaker-timeline | Yes (Webex has no separate streams) | **Yes.** Calendar V1 (Recall decides when to send bots from user preferences) or V2 (your app decides). Google and Outlook. **You create your own Google/Microsoft OAuth client.** Google needs `calendar.events.readonly` (a *sensitive* scope): verification with a demo video, about 3-5 business days, **no CASA**. HIGH: https://docs.recall.ai/docs/calendar-integration, https://docs.recall.ai/docs/calendar-v1-google-calendar, https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification. Extra calendar fee: not found (LOW) | Limits: several people on one room mic show up as one name. Teams mixed-stream transcripts need "Automatically identify me in meeting captions" on. Screen-share audio has no speaker events |
| **MeetingBaaS** | Per-participant recordings are claimed, but only by a competitor page (https://www.recall.ai/recall-ai-vs-meetingbaas). Own docs not found. LOW | Yes | Has a calendar product (not verified) | Trial before trusting |
| **Skribby** | Not documented | Yes | Unknown | Unchanged from the earlier note |
| **Attendee (OSS)** | Claims per-participant audio and "perfect diarization" for Zoom and Meet. **Its Zoom path uses Zoom RTMS.** MEDIUM: https://docs.gladia.io/chapters/integrations/attendee | Yes | No | Self-host cost and work, as before |
| **Vexa** | Transcript segments carry a `speaker` name field. Vexa's own validation with real participants on Meet, Teams and Zoom is "pending". Hosted at about **$0.30/h**, with $5 free credit. MEDIUM-LOW: https://github.com/Vexa-ai/vexa, https://docs.vexa.ai/api/meetings | Meet, Teams, Zoom (Zoom newest) | Per-meeting auto-join toggle | Cheapest, least proven |

**Big correction for Zoom (applies to every bot vendor):** since about March 2026, Zoom Meeting SDK bots joining meetings **outside your own Zoom account** need an **OBF token**. That means:
1. **Your Zoom app must pass Zoom app review.**
2. **The user must authorise it with Zoom OAuth.**
3. **That user must be in the meeting.** The bot is removed when they leave.

So a Zoom bot can "come along with" the user to any Zoom meeting they attend, but it **cannot attend a Zoom meeting in their place**. HIGH: https://developers.zoom.us/docs/meeting-sdk/auth/obf/, https://developers.zoom.us/docs/meeting-sdk/get-credentials/, https://docs.recall.ai/docs/zoom-obf. Review timeline is not published (LOW, days to weeks).

Visible bot: yes, always, as a named tile. Works from a phone: yes, because the bot is server side and the phone only pastes a link or relies on the calendar.

## 2. No-bot desktop SDKs

**Recall.ai Desktop Recording SDK**
- **What it does:** an npm package **for Electron apps**, on Windows and Apple-Silicon Mac. It detects Zoom, Teams and Meet windows on the user's computer (Meet in Chrome included), records them, and uses OS accessibility APIs to detect who joined and who is speaking. Transcripts come out with names, and there is no bot tile. HIGH: https://docs.recall.ai/docs/desktop-sdk, https://docs.recall.ai/docs/desktop-recording-sdk-faq, https://docs.recall.ai/docs/desktop-recording-sdk-vs-native-and-cross-platform-apis
- **Caveats:**
  - No participant emails.
  - A browser meeting must stay the active tab, or video capture stops unless Picture-in-Picture is open.
  - On Windows the meeting window must be on the current virtual desktop and not minimised.
  - **No mobile.**
- **Cost:** same as bots, $0.50/h. HIGH: https://recall.ai/pricing
- **Effort:** a new Windows/Mac Electron app (installer, code signing, auto-update), about 1-2 weeks. It is not a web page. Works for meetings hosted by anyone, because it reads the user's own screen. No platform review.
- **Verdict:** best fidelity for laptop users without a bot, but it is "another app to install" (similar friction to an extension), and it does nothing for phones.

## 3. Zoom

**Zoom RTMS (Realtime Media Streams)**
- **What it does:** Zoom pushes live audio over WebSocket to your server, with **separate per-participant audio**, a mixed track, a **diarized transcript** ("who said what, when"), and participant join/leave events. No bot tile. HIGH: https://developers.zoom.us/docs/rtms/meetings/
- **What it needs:**
  - A **General app** on Zoom Marketplace.
  - **Developer Pack credits.** Rates seen in forum posts: 0.01 credit/min for audio (about $0.60/h) and 0.02 credit/min with transcript (about $1.20/h). MEDIUM: https://devforum.zoom.us/t/rtms-credit-consumption-per-minute-and-whether-the-initiating-participant-needs-a-paid-plan/145391/2, https://www.zoom.us/pricing/developer
  - Functional **and security review** before other accounts can use it. MEDIUM: https://devforum.zoom.us/t/rtms-licensing-for-a-marketplace-app-whose-account-needs-the-developer-pack/147319
  - Pro, Business or Enterprise; **Basic accounts aren't supported** (same source, MEDIUM). Another reply says the initiating participant can be on Basic if verified (LOW).
- **Meetings hosted by others:**
  - The host's account admin must enable "Share realtime meeting content with apps".
  - The **host gets an approve/deny prompt** unless they chose "Always allow".
  - A participant start can fail with error 2308 unless the user is on the invite list.
  - MEDIUM: https://developers.zoom.us/blog/rtms-permissions-and-auto-start-controls/, https://devforum.zoom.us/t/error-2308-when-starting-rtms-via-rest-api-as-a-participant-in-an-external-meeting/144673
- **Effort:** heavy. You need a long-lived WebSocket consumer, which does not fit Vercel serverless, so you would need a separate small server, or Recall's RTMS hosting (https://developers.zoom.us/blog/rtms-recall-ai-guide/). Phone: yes, server side, but the user must start it or auto-start it from their Zoom account.

**Zoom cloud recording transcript API**
- **What it does:** after the meeting, the host's cloud recording includes an "audio transcript" `.vtt` file, plus `recording.transcript_completed`. Pro or higher with cloud recording and audio transcript switched on before recording. HIGH-MEDIUM: https://www.zoom.com/en/products/virtual-meetings/support/audio-transcription/, https://developers.zoom.us/docs/build/cloud-recording/
- **Names:** the VTT usually carries speaker display names. Forum posts warn that names aren't guaranteed (MEDIUM-LOW: https://devforum.zoom.us/t/unable-to-get-speaker-name-in-transcript-file/146748).
- **Scope:** **only meetings the user hosts**. A user-level OAuth app works unpublished for the developer's own account, and needs Marketplace review for others. Cheap (free with Pro), post-meeting only, and the AI Companion transcript has no API (https://devforum.zoom.us/t/vtt-via-api-feature-request-update-ai-companion/142850).

## 4. Google Meet

- **Meet REST API (GA):**
  - `conferenceRecords.participants` gives display names. `participantSessions` gives join/leave times.
  - `transcripts.entries` gives text, a **participant** link and a start time, which is a named speaking timeline.
  - Since Feb 2025, **all meeting participants** (not only the owner) can list conference data and participants.
  - Entries are kept for 30 days.
  - Scope `meetings.space.readonly` is **sensitive** (verification, no CASA). Downloading the Docs transcript file needs `drive.meet.readonly` or `drive.readonly`, which are **restricted** (CASA security assessment, yearly), so use the entries API instead.
  - HIGH: https://developers.google.com/workspace/meet/api/guides/artifacts, https://developers.google.com/workspace/meet/api/guides/authenticate-authorize, https://developers.google.com/workspace/meet/release-notes
- **Catches:**
  - A transcript exists only if someone turned on Meet Transcripts, which needs the **host on a paid Workspace edition**: Business Standard or higher, or Workspace Individual. HIGH: https://support.google.com/meet/answer/12849897
  - Personal Gmail hosts get the participant list only. Whether the REST API works fully for free consumer accounts is MEDIUM-LOW.
  - In other orgs, their admin policies apply.
  - Post-meeting only.
  - **Visible bot:** none. **Phone:** yes, server side.
  - **Effort:** small, about 1-2 days on top of the existing Google sign-in.
- **Meet Media API (real-time per-participant audio):** **deprecated on 2026-10-28; endpoints shut down on 2027-01-15.** It never left Developer Preview and required **every participant** to be enrolled in the preview. **Do not build on it.** HIGH: https://developers.google.com/workspace/meet/release-notes, https://developers.google.com/workspace/meet/media-api/guides/get-started
- **Meet Add-ons SDK (side panel / main stage):** it embeds your web page inside Meet. The overview documents no participant list, active-speaker or audio access. The SDK centres on co-activity and frame messaging (MEDIUM: https://developers.google.com/workspace/meet/add-ons/guides/overview). It needs Workspace Marketplace publishing, and Android support is limited. It does not solve names.

## 5. Microsoft Teams

- **Graph transcripts:**
  - `onlineMeeting/transcripts` returns `.vtt` with speaker names. "Speaker attribution" is a separate tenant-admin switch; when it is off you get text with no speakers.
  - Permission `OnlineMeetingTranscript.Read.All` is delegated (work accounts) or application. App-only access also needs an **application access policy** set by the tenant admin.
  - **Personal Microsoft accounts are not supported.**
  - It covers meetings in your own tenant (organizer or attendee). Attendees reading another tenant's meeting get 403 (LOW: https://learn.microsoft.com/en-ca/answers/questions/5809464/graph-api-returns-403-on-meeting-transcript-for-fo).
  - Not metered since 2025-08-25.
  - Transcription must be turned on in the meeting.
  - **Admin consent is needed in each customer tenant** (MEDIUM; `.Read.All` permissions normally need it).
  - HIGH: https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/meeting-transcripts/overview-transcripts, https://learn.microsoft.com/en-us/graph/api/onlinemeeting-list-transcripts
- **Attendance reports** (Graph `meetingAttendanceReport`): names and join/leave times for the organizer's meetings. No speaking timeline (MEDIUM).
- **Meeting side-panel apps (Teams JS):** these can get meeting context and the participant role, not live active speaker or audio (MEDIUM). Not useful for this.
- **Real-time media bots (application-hosted):** C# on .NET Framework, **Windows Server VMs in Azure** with a public IP per instance, `Calls.AccessMedia.All` with admin consent. Weeks of work plus an always-on VM (about $50-150/month). Not feasible for this app. HIGH: https://learn.microsoft.com/microsoftteams/platform/bots/calls-and-meetings/requirements-considerations-application-hosted-media-bots
- **Practical value:** small. Indian users joining client meetings are usually guests in someone else's tenant, so Graph only helps the user's own M365 org with an admin who consents.

## 6. Other routes (no extension, no platform approval)

| Option | Names | Who speaks when | Phone | Effort | Notes |
|---|---|---|---|---|---|
| **a. Calendar attendees as the name list** (Google/Outlook calendar, `calendar.events.readonly`, sensitive scope, no CASA) | Invitee names and emails | No | Yes | 1-2 days | Gives the candidate names. Dial-ins and forwarded guests are missing |
| **b. AI naming of Deepgram speakers** (LLM reads the transcript plus the candidate list: "Thanks Rahul..."; user confirms in a "Who is Speaker 2?" chip; remember per meeting series) | Often | Yes, via Deepgram turns | Yes | 1-2 days | Cheap, works everywhere including in-person. Accuracy varies, so always let the user fix names |
| **c. OCR the shared tab** (Minutely already gets the tab via `getDisplayMedia`; also take the video track, sample about 1 fps, OCR the name label next to the speaking indicator or **Meet/Zoom/Teams live captions**, which print "Name: text") | Yes | Yes (roughly) | **No** (laptop only) | 1-2 weeks, fragile | Breaks with every UI change and language. Captions must be on. Picture-in-Picture or a hidden tab reduces frames. Experimental only (LOW) |
| **d. Voice enrolment** (WeSpeaker embedding per person, as planned in CLAUDE.md; match Deepgram/on-device clusters to saved voiceprints of regular colleagues) | Yes, for enrolled people | Yes | Yes | 1 week | Best for recurring internal meetings. Voiceprints are biometric personal data under DPDP, so ask for explicit consent |
| **e. Picture-in-Picture tricks** | No | No | No | n/a | Document PiP only shows *your* page. It cannot read the meeting |

## Recommendation for Minutely

1. **Build first, no approvals, works on phone and web, all three platforms: 6a + 6b + 6d.** Calendar names seed the list. Deepgram diarization plus LLM name suggestions plus voice enrolment turns "Speaker 1" into a name. The user confirms with one tap. This reaches maybe 80% of the goal for about 1-2 weeks of work and near-zero running cost.
2. **For the "agent joins and knows who's talking" experience: Recall.ai bots + Recall Calendar V2 auto-join.** This is the only route that gives **true named per-participant timelines on Meet, Zoom and Teams** with server-side work that fits Vercel (webhooks plus downloads). About $0.50/h recording, or +$0.15/h for Recall transcription. About 3-5 days of work beyond the earlier bot plan.
   - **How automatic:**
     - **Meet and Teams:** fully automatic from the calendar, but the host can deny entry and locked-down orgs auto-deny.
     - **Zoom:** only with a **reviewed Zoom app + user Zoom OAuth (OBF), with the user present in the meeting**.
3. **Optional cheap extras:** the Meet REST API participants and transcript entries (sensitive scope only) for meetings on the user's paid Workspace, and Zoom cloud-recording VTT for meetings the user hosts on Pro. Post-meeting only.
4. **Skip:**
   - Meet Media API (shutting down 2027-01-15).
   - Meet add-on (no participant data).
   - Teams real-time media bot (Windows/Azure).
   - Zoom RTMS for now: it needs review + Developer Pack + host approval + a persistent server, and Recall covers it.
   - Recall Desktop SDK: only if many laptop users refuse bots; it needs an Electron app.

**What the owner must sign up for or get approved**
- **Recall.ai account** (choose a region; 5 free hours).
- **Google Cloud OAuth app verification** for `calendar.events.readonly`. Plus `meetings.space.readonly` if the Meet REST API is used. Both are sensitive scopes: a demo video, about 3-5 days, no CASA. Avoid Drive scopes, which are restricted and need CASA.
- **Microsoft Entra app** (multi-tenant, `Calendars.Read`, user-consentable in most tenants, MEDIUM), only for Outlook calendar auto-join.
- **Zoom Marketplace General app + review** (OBF `user:read:token` scope) so bots can join Zoom meetings hosted by others.
- A recording-consent message for the bot, plus DPDP consent for voiceprints.

**Impossible (honest list)**
- A web page or phone app reading the participant list or active speaker of a Meet, Zoom or Teams tab or app.
- Real names with no bot, no extension, no desktop app and no host-side API, except by inference (6b, 6d).
- A Zoom bot attending a meeting hosted by an external account without the user present (OBF rule).
- Guaranteed bot entry into another org's Meet or Teams (the host or admin can deny it).
- Per-speaker names for several people sharing one conference-room mic (every route sees one participant).
- Real-time per-participant Meet audio via Google's API after 2027-01-15.
