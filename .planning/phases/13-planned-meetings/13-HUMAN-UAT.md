# Phase 13: Human UAT

Test on a Vercel preview wired to a Neon preview branch, never production. Check phone width and laptop, light and dark.

## Before 4_planned_meetings is applied
- [ ] Meetings shows no Upcoming section and looks as before; recording and AI minutes work.
- [ ] Opening `/plan?new=1` and saving says "Planning needs a database update"; nothing else breaks.
- [ ] A new booking from a guest still succeeds.

## Apply `npx prisma migrate deploy` on the preview branch, then
- [ ] Meetings > Plan a meeting: fill title, date, time, 45 min, venue, call link, two attendees from People (designation shows), agenda. Save: you land on the saved plan and Meetings > Upcoming lists it with day, time, venue and call icons and the attendee count.
- [ ] A call link like `javascript:alert(1)` is refused; an https link is accepted.
- [ ] Add to calendar: the file opens in a calendar with title, time, location and attendees (phone: share sheet; laptop: download).
- [ ] Share invite: text has title, time in your zone, venue or link, attendees and agenda.
- [ ] Join call opens the link outside the app (Android) or in a new tab (laptop).
- [ ] Series: save with "New series..." Every week, then Plan next in series: the next plan is the same weekday and time, with the same attendees and an empty agenda. Tapping it again says it is already planned. Check one across a daylight-saving change if you can.
- [ ] Record now (and the mic on an Upcoming row): Record shows "Recording: <title> · planned meeting". After Stop, the plan shows Recorded with a link to the meeting, and it leaves Upcoming.
- [ ] The meeting page shows a "Planned meeting" card above the tabs (agenda, attendees, venue or link). Generate Minutes: they list the attendees and follow the agenda items.
- [ ] Airplane mode: recording from a plan still works (title prefilled). Back online, open the meeting: the Planned meeting card appears and the plan is Recorded.
- [ ] Within 30 minutes before a plan, the Record screen shows "Next up" with the title and time and a Record button that starts recording.
- [ ] Cancel meeting asks to confirm, hides it from Upcoming and shows Restore and Delete. Cancelling a booking (as host in Schedule, or as the guest) cancels its plan.
- [ ] A guest booking creates a plan for the host (title "<event> with <guest>").
- [ ] Offline: `/plan` shows "Planning needs internet" with Save disabled; Upcoming is hidden.
- [ ] Admin > Feature switches > Planned meetings off: Upcoming, Next up and the Planned meeting card disappear, `/plan` shows "Planning is paused", recording and bookings still work.
- [ ] Screen reader: duration chips announce as pressed or not; attendee remove buttons name the person.
