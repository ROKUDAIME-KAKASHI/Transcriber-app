# Calendar and notification panel (branch calendar-notifications)

No schema change, no new dependency, no mock data, no push. Existing endpoints only; the one API edit adds `createdAt` to `GET /api/schedule/bookings` (additive). The audit is in UNBUILT-AUDIT.md.

## Calendar (Schedule page)
- Files: `ScheduleCalendar.tsx` (state, header, sheets), `CalendarViews.tsx` (Month grid, Week/Day time grid), `Sheet.tsx` (shared dialog), `lib/calendarView.ts` (pure range, layout and merge logic), `lib/calendarCache.ts` (fetchers plus a per-user offline copy).
- Views: Month, Week (default 1024px+), Day (default on phones; a one-day time grid). Today, back, forward, range title. `?view=` and `?date=YYYY-MM-DD` are accepted. Weeks run Monday to Sunday.
- Week/Day: hours down the side, days across, red "now" line on today, opens scrolled near the current hour (or 7 am). Overlaps sit side by side (cluster column packing). Month: up to 3 titles per day, "+N more"; at phone width a row of markers (solid circle = planned, square = booked, ring = recorded) and a tap opens that day.
- Kinds: Planned (accent, calendar-clock icon), Booked (success, calendar-check icon; a plan that came from a booking and a booking with no plan are one entry), Recorded (muted, lighter, mic icon; hidden when a plan or booking already points at that recording). Cancelled plans are hidden. A legend sits under the grid.
- Event click: a small dialog (bottom sheet on phones, centred card on laptops; not anchored to the event) with kind, time and zone, venue, "Join the call" (new tab; system browser in the app via `openCallLink`), attendees, and Record now (`/?plan=<id>&title=...`), Open plan, Open meeting, Invite (.ics) (the existing `deliverPlanIcs`: share sheet in the app, download on the web; there is no copy-to-clipboard version, so the label says "Invite (.ics)"), Open bookings for a booking with no plan.
- Empty slot click (Week/Day): "Plan a meeting here" dialog, then `/plan?new=1&date=&time=&tz=`. `PlanPage` now reads `date`, `time`, `tz` (validated, ignored if malformed); the Plan button in the header goes to `/plan?new=1`. Month: tap a day, then a slot.
- Time zone: `User.timeZone` (from `/api/schedule/settings`, cached), else the browser's. All day maths and displayed times use it.
- Data: planned meetings by range (`/api/plans?from&to`, server filtered, 200 rows max, one day of slack); bookings from `/api/schedule/bookings`, which has **no range filter and returns only bookings that have not ended**, so they are filtered on the client and past bookings only appear through their plan or recording; recorded meetings from the local Dexie list (works offline). Skeleton on first load, a thin progress bar on later loads, empty state per range, error notice with retry.
- Offline: planned meetings and bookings are kept in `localStorage` (`minutely.calcache.<userId>`, about 300 rows; a fresh answer replaces its time window so deleted rows go away). Offline with a copy: a notice says so. Offline with none: a clear message; recorded meetings still show.

## Scheduling options (dropdown in the calendar header)
Booking link, Weekly hours, Meeting lengths, Find a time, Upcoming bookings, Series. Each opens its existing editor in a sheet: `ScheduleSettings` got a `section` prop (`link | hours | lengths | bookings | all`), nothing removed or reworded inside. Find a time reuses `FindATime` with a length picker and no attendees (your own free time), and a pick opens the plan page with date and time filled. Series lists the user's series and opens `SeriesSettingsSheet`; the item appears only when series exist. Find a time needs the `calendar` switch and the calendar tables, as before.
Deep links: `/schedule?options=link|hours|lengths|find|bookings|series` opens the sheet (then strips the parameter). Profile's "Open Schedule" buttons now use `?options=link`. With `calendarView` off, `/schedule` is the old page and the parameter is ignored.

## Notification panel
- Bell with unread badge in the laptop sidebar (top right of the logo row) and the phone top bar. Opens a card beside the sidebar (laptop) or a bottom sheet (phone). Esc, backdrop, Android back close it; Tab is trapped.
- Items (`lib/notifications.ts`, pure): "Starting soon" (10 min or less, links to Record), meetings in the next 24 hours, new bookings from the last 3 days that have not ended, overdue and due-today task counts, "Plan the next one" for plans recorded in the last 7 days with nothing planned after them (same series, or same title when there is no series), and "N action items to review" from this device's saved candidates (last 7 days). Each has an icon, one line, relative time and a link.
- Read state: item ids in `minutely.notifRead.<userId>`, with a time, entries older than 14 days dropped, 300 max. "Mark all read" and clicking an item mark them read. An item whose id changes (a "soon" meeting, a changed task count) is unread again.
- Refresh (`lib/notificationsClient.ts`): on start, when the panel opens (forced), when the tab or app comes back (visibility and Capacitor appStateChange), and every 5 minutes while visible; at most one fetch per 20 seconds unless forced; never while recording. It calls `/api/plans` (last 8 days to next 30) and `/api/schedule/bookings`, and shares the existing task-summary cache (`useOverdueSummary`). No new route was needed.
- Data limits: task items follow the existing "overdue reminders" switch on Profile and the tracker flags (the summary is null when off); review items are device-local; bookings carry `createdAt` only after this deploy (older cached rows have none, so no "new booking" until the next fetch).
- Not built: push, sound, per-item dismiss.

## Flags
`calendarView` (default on): off brings back the old Schedule page. `notifications` (default on): off removes the bell and panel. Both are in `FLAG_DEFAULTS` and labelled in Admin.

## Tests (37 new)
`tests/calendarView.test.ts` (24: week/month/day ranges, zone day start and a 23 hour day, navigation, titles, overlap layout, event merge and dedupe, midnight clipping, slot snapping, plan link round trip, offline merge) and `tests/notifications.test.ts` (13: relative time, builder, order, follow-up rule, unread and read-map pruning). Whole suite: 729 pass at the time of writing.

## Not checked
No signed-in browser pass (the app needs a database session): 360px layout, dark mode, scroll position, popover focus, Android back key, real offline are unverified. Smoke, build and check-build pass.
