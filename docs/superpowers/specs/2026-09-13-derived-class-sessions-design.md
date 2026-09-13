# Derived Class Sessions, Stop Lifecycle, and Attendance Tracking

## Context

Today, a class's occurrences are pre-generated: `POST /classes/{id}/generate-occurrences` bulk-inserts up to
104 concrete `sessions` rows upfront (`docs/superpowers/specs/2026-09-12-operator-scheduling-design.md`). This
has two real costs: an operator must remember to keep calling `generate-occurrences` or a class silently runs
out of bookable dates, and any class-level edit (rename, capacity change) that should apply to future
occurrences needs explicit propagation logic to N already-written rows — exactly the bug class hit while
building the `renameRelatedSessions` flag on `PUT /classes/{id}` (a database write bled an unrelated request
field into a nonexistent column, caught only by live verification).

This spec removes pre-generation. A class's future occurrences are computed on demand from its recurring
pattern; a concrete `sessions` row is only ever written when something needs to diverge from that pattern —
a reschedule, a cancellation, or attendance being recorded. It also adds a `stop` lifecycle to replace
`pause`/`resume` (the two states blocked the exact same actions and never needed to be distinct), and adds
per-student attendance tracking with a retention/archival story, since attendance is the most common
divergence trigger and the thing this whole model is ultimately in service of.

**Scope correction from the first draft of this spec:** derivation, materialization, and attendance apply to
**every class regardless of `operator.type`** — a `schedule`-type class (many students, standing roster) and
a recurring `assigned`-type class (`maxSize: 1`, one fixed student) both go through the exact same
occurrence/materialization/attendance machinery; `maxSize` only ever affected roster capacity, never derivation
itself, so there was no real reason to gate any of this by operator type. Attendance also extends to true
one-off sessions (no `class_id` at all — `assigned`-type operators' ad hoc bookings), via a simpler
already-materialized-row endpoint, since those already have a real `sessions` row from creation with nothing to
derive.

## Goals

- Replace `classes.status: 'active' | 'paused'` (+ `pausedUntil`) with `'active' | 'stopped'` (+ `stoppedAt`),
  reversible (`unstop`), since pause and stop blocked identical actions and there was no reason to keep two
  names for one concept.
- Remove `generate-occurrences` and the 104-occurrence cap entirely, for every class regardless of operator
  type. Future/past occurrence lists are computed from the class's pattern within an explicit, caller-supplied
  date range (full calendar days, capped at 90 days per call).
- Materialize a real `sessions` row for a class-linked date only when it diverges from the plain pattern:
  reschedule, cancel, or attendance recorded for it (including a nightly backfill job, described below).
- Add per-student attendance tracking (`present` / `absent` / `approved_absent`, plus a read-time-only
  `not_recorded` for past dates nobody touched), with in-place correction, a 6-month retention window, and
  archival to a history table. Available for any class-linked session (any operator type) and for true one-off
  sessions.
- Allow adding an ad hoc "trial" student to one specific session's attendance, independent of that class's
  standing `class_enrollments` roster, promotable later via the existing `assign-students` endpoint.
- Add a nightly in-process job that backfills any class's (any operator type) missing materialized sessions
  from the day after its last materialized/attendance-bearing session through yesterday (inclusive),
  self-healing if a run is missed.
- Keep makeup sessions exactly as they work today (always-materialized, roster auto-filled from the class's
  current standing members), merged into the future-occurrences list so a calendar view sees them alongside
  regular derived dates.
- Retire `sessions.title` for any class-linked session (see "Session titles," below) — a materialized
  class-linked session no longer stores or needs its own title; display always reads the parent class's
  current title live. `renameRelatedSessions` (added in the prior spec) is removed entirely as a result, not
  merely narrowed — there is nothing left to propagate a rename to.
- Leave true one-off `assigned`-type sessions (`POST /api/operator/sessions`, no `class_id`) untouched apart
  from gaining attendance support — they keep their own operator-supplied `title`, since there is no class to
  derive one from.

## Non-goals

- No changes to the existing `assign-students`/`unassign-students` endpoints' semantics (only their pause-check
  condition changes, to `status !== 'stopped'`) — still `schedule`-type only, since `assigned`-type classes get
  their one student atomically at creation and have no separate assign step (unchanged from the prior spec).
- No changes to `enrollments_and_credits`/the existing household-booking cancellation-credit state machine
  (`AttendanceCreditsServer`) — that system tracks *booking* lifecycle (booked/cancelled-with-credit/forfeited)
  for household-initiated cancellations, a different concept from operator-recorded per-student attendance
  introduced here. The two coexist without interaction.
- No sticky/standing trial-student concept — a trial student added to one session's attendance has no
  relationship to any other session or to `class_enrollments` unless the operator separately calls
  `assign-students` for them later.
- No external scheduler/ops dependency — the nightly job runs in-process via `node-cron`, a new dependency
  this spec adds deliberately (flagged, not glossed over) rather than requiring an external cron trigger.
- No per-session custom title for a class-linked session — if an operator wants one occurrence to display
  differently (e.g. "Ballet – Recital Week"), that is out of scope; display is always the class's current title.

## Data model

### `classes` (modify existing table)

```sql
ALTER TABLE classes
	DROP COLUMN paused_until,
	ADD COLUMN stopped_at TIMESTAMPTZ;

-- status's existing CHECK constraint (if any) must be updated to ('active', 'stopped') — this repo's
-- classes.status has no DB-level CHECK today (informational-only convention, see docs/db/schema.sql), so no
-- constraint migration is needed beyond updating the comment/documentation.
```

- `status: 'active' | 'stopped'`. Stopping sets both `status: 'stopped'` and `stopped_at: NOW()`. Unstopping
  sets `status: 'active'` and clears `stopped_at` to `NULL`. Applies identically to `schedule`-type and
  recurring `assigned`-type classes.
- `stopped_at` is also the clip point for derivation: an active class's future window has no cap; a stopped
  class's future window is empty past `stopped_at` (nothing derives after the stop moment), but past occurrences
  and all history remain fully queryable regardless of stop state.

### `sessions` (modify existing table)

```sql
ALTER TABLE sessions
	ALTER COLUMN title DROP NOT NULL;
```

- `title` becomes nullable and is only ever populated for a session with `class_id IS NULL` (a true one-off,
  `assigned`-type ad hoc booking). Every class-linked session (materialized `schedule`-type occurrence,
  materialized recurring `assigned`-type occurrence, or a makeup session) is created with `title: null` — its
  display name is always resolved by reading the parent class's current `title` at read time. `is_makeup_session`
  still distinguishes a makeup occurrence for display purposes ("Ballet Beginners — Makeup"), composed from the
  live class title, not stored.
- No other structural change. Still the home for: true one-off sessions (own `title`, no `class_id`), makeup
  sessions (`class_id` set, `is_makeup_session: true`, `title: null`), and every materialized occurrence for any
  class regardless of operator type.

### `session_attendance` (new table)

```sql
CREATE TABLE session_attendance (
	id           BIGSERIAL PRIMARY KEY,
	session_id   BIGINT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	class_id     BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	student_id   BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	status       VARCHAR(20)   NOT NULL,  -- 'present' | 'absent' | 'approved_absent'
	created_at   TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at   TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT session_attendance_status_check CHECK (status IN ('present', 'absent', 'approved_absent')),
	CONSTRAINT session_attendance_unique UNIQUE (session_id, student_id)
);
```

- One row per (session, student) — marking again **updates the existing row in place** (bumps `updated_at`),
  never inserts a second row for the same pair. This is current-state-only, not an audit log.
- `class_id` is nullable (unlike the first draft): populated whenever the session has one (denormalized, same
  pattern as `enrollments_and_credits.household_id` elsewhere in this schema, so attendance can be queried per
  class without joining through `sessions`); `NULL` for attendance against a true one-off session.
- `student_id` has **no** required relationship to that class's `class_enrollments` — a trial student (never
  enrolled in the class) can have a `session_attendance` row for one specific session with no standing
  enrollment at all. Also how a one-off `assigned`-type session's single booked student gets an attendance row.
- `not_recorded` is never stored as a status value. It is synthesized at read time: for a past materialized
  session, any roster/attendance-relevant student with no `session_attendance` row is reported as
  `not_recorded` in the response, with no row written until an operator explicitly sets a real status for them.
- No `deleted_at` (rows are only ever moved to `session_attendance_history`, never soft-deleted in place).

### `session_attendance_history` (new table)

```sql
CREATE TABLE session_attendance_history (
	id           BIGINT        PRIMARY KEY,  -- preserves the original session_attendance.id
	session_id   BIGINT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	class_id     BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	student_id   BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	status       VARCHAR(20)   NOT NULL,
	created_at   TIMESTAMPTZ,
	updated_at   TIMESTAMPTZ,
	archived_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
```

Same shape as `session_attendance` (including nullable `class_id`) plus `archived_at`; FKs kept (per explicit
decision) rather than decoupled, so historical rows remain referentially valid even though they're rarely
queried once archived.

## Derivation and materialization

Applies uniformly to any class, `schedule`-type or recurring `assigned`-type. The only practical difference is
roster size: a `schedule`-type class's `classMemberStudentIds` may have many entries; a recurring `assigned`-type
class's has exactly one (its single `class_enrollments` row from creation, per the prior spec).

### Computing occurrence dates

Given a class's `dayOfWeek`/`startTime`/`durationMinutes` and a caller-supplied `[from, to]` date range (full
calendar days, `to - from` capped at 90 days, 400 if exceeded), the derivation walks every date in range
matching `dayOfWeek`, clipped to `stoppedAt` if the class is stopped (no dates on/after the stop date). This
replaces `computeOccurrenceDates` from the prior spec, which walked forward from "today" with a `count`/`through`
option and a 104-occurrence cap — both removed, since there is no pre-generation step left to cap.

### Two occurrence-listing endpoints

- **`GET /classes/{id}/occurrences/future?from=&to=`** — `from` must be today-or-later; `to - from` ≤ 90 days.
  Returns a merged, date-ordered list combining: (a) virtual dates from the pattern with no matching `sessions`
  row (no `id`; `classId` + computed `startTime`, `title` resolved from the class), (b) already-materialized
  `sessions` rows in range (a past reschedule may have moved a date into or out of this window), and (c) makeup
  sessions in range (`isMakeupSession: true`). Every non-makeup entry also carries `classMemberStudentIds` (the
  class's *current* standing roster) so a calendar view can show "who's enrolled" without a second call —
  reading the roster live means a virtual future date is always in sync with roster changes, with nothing to
  propagate.
- **`GET /classes/{id}/occurrences/past?from=&to=`** — `to` must be today-or-earlier; same 90-day cap. Every
  entry is either a real materialized `sessions` row (with whatever attendance was recorded, `not_recorded`
  filled in per-student where missing) or, for a date nobody ever touched, a virtual entry with every roster
  student reported `not_recorded`.

### Materialization triggers

A `sessions` row is created for a given class + date the first time any of these happens for it:
- `PATCH /classes/{id}/occurrences/{date}/reschedule` — materializes the date (with the pattern's default
  `startTime`, `title: null`) and then immediately applies the requested new `startTime` to that same row, in
  one call.
- `POST /classes/{id}/occurrences/{date}/cancel` — materializes the date and immediately soft-deletes it
  (identical end state to today's `POST /sessions/{id}/cancel`, just reachable before a row previously existed).
- `PUT /classes/{id}/occurrences/{date}/attendance` — materializes the date (untouched `startTime`, from the
  pattern) and then records the given students' attendance against it.
- The nightly backfill job (below) — materializes the date with the pattern's default `startTime` and no
  attendance rows yet (those are filled in later, by a human, via the endpoint above).

Once materialized, that date behaves exactly like any session does today — reachable by its numeric `sessionId`
via the existing `/sessions/{id}/...` endpoints too, in addition to the new date-based ones, since nothing about
an already-materialized row is special.

### Nightly backfill job

New dependency: `node-cron`, scheduled once at process bootstrap alongside the HTTP server (same process, no
new deployment surface). Once nightly, for every non-stopped class (any operator type — `schedule` and
recurring `assigned` alike; a true one-off session has no pattern to backfill and is skipped, since it was
never derived from anything): find the latest date the class has a materialized `sessions` row for (or the
class's creation date if it has none yet), and materialize every derived occurrence date after that point
through **yesterday inclusive** — even if that's several weeks of dates (e.g. the process was down for a
while), so attendance can always be reported/corrected for every past date via `GET .../occurrences/past` and
`PUT .../attendance`. This is the only place `sessions` rows are created without a specific human action
prompting that exact date.

## Attendance

### Recording and correcting (class-linked sessions)

`PUT /classes/{id}/occurrences/{date}/attendance` — body: array of `{ studentId, status }`
(`'present' | 'absent' | 'approved_absent'`). Materializes the session for that date if needed, then upserts
one `session_attendance` row per given student (insert if none exists for that session+student pair, update
`status`/`updated_at` in place if one does). Works identically for `today`, future dates (marking ahead isn't
prevented, though the common case is same-day or past), and past dates — satisfying "report attendance for past
sessions to allow setting missing ones" and "allow updating attendance status for students." Works the same way
for a recurring `assigned`-type class's single-student occurrences as it does for a `schedule`-type class's
many-student ones.

`studentId` is accepted for any student, not just the class's current standing roster — this is what makes
trial-student attendance possible (see below) with no separate endpoint.

### Recording and correcting (true one-off sessions)

`PUT /sessions/{id}/attendance` — same body shape and upsert semantics, but keyed directly by the existing
numeric `sessionId` (the row already exists from creation; there is no class, no date-addressing, and nothing
to materialize). `class_id` on the resulting `session_attendance` row(s) is `NULL`.

### Trial students

A student who is not (and may never be) in the class's `class_enrollments` can still get a `session_attendance`
row via the same `PUT .../attendance` call, simply by including their `studentId` with a status. This creates
no standing relationship — if they attend a different session later, the operator marks their attendance for
that session too, independently. If the operator decides to keep them, they call the existing
`POST /classes/{id}/assign-students` to make them a real standing member going forward; nothing about their
past trial-attendance rows changes retroactively.

### Retention and archival

`session_attendance` rows older than 6 months (by `updated_at`) are moved to `session_attendance_history` via
`POST /api/admin/session-attendance/archive` — an admin-only, manually/externally-triggered endpoint (not part
of the nightly job; a separate, deliberately-simpler concern from materialization). Moves matching rows in a
single transaction (insert into history, delete from live) and returns a count. No in-process schedule for this
one — the nightly job already adds one new scheduled concern; archival is infrequent enough (monthly cadence is
plenty for a 6-month window) to stay a manually-invoked action for now.

## Makeup sessions (unchanged mechanics, new surfacing)

`POST /classes/{id}/makeup-session` keeps its existing behavior exactly: always creates a real, immediately
materialized `sessions` row (`isMakeupSession: true`, `title: null` per the schema change above — display
resolves to something like "<class title> — Makeup" from the live class, not a stored string), with the
attendee list **auto-filled from the class's current `class_enrollments` standing roster** at creation time
(not editable per-student at creation — this reverses the original 2026-09-12 spec's "operator explicitly
picks students" design, superseded by this spec's explicit confirmation that a makeup should default to the
same roster as the class it's making up for, matching the "vacation day, recovered next week" framing). It is
not part of the weekly-pattern derivation itself; it's an explicit exception layered on top, exactly as before.
The only change is that `GET .../occurrences/future` now includes it merged into the same response as regular
derived/materialized dates, tagged `isMakeupSession` so a calendar UI can render it distinctly.

## API surface: full audit

### Removed

- `POST /classes/{id}/generate-occurrences` — no pre-generation step left.
- `POST /classes/{id}/pause` — folded into `stop`.
- `POST /classes/{id}/resume` — folded into `unstop`.
- `renameRelatedSessions` field on `PUT /classes/{id}` — removed entirely, not narrowed. Class-linked sessions
  no longer store a title to rename.

### Added

- `GET /classes/{id}/occurrences/future?from=&to=`
- `GET /classes/{id}/occurrences/past?from=&to=`
- `PUT /classes/{id}/occurrences/{date}/attendance`
- `PUT /sessions/{id}/attendance` (true one-off sessions)
- `PATCH /classes/{id}/occurrences/{date}/reschedule` (date-addressed variant, for not-yet-materialized dates)
- `POST /classes/{id}/occurrences/{date}/cancel` (date-addressed variant, for not-yet-materialized dates)
- `POST /classes/{id}/stop`
- `POST /classes/{id}/unstop`
- `POST /api/admin/session-attendance/archive`
- (internal, not an HTTP endpoint) nightly `node-cron` backfill job

### Unchanged

- `POST /classes/{id}/assign-students`, `/unassign-students` — same semantics, still `schedule`-type only; their
  "class must not be paused" guard becomes "class must not be stopped."
- `POST /classes/{id}/makeup-session` — same creation endpoint; roster now always auto-filled from the class
  (see above) instead of operator-supplied.
- `POST /api/operator/sessions` (true one-off creation), `PATCH /sessions/{id}/reschedule`,
  `POST /sessions/{id}/cancel` — completely untouched; these numeric-id-addressed endpoints also continue to
  work for any already-materialized class-linked session, alongside the new date-addressed variants.
- `GET /classes/{id}` / `GET /classes?operatorId=` / `POST /classes` / `PUT /classes/{id}` / `DELETE /classes/{id}`
  — unchanged apart from the removal of `renameRelatedSessions` from `PUT`'s body (see above).
- `GET /api/operator/sessions?operatorId=` — kept as a flat cross-class session list (useful for "everything
  today across all my classes" views), scoped to whatever `sessions` rows actually exist (materialized
  occurrences for any class + all true one-off sessions); it does not need to know about
  virtual/unmaterialized dates, since those aren't real rows.

## Testing

Following this repo's existing convention (no test framework; `npx tsc --noEmit` + `npx eslint .` + manual
DB-backed smoke tests via curl/throwaway `pg` scripts):
- Derivation correctness: a class with a known pattern + date range produces the expected virtual dates, with
  no `sessions` rows created merely by listing. Test both a `schedule`-type (multi-student) and a recurring
  `assigned`-type (single-student) class.
- Materialization: each of reschedule/cancel/attendance, called against a virtual date, creates exactly one
  `sessions` row for that date (with `title: null`) and behaves identically to an already-materialized one
  afterward.
- Nightly job: manually invoke it against a class with a gap (simulate a missed run) and confirm it backfills
  every missing date up to yesterday, not just one; confirm it also runs for a recurring `assigned`-type class
  and skips true one-off sessions entirely.
- Attendance: mark, then correct, a student's status and confirm the row updates in place (no duplicate);
  confirm a past unmarked date reports `not_recorded` per roster student without writing anything; confirm a
  trial student (no `class_enrollments` row) can still get an attendance row; confirm `PUT /sessions/{id}/attendance`
  works against a true one-off session with `class_id: NULL` on the resulting row.
- Archival: seed rows older than 6 months, call the archive endpoint, confirm they move to
  `session_attendance_history` and disappear from the live table in one pass.
- Stop/unstop: confirm a stopped class's future-occurrences window is empty past `stoppedAt`, and that
  `unstop` fully restores derivation.
- Display: confirm a materialized class-linked session's title in every response is read live from its class
  (renaming the class immediately changes what an already-materialized future session displays, with no
  per-session propagation needed).

## Migration note

As with every prior schema change in this repo: no migration tooling exists. `docs/db/schema.sql` must be
updated (the `classes` column swap, the `sessions.title` nullability change, the two new tables) in the same
change that implements this spec, and the local dev database must be migrated by hand via a throwaway `pg`
script, mirroring how every previous schema change in this project's history was applied.
