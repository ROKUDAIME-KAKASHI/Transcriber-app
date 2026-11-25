# Phase 15: Human UAT

Test on a Vercel preview wired to a Neon preview branch, never production. Check phone width and laptop, light and dark. Use two Minutely accounts (A and B) for the sharing steps.

## Before 6_calendar is applied
- [ ] Plan page: no Find a time, no conflict warning, no Series settings, no invite button. Save, record, Add to calendar and Share invite work as before; the .ics says `METHOD:PUBLISH`.
- [ ] Profile has no Calendar section. A public booking page still shows and books slots.

## Apply `npx prisma migrate deploy` on the preview branch, then
- [ ] Profile (A and B): a Calendar switch "Let people who add me see when I'm busy" is off by default and the choice survives a reload. Turn it on for B only.
- [ ] A has a planned meeting 3:00 pm tomorrow. Plan another at 3:15 pm: "You already have ... at 3:00 pm" appears, saving still works. Editing the 3:00 pm meeting itself shows no warning against itself.
- [ ] Public booking page of A: the 3:00 pm slot (and the buffer around it) is gone. Booking directly at that time via an old tab says "Someone just took that time".
- [ ] Cancel the 3:00 pm plan: the slot comes back on the booking page.
- [ ] A plans a meeting with B's email and a person with no account: Find a time lists up to 6 times when A and B are free; the other person is listed under "Availability unknown". Tap one: date and time fill in. With B's switch off, B moves to "Availability unknown".
- [ ] A time that B has busy (a plan of B's) is never suggested; times outside either person's working hours are never suggested. Try a 90 minute length.
- [ ] `/api/freebusy` for an address with no account and one that doesn't share give the same answer. More than 10 emails or more than 14 days gives a clear error.
- [ ] Series: open a series plan, Series settings. Change the cadence and see it saved. Set "Keep meetings planned ahead" to 4: four future meetings appear in Upcoming (next 14 days) and in the series. Reload many times: no duplicates. Cancel one occurrence: it stays cancelled and the series reaches one further. Set it to Off: nothing new is added.
- [ ] Two tabs open Meetings at the same moment: still no duplicate occurrence.
- [ ] With email configured: add two attendees with email, Send invites: both get "Invitation: Title · date time" with an .ics that opens in Gmail/Outlook as an invite with an RSVP. The button changes to Send update. Change the time, save, Send update: the same invite updates (not a second event). Cancel the meeting: Send cancellation appears; the invite is removed from their calendars.
- [ ] Attendees without an email are not emailed and the page says how many have one. More than 30 recipients is refused with advice. A 4th send within an hour is refused.
- [ ] Without `RESEND_API_KEY`: the button reads Share invite file and the notice says "Email isn't set up. Share the invite file instead." The share sheet opens with the .ics (Android app and laptop).
- [ ] Hindi title and attendee names appear correctly in the email and the .ics.
- [ ] Offline: Find a time, invites and the series settings are unavailable; saved plans still open.
- [ ] Admin > Feature switches > Calendar off: everything above disappears, booking and planning behave as today.
- [ ] Screen reader and keyboard: suggestion times are buttons with a pressed state, the series sheet closes with Escape and Android back, the conflict message is announced.
