# Phase 12: Human UAT

Test on a Vercel preview wired to a Neon preview branch, never production. Check phone width and laptop, light and dark.

## Before 3_stakeholders is applied
- [ ] Profile shows a People row; opening it shows "Stakeholders need a database update" and nothing else breaks.
- [ ] Task Owner fields and the Rename speaker sheet still work as plain text.
- [ ] Tasks, Meetings and Schedule are unaffected.

## Apply `npx prisma migrate deploy` on the preview branch, then
- [ ] Empty state reads "No people yet. Add the people you meet so you can pick them as attendees and task owners."
- [ ] Add person with name, designation, organisation, area, email: it appears under the right letter with designation · organisation, area chip and email.
- [ ] Tap a row, edit, save: the change shows. Delete asks to confirm; the person disappears.
- [ ] Deleting a person who owns tasks leaves those tasks and their owner name unchanged.
- [ ] Same email in a different case is refused ("already uses this email"). A near-identical name warns "Possible duplicate"; "Save anyway" keeps both.
- [ ] Search finds by name, email, designation and area.
- [ ] "Add from your meetings" shows task owners, renamed speakers and booking guests not yet in People; one tap adds them (guest email prefilled) and the chip goes away.
- [ ] Task Owner (Tasks page and the extraction review): typing shows people with designation; Arrow keys + Enter pick one; "Add 'X' as new person" adds and uses it; free text not in People still saves.
- [ ] Rename speaker: matching names appear under "From People"; tapping one fills the field.
- [ ] Screen reader: the owner field announces as a combobox with the suggestion count.
- [ ] Offline: People shows "People need internet for now"; Add is disabled; the app does not crash. `/people` opens from the service worker shell.
- [ ] Admin > Feature switches > People directory off: People row and sidebar link disappear, `/people` shows "People are paused", owner fields are plain text.
- [ ] Laptop sidebar has People; the phone tab bar still has 4 tabs.
