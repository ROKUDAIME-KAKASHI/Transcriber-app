# Phase 16: Human UAT

Test on a Vercel preview wired to a Neon preview branch, never production. Check phone width and laptop, light and dark. Have a few tasks with and without due dates, some in the past, and a series with two recorded meetings.

## Before 7_tracker is applied
- [ ] Tasks, Meetings > Action items and the extraction review work exactly as before: pick or type an owner, edit, delete, change status.
- [ ] No "Link owners to People" notice and no series chip. Timeline view, Tasks badge, daily toast, Record line and the plan page Series progress card already work.

## Apply `npx prisma migrate deploy` on the preview branch, then
- [ ] Tasks > owner field: pick a person from the suggestions. The task keeps the name, and hovering the owner shows their designation; the expanded task says "from People".
- [ ] Rename that person in People, reload Tasks and the meeting's Action items: the new name shows. Delete the person: the old name stays as text.
- [ ] Type a different name by hand on a linked task: it becomes plain text (Owner filter lists it as text, not as the person).
- [ ] Extraction review: pick a person in a row, save: the saved task is linked. Type a name by hand and save: plain text.
- [ ] Owner filter lists each linked person once even when old tasks spelled the name differently; choosing them shows all their linked tasks.
- [ ] With old tasks whose owner text equals a person's name (any capitalisation): the "Link owners to People" notice appears. Review matches shows names and counts; Confirm and link links them and the notice goes away. Two people sharing a name are listed as left alone.
- [ ] Timeline: List / Timeline toggle on phone and laptop. Sections Overdue, Today, This week, Next week, Later, No date appear only when they have tasks and match the due dates (check a task due on Sunday and one on the next Monday). Done tasks are hidden until Show done. Tapping a title opens it in the list.
- [ ] Series chip appears on tasks of series meetings; tapping it filters by that series; the Series select on Tasks does the same; `/tasks?series=<id>&status=all` opens filtered.
- [ ] Tasks tab shows a red count of overdue open tasks (phone tab bar and laptop sidebar); a screen reader says "3 overdue tasks". Mark one done or change its due date: the count updates within a moment. With zero overdue there is no badge.
- [ ] Open the app fresh with overdue tasks: a toast "N tasks are overdue · View" appears once; View opens the timeline. Reopen the same day: no toast. Next day: it returns.
- [ ] Record screen: "N tasks are overdue · View" under the hero when idle; hidden while recording and when there are none.
- [ ] Profile > Preferences > "Remind me about overdue tasks" off: badge, toast and Record line all disappear; on again: they return. The choice survives a reload.
- [ ] Plan page of a series plan: "Series progress" card with "Weekly review · N done · N in progress · N overdue", a bar, By meeting list (date, title, done/total) and View tasks. A series with no recorded meetings says tasks will show up once saved.
- [ ] Offline: no badge, toast or card; Tasks still says it needs internet.
- [ ] Admin > Feature switches > Tracker upgrades off: Tasks looks like before this phase (no toggle, series, badge, notice, card); owners are plain text.
- [ ] Another account never sees your counts, series progress or link matches (try the API URLs with a second login).
- [ ] Keyboard and screen reader: view toggle is a radio group, Show done is a labelled checkbox, the toast link is focusable, the series bar has a text alternative.
