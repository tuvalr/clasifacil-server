# Operator Scheduling: Schedule Classes vs. Assigned Sessions

## Context

Today every operator uses the same flat model: `sessions` are single dated
events (`operator_id`, `title`, `start_time`, `capacity_limit`,
`current_roster_count`), and households book directly into a specific
session via `enrollments_and_credits`. There is no concept of a recurring
weekly pattern, no standing class roster, and no distinction between
operator business models.

In practice operators fall into two shapes:

1. **Schedule operators** (after-school activities, dance, gymnastics) run
   recurring weekly **classes** with a roster of students who attend every
   week by default.
2. **Assigned-schedule operators** (padel instructors, personal trainers)
   work 1:1 with a student, either as one-off sessions or a recurring
   weekly slot assigned to that one student.

This spec adds an `operator.type` split and a recurring-scheduling layer
(`classes` + `class_enrollments`) that generates concrete rows into the
existing `sessions` table, so all existing roster/cancellation code keeps
working per-occurrence.

## Goals

- Add `operator.type: 'schedule' | 'assigned'`, required at creation,
  changeable only via a dedicated endpoint that refuses while the operator
  has any active classes.
- Let schedule-type operators define recurring weekly classes, generate
  concrete session occurrences from them, assign/unassign students to a
  class as a standing membership, and bulk-create classes/assignments.
- Let assigned-type operators create either one-off sessions (today's
  existing flow, unchanged) or a recurring 1:1 weekly slot for a single
  student, created and assigned in one step.
- Support single-occurrence overrides (reschedule or skip) on any
  generated session, independent of the recurring definition.
- Support recup (make-up) sessions as extra occurrences tied to a class.
- Support pausing a class (indefinitely or until a date), matching the
  existing operator pause pattern.
- Enforce class deletion order: schedule-type classes must have zero
  active enrollments before they can be deleted; assigned-type recurring
  slots delete directly (the single student is intrinsic to the row).

## Non-goals

- No waitlist integration for classes (the existing waitlist TODO in
  `SessionsServer` is untouched).
- No automatic credit/make-up-token issuance tied to class pause or
  session skip (the existing UC3 credit-issuance TODOs are untouched;
  a skipped occurrence does not automatically create a recup session).
- No background job / cron for rolling occurrence generation. Generation
  is an explicit, operator-triggered, bounded bulk-insert.
- No enforcement of `min_size` beyond storing and returning it — it is
  informational only, does not block generation or assignment.
- No retroactive edits: `PATCH /classes/{id}` never touches already-
  generated `sessions` rows, only future `generate-occurrences` calls.
- No change to `enrollments_and_credits`' existing `household_id`
  denormalization or to the one-off booking/cancellation-credit flow for
  assigned-type one-off sessions — those reuse `SessionsServer.book`/
  `cancel` exactly as they work today.

## Data model

### `operators` (extend existing table)

```sql
ALTER TABLE operators ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'schedule';
```

- `type: 'schedule' | 'assigned'`, required on create (no default in the
  API layer — the DB default above only exists so the `ALTER TABLE` can
  run against existing rows; every new operator create request must pass
  it explicitly, enforced in `OperatorsServer.create`).
- Immutable via the normal update endpoint; changed only via
  `POST /api/admin/operators/{id}/change-type`.

### `classes` (new table)

```sql
CREATE TABLE classes (
    id                BIGSERIAL PRIMARY KEY,
    operator_id       BIGINT        NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    title             VARCHAR(255)  NOT NULL,
    day_of_week       SMALLINT      NOT NULL,  -- 0 (Sunday) .. 6 (Saturday)
    start_time        TIME          NOT NULL,  -- time-of-day, e.g. 16:00
    duration_minutes  INTEGER       NOT NULL,
    min_size          INTEGER,                  -- nullable, informational only
    max_size          INTEGER       NOT NULL,   -- becomes each generated session's capacity_limit
    status            VARCHAR(20)   NOT NULL DEFAULT 'active',  -- 'active' | 'paused'
    paused_until      TIMESTAMPTZ,
    is_deleted        BOOLEAN       NOT NULL DEFAULT FALSE,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT classes_day_of_week_check CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT classes_max_size_check CHECK (max_size >= 1),
    CONSTRAINT classes_min_size_check CHECK (min_size IS NULL OR min_size <= max_size),
    CONSTRAINT classes_status_check CHECK (status IN ('active', 'paused'))
);
```

For `type='assigned'` recurring slots, `max_size` is always `1` and
`min_size` is always `NULL` (enforced in the server layer, not the DB —
keeping the table shape identical for both operator types).

### `class_enrollments` (new table)

```sql
CREATE TABLE class_enrollments (
    id          BIGSERIAL PRIMARY KEY,
    class_id    BIGINT        NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    student_id  BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    status      VARCHAR(20)   NOT NULL DEFAULT 'active',  -- 'active' | 'removed'
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT class_enrollments_status_check CHECK (status IN ('active', 'removed')),
    CONSTRAINT class_enrollments_unique_active UNIQUE (class_id, student_id)
);
```

No `household_id` column — a student's household is resolved via
`students.household_id` whenever needed (e.g. admin/household detail
views), never duplicated here.

The unique constraint is on `(class_id, student_id)` as a plain pair
(not partial on status), which means unassigning then reassigning the
same student re-activates the existing row (`status: 'removed' ->
'active'`) rather than inserting a new one — simpler than a partial
unique index here since there's no soft-delete-and-reuse-email-style
requirement driving a partial index the way there is on `operators`/
`users`.

### `sessions` (extend existing table)

```sql
ALTER TABLE sessions
    ADD COLUMN class_id BIGINT REFERENCES classes (id) ON DELETE CASCADE,
    ADD COLUMN is_recup_session BOOLEAN NOT NULL DEFAULT FALSE;
```

- `class_id` is `NULL` for today's plain one-off sessions (both operator
  types can still create these directly — see Non-goals).
- `class_id` is set for every session generated from a class, whether a
  normal occurrence or a recup session.
- `is_recup_session` distinguishes a recup occurrence from a normal
  generated occurrence of the same class.

### Roster resolution rule

A session's effective roster is computed, not stored, as:

- If `is_recup_session = true`: roster = only the `enrollments_and_credits`
  rows created directly against this session (via the existing
  `book`/`enrollments` flow) — the class's standing `class_enrollments`
  members are NOT included.
- Otherwise (normal generated occurrence, or a plain one-off session with
  `class_id IS NULL`): roster = the existing `enrollments_and_credits`
  rows for this session, exactly as today.

Standing `class_enrollments` membership does **not** itself create
`enrollments_and_credits` rows per occurrence. `GetSessionRosterResponse`
is extended to also return the class's active `class_enrollments` (student
list) alongside any explicit `enrollments_and_credits` for that session,
so a normal occurrence's full attendee list = class members ∪ explicit
enrollments (relevant for a recup session, or if a household separately
books a normal occurrence directly — allowed but not a primary flow).

## API surface

### Operators (extend existing admin controller)

- `POST /api/admin/operators` — body gains required `type: 'schedule' |
  'assigned'`.
- `POST /api/admin/operators/{id}/change-type` — body `{ type }`. 409 if
  the operator has any active (non-deleted) `classes` rows, regardless of
  pause status. On success, updates `operators.type`.

### Classes (new, under `/api/operator/classes`)

- `POST /api/operator/classes` — body is a single class object **or** an
  array of class objects (bulk-create, satisfying 1.7). Each item:
  `{ operatorId, title, dayOfWeek, startTime, durationMinutes, minSize?,
  maxSize, generate: { through?: string /* ISO date */, count?: number }
  }`. Exactly one of `generate.through` / `generate.count` is required;
  `count` is capped at 104 occurrences per call. For `type='assigned'`
  operators, the body additionally requires `studentId` (assignment
  happens atomically with creation — see below) and `maxSize` must be
  omitted or `1`.
  Response: array of `{ class, sessions }` per created class, each with
  per-item success/error (partial success allowed across array items —
  one bad item in a bulk array does not roll back the others).
- `GET /api/operator/classes?operatorId=` — list.
- `GET /api/operator/classes/{id}` — detail, includes active
  `class_enrollments` (student list).
- `PATCH /api/operator/classes/{id}` — edit `title` / `dayOfWeek` /
  `startTime` / `durationMinutes` / `minSize` / `maxSize`. Never touches
  already-generated `sessions` rows (Non-goals) — only affects sessions
  generated by future `generate-occurrences` calls.
- `DELETE /api/operator/classes/{id}` — 409 if any active
  `class_enrollments` rows exist (`type='schedule'`). For `type='assigned'`
  recurring slots, deletes directly (the single `class_enrollments` row
  is intrinsic and cascades via `ON DELETE CASCADE`, not a separate
  precondition check).
- `POST /api/operator/classes/{id}/pause` — body `{ pausedUntil? }` (omit
  or null = indefinite), mirrors `OperatorsServer.pause`. Blocks
  `generate-occurrences` and `assign-students` while paused; does not
  touch already-generated sessions.
- `POST /api/operator/classes/{id}/resume`.
- `POST /api/operator/classes/{id}/generate-occurrences` — body
  `{ through?: string, count?: number }`, same cap/validation as at
  create time. 409 if class is paused.
- `POST /api/operator/classes/{id}/assign-students` — body: array of
  `studentId`. `type='schedule'` only (400 for `assigned`-type classes,
  which get their one student at creation, and have no endpoint to
  change it — see Open Questions). Bulk (satisfies 1.6), same per-item
  partial-success semantics as bulk class create: each studentId is
  evaluated independently, in array order, against the active count as
  of that point in the batch (so if 1 slot remains and 3 students are
  submitted, the first succeeds and the other two 409 for capacity —
  not an all-or-nothing batch). Each studentId: 404 if student not
  found, 409 if already actively enrolled, 409 if it would exceed
  `max_size`, 409 if class is paused. Re-activates a previously-removed
  row for the same student instead of inserting a duplicate.
- `POST /api/operator/classes/{id}/unassign-students` — body: array of
  `studentId`. Sets matching active rows to `status: 'removed'`.
- `POST /api/operator/classes/{id}/recup-session` — body `{ startTime,
  studentIds: number[] }`. Creates one `sessions` row with this
  `class_id`, `is_recup_session: true`, `capacity_limit` = class's
  `max_size`, then books each given student via the existing
  `enrollments_and_credits` create path. Any student id is accepted (no
  active-membership requirement).

### Sessions (extend existing operator sessions controller)

- `PATCH /api/operator/sessions/{id}/reschedule` — body `{ startTime }`.
  Updates the single occurrence's `start_time`; leaves the class and all
  other occurrences untouched. Works on any session (class-generated or
  plain), matching how `cancel` already works on any session today.
- Existing `POST /api/operator/sessions/{id}/cancel` is reused as-is for
  "skip this occurrence" — no new endpoint needed.
- `GET /api/operator/sessions/{id}/roster` — response extended per the
  Roster resolution rule above (adds the class's active
  `class_enrollments` student list when `class_id` is set).

## Validation & error handling

- Every classes/recup endpoint checks the parent operator's `type` first:
  a multi-student create/assign against an `assigned`-type operator, or a
  create without `studentId` against an `assigned`-type operator, is a
  400 (not 404 — the operator exists, the request shape is wrong for its
  type).
- `dayOfWeek` must be 0-6, `durationMinutes > 0`, `maxSize >= 1`,
  `minSize` (if present) `<= maxSize` — validated in the server layer
  before hitting the DB constraints (DB constraints are the backstop, not
  the primary validation path, consistent with existing `ValidationError`
  usage elsewhere in this codebase).
- `generate.count` capped at 104 (two years of weekly occurrences); a
  larger request is a 400 with a clear message, not silently truncated.
- Assigning a student already at `max_size` active enrollments is a 409,
  not a silent no-op or a capacity_limit-style waitlist (no waitlist
  integration per Non-goals).
- Deleting a `type='schedule'` class with any active `class_enrollments`
  is a 409 with a body naming the blocking count, mirroring the existing
  `HouseholdHasActiveBookingError` pattern (a new `ClassHasActiveEnrollmentsError`).
- `change-type` is a 409 (not 400) when blocked by active classes, for
  the same reason `HouseholdHasActiveBookingError` is a 409 on household
  delete — it's a state conflict, not a malformed request.

## Testing

- Unit-level: `ClassesServer` validation paths (day/time/size bounds,
  type-mismatch rejection, capacity-at-assignment enforcement, delete
  guard, pause blocking generation/assignment) and the roster-resolution
  helper (class members ∪ explicit enrollments, recup exclusion).
- Integration-style (against the real Postgres schema, matching this
  repo's existing pattern of no separate test DB tooling — see
  `docs/db/schema.sql` for how a fresh schema is provisioned): generate
  occurrences from a class and confirm the right number/dates of
  `sessions` rows; assign/unassign students and confirm roster
  resolution; reschedule and cancel a single occurrence and confirm the
  class and sibling occurrences are untouched; recup session with a
  non-member student; change-type 409 while an active class exists,
  success after it's deleted.
- No new test framework is being introduced by this spec — this repo
  currently has no test runner configured (`package.json`'s `test` script
  is a placeholder). If that remains true when this is implemented, the
  same manual/type-check verification approach used for the rest of this
  codebase applies; introducing a test framework is out of scope for this
  spec.

## Open questions

- **Reassigning an `assigned`-type recurring slot to a different student**:
  there is no endpoint to change which student a `type='assigned'`
  class's single `class_enrollments` row points to. Today the only way
  to change it is to delete the class (allowed directly, per the delete
  rule) and create a new one. If operators need to reassign a slot
  without losing the class's identity/history (e.g. for reporting), a
  `PATCH .../reassign` endpoint should be added — flagging this rather
  than silently deciding, since the request didn't describe this case.

## Migration note

Like every other schema change in this repo, there is no migration
tooling — `docs/db/schema.sql` must be updated with the three DDL blocks
above (new `type` column on `operators`, new `classes` table, new
`class_enrollments` table, new `class_id`/`is_recup_session` columns on
`sessions`) in the same change that implements this spec, and the local
dev database must be migrated by hand (as was done for the household
`status`/`paused_until` columns).
