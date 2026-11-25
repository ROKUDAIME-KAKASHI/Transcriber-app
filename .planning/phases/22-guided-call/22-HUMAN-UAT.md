# Phase 22: Human UAT

Use a laptop with Chrome, then repeat the main parts in Edge. You need a real Google Meet call (start one yourself and join it from a second device or ask someone to join) and headphones. No migration. Check Admin > Feature switches: "Record an online call" is on.

## Chrome: the happy path
- [ ] Open the Record screen. Under the big button there is a section "Recording an online call?" with a button "Record an online call". The phone and the Android app do not show it.
- [ ] Press the button. A guide opens with 3 pictures: choose the Tab option, pick your call, keep "Also share tab audio" on then Share. Escape or Cancel closes it and nothing starts.
- [ ] Open the call in another tab first. Press the button again, then "Choose the call tab". The browser's share window opens on the tab list. Pick the call tab, keep "Also share tab audio" ticked, click Share.
- [ ] The timer runs and words appear when people speak. Speak yourself and have the other person speak: both are in the transcript. Press Stop: the meeting is saved as usual.

## "Don't show again"
- [ ] Open the guide, tick "Don't show this again on this device", continue. Next time the button opens the browser's share window straight away, with no guide.
- [ ] (To bring the guide back, clear this site's data in the browser or run `localStorage.removeItem("minutely.callGuideHidden")`.)

## Wrong choice
- [ ] Start again and pick a **Window** instead of a tab. Sharing stops at once. A yellow message says "That was a window, not a tab" and how to fix it, with a **Try again** button. No empty meeting appears in the list.
- [ ] Try again and pick **Entire screen**: "That was your whole screen, not a tab".
- [ ] Try again, pick the right tab but **untick "Also share tab audio"**: "No call sound was shared". Try again with it ticked: recording starts.
- [ ] Close the share window without sharing: "Sharing was cancelled" with Try again.

## Muted call / no sound
- [ ] Start recording the call tab, then mute the other people (or pause the video you are playing) and stay quiet. After about 8 seconds a yellow box says "We can't hear the call yet..." with a **Share again** button. The recording keeps running; it never stops by itself.
- [ ] Let sound come back (unmute). The warning disappears within a second or two.
- [ ] Pause the recording while silent: no warning while paused.
- [ ] Mute again until the warning shows, then press **Share again**, pick the call tab with "Also share tab audio" on, click Share. The warning goes, the timer did not reset, and the earlier transcript is still there. Speak: new words are added. Stop: the meeting has both parts.
- [ ] Press Share again and pick a Window: a message explains what to change and the recording carries on.
- [ ] Press Share again and cancel the window: the recording carries on.
- [ ] Click the browser's "Stop sharing" bar while recording: the recording stops and saves (as before).

## Open the call from Minutely
- [ ] Paste a Meet link (https://meet.google.com/...) in the link box: it says "Google Meet link" and the button reads "Open call and record". Press it: the call opens in a new tab, and back in Minutely the guide says "Google Meet is open in a new tab". Go back to Minutely, press "Choose the call tab", pick the Meet tab.
- [ ] Paste a Teams link and a Zoom link: the names show; the Zoom note says to choose "Join from your browser".
- [ ] Type `http://...` or `javascript:alert(1)`: the box says to use a link starting with https:// and the button is disabled.
- [ ] Block pop-ups for the site in Chrome and press "Open call and record": the guide says the browser blocked the tab. Allow pop-ups, try again.
- [ ] Open a planned meeting that has a call link (Plan page > Record): the link is already in the box.

## Edge
- [ ] Repeat: guide, picker on the tab list, wrong choice (window), no sound warning and Share again, open call link.

## Nothing else changed
- [ ] The normal big button still records the microphone only (with the Audio source on "Microphone"). The old "Audio source" selector still offers "Call in a browser tab" and works.
- [ ] Switch the feature off in Admin: the section disappears, the old selector still works. Switch it back on.
- [ ] On the Android app (or a phone), the Record screen looks and records exactly as before.
