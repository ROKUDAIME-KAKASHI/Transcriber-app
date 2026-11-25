# Phase 17: Human UAT

Test on a Vercel preview wired to a Neon preview branch, never production. No migration is needed. Check phone width and laptop, light and dark. Have: a recorded meeting made from a plan in a weekly series, a recorded meeting with no plan, and tasks in each state (blocked, overdue, in progress, not started, done), some owned by People entries.

- [ ] Meeting from a series plan, Action items tab: "Plan next meeting" sits next to "Prepare follow-up agenda". Tap it: toast "Next meeting planned · N tasks carried over", the plan page opens on the next date of the series (same weekday and time) with the same title, length, venue, link and attendees.
- [ ] The agenda starts "Carried over from <title> (<date>)", lists blocked, then overdue, then in progress, then not started tasks (owner names from People), no done tasks, and ends "Any new discussion topics".
- [ ] Go back and tap it again: "Next meeting is already planned", same plan, agenda unchanged (no repeated lines).
- [ ] If the series already had that occurrence auto-planned (keep ahead), that meeting is reused, not duplicated.
- [ ] Edit the agenda by hand, mark one more task done in Tasks, plan next again: your text stays, no duplicates, the done task is not added.
- [ ] Carried-over tasks panel on the new plan: shows the open tasks with status chips; change a status with the select (it updates in Tasks); set one to Done and it disappears; when all are done it says so.
- [ ] Recorded meeting with no plan: "Plan next meeting" creates a plan one week later at the same time in your time zone; the plan page offers "Make this a series"; tapping it opens the new-series fields with the title filled in; Save creates the series.
- [ ] Plan page of a RECORDED plan: Actions show "Plan next meeting" (not "Plan next in series"). A PLANNED series plan still shows "Plan next in series".
- [ ] Follow-up agenda sheet (Prepare follow-up agenda): "Plan next meeting" next to "Schedule follow-up" closes the sheet and opens the new plan. Its agenda comes from the saved tasks, not from your edits in the sheet.
- [ ] On the new plan: Find a time, attendees, Share invite and email invites work as for any plan.
- [ ] Open the next meeting after recording it: the linked-plan card says "Follow-up of <previous meeting>" and links to it. A meeting with no series shows no such line.
- [ ] Offline: the buttons are disabled with "Planning needs internet"; the panel is hidden.
- [ ] Before the planning migrations are applied (old Neon branch): the button shows the "Planning needs a database update" toast; nothing else breaks.
- [ ] Admin > Feature switches > "Plan next meeting" off: no button, panel or "Follow-up of" line anywhere; Plan next in series is back on recorded plans.
- [ ] Another account cannot plan from, or read tasks of, your meetings (try the API URLs with a second login: 404).
- [ ] Keyboard and screen reader: the buttons have visible focus, each task status select has a label naming the task, toasts are announced.
