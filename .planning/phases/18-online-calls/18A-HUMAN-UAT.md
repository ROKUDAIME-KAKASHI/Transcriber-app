# Phase 18A: Human UAT

Laptop only (Windows). Use a preview or the live site; no migration needed. Use headphones for every call test. Use Cloud for the speaker-label checks and one run each of Moonshine and Whisper.

## Chrome and Edge on Windows
- [ ] Record screen: "Audio source" shows Microphone | Call in a browser tab. Pick the tab option: the "Also record my microphone" switch (on), the headphones hint and (on an on-device engine) "Speaker labels work best with Cloud" appear. The older "Also capture tab audio" checkbox is gone.
- [ ] Google Meet tab: Record, pick the Meet tab, tick "Share tab audio". Recording starts, the level meter and orb move when the other side speaks, the transcript has both sides (you via the mic). Stop gives a normal saved meeting.
- [ ] Zoom web client tab: same.
- [ ] Microsoft Teams web tab: same.
- [ ] Mic switch off: only the other side is transcribed, not your own voice.
- [ ] Cloud: speaker labels separate the other people on the mix. Moonshine and Whisper both produce a transcript.
- [ ] Share without ticking "Share tab audio" (or pick a window): recording does not start, message "No tab audio was shared. Choose the call's tab and tick 'Share tab audio'." Mic-only still works afterwards.
- [ ] Cancel the picker: a message about sharing being cancelled; no empty meeting left behind.
- [ ] Click the browser's "Stop sharing" mid-call: the recording stops by itself, saves, and the status says "Sharing stopped — recording saved". The meeting opens with what was said.
- [ ] Close the shared tab mid-call: same as Stop sharing.
- [ ] Pause and resume during a tab recording: the clock pauses and audio from the paused time is not transcribed.
- [ ] Long run (30+ minutes): audio keeps flowing and the screen does not sleep.
- [ ] Mic-only recording (default source) behaves exactly as before, with and without the flag.

## Planned meeting
- [ ] A plan with a Meet/Zoom/Teams link starting soon: on the Next-up card tap Record. The source switches to "Call in a browser tab" with a "Join call" link; nothing starts until you press the main Record button. Join call opens the link in a new tab.
- [ ] Open `/?plan=<id>` of a call plan: same preselection and link. A plan without a link keeps Microphone.
- [ ] A link that is not http(s) shows no Join call link.

## Where it must be hidden or clear
- [ ] Firefox: selector hidden, or a clear "can't share tab audio" message; mic recording still works.
- [ ] Safari: same.
- [ ] Android app, phone browser and tablet: no selector.
- [ ] Admin > Feature switches > tabAudio off: selector gone, old checkbox back.
- [ ] Keyboard: arrow keys move through the source control; the switch and Join call link have visible focus; a screen reader announces "Audio source".
