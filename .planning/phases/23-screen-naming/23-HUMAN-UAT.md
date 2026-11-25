# Phase 23: Human UAT (the accuracy check)

Goal: decide with real calls whether reading names off the call screen is accurate enough to offer to other people. Use a laptop with **Chrome or Edge**, headphones, and calls with **2 to 4 people** (ask colleagues to join with their names set the way they normally appear). No migration. Do **not** do this in the Android app.

Check first: Admin > Feature switches > "Read speaker names from the call screen" is on. It does nothing until each device turns on its own switch.

## One-time setup
- [ ] On the Record screen, in "Recording an online call?", or under Profile > Preferences, switch on **Read names from the call screen (beta)**. It is hidden on phones, in the app and in Firefox/Safari.
- [ ] (Better results) Plan the meeting under Plan with the attendees' names spelled as they appear on the call, and start the recording from the plan. The People directory also helps.
- [ ] Cloud or on-device engine both work. Cloud gives speakers sooner; on-device needs a few phrases per voice.

## Per call (3 to 5 calls: at least one Google Meet, one Teams in the browser, one Zoom "Join from your browser")
1. Paste the call link into "Record an online call" (so the platform is known), press the button, and share **the call's tab with tab audio**.
2. A line "Reading names on this device" appears above the transcript. If it says names can't be read on this browser, note the browser version and stop.
3. Have everyone introduce themselves and talk in turns for 5 to 10 minutes. Also try: two people talking over each other, one person presenting their screen, a camera turned off, a guest whose name is a phone number or "iPhone".
4. Watch the chips: a name appears as **probably {name}** after 2 agreeing reads and loses "probably" after 3. Your own voice should become **You** after a few sentences.
5. On purpose, tap one chip and type a different name. It must stay what you typed for the rest of the call.
6. Press Stop. Open the meeting. On the Transcript tab, the **Naming report (beta)** card is at the top.

## Reading the naming report
```
Minutely naming report
Call: Google Meet
Voices found: 3
Names read from the screen: 2 (0 changed by you afterwards, 100% kept)
"You" label on the microphone voice: yes
Screen reads: 14 (usable name 9, rejected 3, no speaking tile found 2, errors 0)
Tile found by: highlight ring 9, speaker view 3
Speaker 2: Priya Nair (confirmed, 4 reads)
Speaker 3: Anita Rao (probable, 2 reads) -> you changed it to Anita R. Rao
```
- **Voices found**: how many people the recording separated. Compare with how many really talked.
- **Names read / changed / kept %**: the headline accuracy. A name you corrected (even a spelling) counts as changed. Renaming after the call also updates the count.
- **Screen reads**: reads attempted. **usable** = a readable name that passed cleaning and confidence. **rejected** = junk, a device name, or too unsure. **no speaking tile found** = neither a ring nor a clear big tile. **errors** = no frame, or the OCR failed.
- **Tile found by**: ring = the platform's highlight was found (what we want); speaker view = the fallback.
- Press **Copy report** and paste it in your notes with: platform, layout (gallery / speaker / spotlight), number of people, and what you saw (was the speaking tile outlined? what colour? where on the tile is the name?).

## What to record for the decision
- [ ] Per call: voices that should have been named vs. named, wrong names (who got whose name), names you had to fix, and whether "You" landed on you.
- [ ] Did the ring colours match (Meet blue, Teams purple, Zoom green)? If the report says "ring 0" although you saw an outline, send a screenshot of the call including the outlined tile so the colours can be tuned (`PALETTES` in `src/lib/naming/highlight.ts`).
- [ ] Any call that never produced a name: platform, layout, browser version.
- [ ] Sanity: only speaker names changed in the transcript; Pause stops the reads (the pulse stops); Stop ends the browser's "sharing" bar and the reading line disappears; with the switch off, nothing at all changes.
- [ ] Network check (DevTools > Network, filter "tesseract"): files come from your own site only (`/tesseract/...`, about 6.7 MB the first time, cached afterwards). No other site is contacted for naming.

## Decision rule (suggested)
Offer the opt-in to other people only if, across the calls, about 3 in 4 automatic names were kept unchanged, a wrong name never stayed on a wrong person without at least being shown as "probably", and no call was disturbed (recording, transcript, share bar). Otherwise tune the palettes and crop from the reports first, or switch the Admin flag off.
