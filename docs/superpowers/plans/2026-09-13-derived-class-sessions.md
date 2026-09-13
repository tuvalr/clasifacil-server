# Derived Class Sessions, Stop Lifecycle, and Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pre-generated class occurrences with on-demand derivation (materializing a `sessions` row only on divergence — reschedule, cancel, or attendance), fold `pause`/`resume` into a reversible `stop`/`unstop`, retire per-session titles for class-linked sessions, and add per-student attendance tracking with retention/archival and a nightly backfill job — for every class regardless of `operator.type`.

**Architecture:** A new `ClassOccurrencesServer`/`ClassOccurrencesController` pair owns derivation (computing virtual dates from a class's pattern), the two occurrence-listing endpoints, and materialization-triggering actions (date-addressed reschedule/cancel), replacing `ClassesServer`'s `generateOccurrences`/`computeOccurrenceDates`. A new `SessionAttendanceServer`/`SessionAttendanceController` pair owns the new `session_attendance`/`session_attendance_history` tables, mounted under both `/classes/{id}/occurrences/{date}/attendance` and `/sessions/{id}/attendance`. A new `src/jobs/nightly-backfill.job.ts`, scheduled via `node-cron` from `Server.start()`, reuses `ClassOccurrencesServer`'s materialization logic. `ClassesServer`/`ClassesController` shrink back to class CRUD (no more pause/resume/generate-occurrences/rename-propagation). `SessionsServer.create` keeps its `assigned`-type-only plain-session gate unchanged.

**Tech Stack:** TypeScript, Express 5, Inversify DI, raw `pg` (no ORM), `node-cron` (new dependency, added by this plan). No test framework — verification is `npx tsc --noEmit -p .` + `npx eslint .` + manual DB-backed smoke tests via curl/throwaway `pg` scripts, exactly as every prior task in this codebase's history.

**Spec:** `docs/superpowers/specs/2026-09-13-derived-class-sessions-design.md`

## Global Constraints

- No migration tooling exists — every schema change is hand-applied to the local dev DB (credentials in `.env.local`) via a throwaway `pg` script, AND `docs/db/schema.sql` must be updated in the same task.
- No test framework — verify with `npx tsc --noEmit -p .` (must be clean) and `npx eslint .` (must be clean) after every task, plus a manual DB-backed check for runtime behavior.
- Derivation/materialization/attendance apply to **every class regardless of `operator.type`** (`schedule` or recurring `assigned`) — `maxSize` only ever affected roster capacity, never derivation. A true one-off session (`class_id IS NULL`, `assigned`-type ad hoc booking) is unaffected by derivation but gains attendance support via a separate, simpler endpoint.
- `stopped_at`/`status: 'stopped'` is reversible via `unstop` — never treat it as one-way.
- Date-range inputs (`occurrences/future`, `occurrences/past`) are full calendar days, capped at 90 days per call (400 if exceeded), independent of any time-of-day component.
- `session_attendance` is one row per `(session_id, student_id)` — marking again **updates in place** (bumps `updated_at`), never inserts a duplicate. Not an audit log.
- `class_id` is nullable on `session_attendance`/`session_attendance_history` (populated for class-linked sessions, `NULL` for true one-off sessions).
- `sessions.title` becomes nullable and is only meaningful for a session with `class_id IS NULL`; every class-linked session (materialized or virtual) is displayed using its parent class's *current* title, read live, never stored/propagated.
- `renameRelatedSessions` is removed entirely (not merely narrowed) from `PUT /classes/{id}`.
- Follow existing conventions exactly: tabs, `@injectable()` + constructor `@inject(TYPES.X)` DI, `PublicEntity<T>` + `toPublic()` for `BaseEntity`-backed responses, `RouteHandlers.wrap(...)` for every handler, `@openapi` JSDoc blocks matching existing controllers' style, camelCase in TS / snake_case in SQL (via `src/utils/case-mapper.ts` — never hand-write column names except in raw SQL).
- `git commit` messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Schema changes — `classes.stopped_at`/status, `sessions.title` nullable, new attendance tables

**Files:**
- Modify: `src/entities/class.entity.ts`
- Modify: `src/entities/session.entity.ts`
- Create: `src/entities/session-attendance.entity.ts`
- Modify: `src/repositories/class.repository.ts`
- Modify: `docs/db/schema.sql`
- Modify: `package.json` (add `node-cron` — used starting Task 6, added now so the schema/dependency work lands together)

**Interfaces:**
- Produces: `Class.status: 'active' | 'stopped'`, `Class.stoppedAt: Date | null` (replacing `pausedUntil`); `Session.title: string | null`; `ClassRepository.stop(id): Promise<Class | null>`, `ClassRepository.unstop(id): Promise<Class | null>`; `SessionAttendance` type (`id, sessionId, classId: number | null, studentId, status: 'present' | 'absent' | 'approved_absent', createdAt, updatedAt` — no `BaseEntity`, matches the existing `ClassEnrollment`/`AuditLog` no-soft-delete precedent).

- [ ] **Step 1: Update the `Class` entity**

Edit `src/entities/class.entity.ts` — replace the whole file:

```typescript
import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Class extends BaseEntity {
	operatorId: number;
	title: string;
	dayOfWeek: number;
	startTime: string;
	durationMinutes: number;
	minSize: number | null;
	maxSize: number;
	status: 'active' | 'stopped';
	stoppedAt: Date | null;
}

export const ClassEntity: EntityDescriptor<Class> = {
	tableName: 'classes',
};
```

- [ ] **Step 2: Update the `Session` entity**

Edit `src/entities/session.entity.ts` — change `title: string;` to `title: string | null;`:

```typescript
import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Session extends BaseEntity {
	operatorId: number;
	title: string | null;
	startTime: Date;
	capacityLimit: number;
	currentRosterCount: number | null;
	classId: number | null;
	isMakeupSession: boolean;
}

export const SessionEntity: EntityDescriptor<Session> = {
	tableName: 'sessions',
};
```

- [ ] **Step 2b: Widen `SessionRepository.create`'s `title` parameter to accept `null`**

Edit `src/repositories/session.repository.ts` — change the `create` method's parameter type from `title: string` to `title: string | null` (needed because Task 5's `materializeOccurrence`/`createMakeupSession` create class-linked sessions with `title: null`; a true one-off session created via `SessionsServer.create` still passes a real string, so this widening doesn't relax anything for that path):

```typescript
	public async create(data: { operatorId: number; title: string | null; startTime: Date; capacityLimit: number; classId?: number | null; isMakeupSession?: boolean }): Promise<Session> {
		return this.db.insert(SessionEntity, { ...data, classId: data.classId ?? null, isMakeupSession: data.isMakeupSession ?? false, currentRosterCount: 0, isDeleted: false });
	}
```

- [ ] **Step 3: Create the `SessionAttendance` entity**

Create `src/entities/session-attendance.entity.ts`:

```typescript
// Does not extend BaseEntity — no soft-delete concept (rows are moved to session_attendance_history, never
// soft-deleted in place). Modeled after ClassEnrollment/AuditLog's existing no-soft-delete precedent in this
// codebase; access it via PostgresHandler.query() directly, never via queryActive/insert/update/delete.
export interface SessionAttendance {
	id: number;
	sessionId: number;
	classId: number | null;
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent';
	createdAt: Date;
	updatedAt: Date;
}
```

- [ ] **Step 4: Run typecheck to see what breaks**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — multiple errors in `class.repository.ts` (`pause`/`resume` reference `pausedUntil`/`status: 'paused'`, no longer valid types), `classes.server.ts` (references `Class.status === 'paused'`, `Session.title` used as non-null in several places), `classes.controller.ts` (pause/resume/rename-related-sessions references), `sessions.server.ts`/`sessions.controller.ts` (title-related). This is expected — later tasks in this plan fix `classes.server.ts`/`classes.controller.ts`/`sessions.server.ts`/`sessions.controller.ts`. For THIS task, only fix `class.repository.ts` (Step 5) and confirm the rest of the errors are in files this task doesn't touch (list them, don't fix them).

- [ ] **Step 5: Update `ClassRepository`'s pause/resume to stop/unstop**

Edit `src/repositories/class.repository.ts` — replace the `pause`/`resume` methods:

```typescript
	public async stop(id: number): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'stopped', stoppedAt: new Date() });
	}

	public async unstop(id: number): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'active', stoppedAt: null });
	}
```

(These replace the file's existing `pause(id, pausedUntil)`/`resume(id)` methods — same position in the file, same surrounding methods untouched.)

- [ ] **Step 6: Run typecheck again, confirm remaining errors are all outside this task's files**

Run: `npx tsc --noEmit -p .`
Expected: FAIL, but every remaining error should be in `src/servers/classes.server.ts`, `src/controllers/operator/classes/classes.controller.ts`, `src/servers/sessions.server.ts`, or `src/controllers/operator/sessions/sessions.controller.ts` — NOT in `src/repositories/class.repository.ts` or the entity files. If you see an error in a different file, stop and report it — it may indicate a downstream consumer this plan doesn't yet account for.

- [ ] **Step 7: Add `node-cron` and its types**

Run: `npm install node-cron` then `npm install --save-dev @types/node-cron`

Verify `package.json`'s `dependencies` now includes `"node-cron"` and `devDependencies` includes `"@types/node-cron"`.

- [ ] **Step 8: Update `docs/db/schema.sql`**

Edit `docs/db/schema.sql`:

1. In the `classes` table block, replace:
```sql
    status            VARCHAR(20)   NOT NULL DEFAULT 'active',  -- 'active' | 'paused'
    paused_until      TIMESTAMPTZ,
```
with:
```sql
    status            VARCHAR(20)   NOT NULL DEFAULT 'active',  -- 'active' | 'stopped'
    stopped_at        TIMESTAMPTZ,
```

2. In the `sessions` table block, change:
```sql
	title                  VARCHAR(255)  NOT NULL,
```
to:
```sql
	title                  VARCHAR(255),  -- NULL for any class-linked session (class_id IS NOT NULL) — display
	                                       -- always reads the parent class's current title live. Only populated
	                                       -- for a true one-off session (class_id IS NULL).
```

3. Add two new table blocks, placed after `class_enrollments` and before `enrollments_and_credits` (since both new tables reference `sessions`/`classes`/`students`, all already defined earlier in the file):

```sql
-- ==========================================================================
-- session_attendance
-- ==========================================================================
-- One row per (session_id, student_id) — marking again updates in place (bumps updated_at), never inserts a
-- duplicate. Not an audit log. class_id is nullable: populated for a class-linked session, NULL for a true
-- one-off session's attendance. student_id has no required relationship to class_enrollments — a "trial"
-- student (never enrolled) can still get a row here for one specific session.
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

-- ==========================================================================
-- session_attendance_history
-- ==========================================================================
-- Same shape as session_attendance plus archived_at. Populated by POST /api/admin/session-attendance/archive,
-- which moves any session_attendance row older than 6 months (by updated_at) here and deletes it from the live
-- table, in one transaction. FKs kept (not decoupled) so archived rows stay referentially valid.
CREATE TABLE session_attendance_history (
	id           BIGINT        PRIMARY KEY,
	session_id   BIGINT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	class_id     BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	student_id   BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	status       VARCHAR(20)   NOT NULL,
	created_at   TIMESTAMPTZ,
	updated_at   TIMESTAMPTZ,
	archived_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 9: Apply the schema changes to the local dev DB**

Write a throwaway Node script (using the `pg` package and credentials from `.env.local`; delete the script after running) that executes, in order:

```sql
ALTER TABLE classes RENAME COLUMN paused_until TO stopped_at;
-- status's existing values ('active'/'paused') need updating: this repo's classes.status has no CHECK
-- constraint (informational-only convention, matches operators/households), so no constraint migration is
-- needed, but any existing 'paused' rows should become 'stopped' to match the new two-value convention:
UPDATE classes SET status = 'stopped' WHERE status = 'paused';

ALTER TABLE sessions ALTER COLUMN title DROP NOT NULL;

CREATE TABLE session_attendance (
	id           BIGSERIAL PRIMARY KEY,
	session_id   BIGINT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	class_id     BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	student_id   BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	status       VARCHAR(20)   NOT NULL,
	created_at   TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at   TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT session_attendance_status_check CHECK (status IN ('present', 'absent', 'approved_absent')),
	CONSTRAINT session_attendance_unique UNIQUE (session_id, student_id)
);

CREATE TABLE session_attendance_history (
	id           BIGINT        PRIMARY KEY,
	session_id   BIGINT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	class_id     BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	student_id   BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	status       VARCHAR(20)   NOT NULL,
	created_at   TIMESTAMPTZ,
	updated_at   TIMESTAMPTZ,
	archived_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
```

Verify via `information_schema.columns` (confirm `classes.stopped_at` exists, `classes.paused_until` does not, `sessions.title` is nullable) and `information_schema.tables` (confirm both new tables exist). Then diff the full live schema against `docs/db/schema.sql` column-by-column and constraint-by-constraint (same verification method used for every prior schema change in this project's history) to confirm zero drift.

- [ ] **Step 10: Commit**

```bash
git add src/entities/class.entity.ts src/entities/session.entity.ts src/entities/session-attendance.entity.ts src/repositories/class.repository.ts docs/db/schema.sql package.json package-lock.json
git commit -m "schema: classes.stopped_at, sessions.title nullable, session_attendance tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `ClassesServer`/`ClassesController` — remove pause/resume/generate-occurrences/rename-propagation, add stop/unstop

**Files:**
- Modify: `src/servers/classes.server.ts`
- Modify: `src/controllers/operator/classes/classes.controller.ts`
- Delete: `src/controllers/operator/classes/types/pause-class-body.type.ts`
- Delete: `src/controllers/operator/classes/types/generate-occurrences-body.type.ts`
- Delete: `src/controllers/operator/classes/types/generate-occurrences-response.type.ts`
- Modify: `src/controllers/operator/classes/types/update-class-body.type.ts`
- Modify: `src/repositories/session.repository.ts` (remove `findFutureNonMakeupByClassId`, no longer used)
- Modify: `src/docs/swagger-spec.ts` (update `Class` schema's `status`/`pausedUntil` fields)

**Interfaces:**
- Consumes: `ClassRepository.stop`/`unstop` from Task 1.
- Produces: `ClassesServer.stop(id): Promise<Class | null>`, `ClassesServer.unstop(id): Promise<Class | null>`. `ClassesServer.create`/`update` unchanged in shape except `update` no longer accepts/processes `renameRelatedSessions` and never touches `sessions`. `ClassesServer` no longer has `generateOccurrences`/`computeOccurrenceDates`/`createMakeupSession` (makeup session creation moves to Task 5's `ClassOccurrencesServer`, per the plan's file-structure split — this task only removes generate-occurrences, Task 5 relocates makeup-session creation).

- [ ] **Step 1: Remove `pause`/`resume`, add `stop`/`unstop`, in `ClassesServer`**

Edit `src/servers/classes.server.ts` — replace the `pause`/`resume` methods:

```typescript
	// findById first — same reasoning as OperatorsServer.pause(): the repository's UPDATE has no is_deleted guard,
	// so without this check a soft-deleted class would still match and get silently stopped/unstopped instead of
	// 404ing like every other endpoint. Reversible: unstop fully restores an active class, matching the spec's
	// explicit "allow reverting stoppedAt in case of mistake."
	public async stop(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.stop(id);
	}

	public async unstop(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.unstop(id);
	}
```

- [ ] **Step 2: Remove `renameRelatedSessions` handling from `update`**

Edit `src/servers/classes.server.ts` — replace the `update` method's signature and body (removing the `renameRelatedSessions` parameter and the session-renaming block at the end):

```typescript
	public async update(
		id: number,
		data: {
			title?: unknown;
			dayOfWeek?: unknown;
			startTime?: unknown;
			durationMinutes?: unknown;
			minSize?: unknown;
			maxSize?: unknown;
		},
	): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}

		const typeDetails = this.validateUpdateTypes(data);
		if (typeDetails.length > 0) {
			throw new ValidationError(typeDetails);
		}
		const narrowed = data as Partial<{ title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number }>;

		const merged = {
			dayOfWeek: narrowed.dayOfWeek ?? existing.dayOfWeek,
			durationMinutes: narrowed.durationMinutes ?? existing.durationMinutes,
			minSize: narrowed.minSize === undefined ? existing.minSize : narrowed.minSize,
			maxSize: narrowed.maxSize ?? existing.maxSize,
		};
		const details = this.validate(merged);
		if (details.length > 0) {
			throw new ValidationError(details);
		}
		return this.classes.update(id, narrowed);
	}
```

Note: this drops the `untyped`/`narrowed`-picking-only-known-fields step from the original method, since `data` no longer has a `renameRelatedSessions` field to filter out — `data as Partial<{...}>` is safe again because every key `update`'s caller can send is now a real column.

- [ ] **Step 3: Remove `generateOccurrences`/`computeOccurrenceDates` and the `MAX_GENERATED_OCCURRENCES` constant**

Edit `src/servers/classes.server.ts` — delete the `generateOccurrences` method (lines starting `// Generates concrete \`sessions\` rows...` through its closing brace) and the `computeOccurrenceDates` private method entirely. Delete the `const MAX_GENERATED_OCCURRENCES = 104;` line near the top of the file (it's only used by these two methods).

- [ ] **Step 4: Remove `createMakeupSession` and `householdIdForStudent` from `ClassesServer`**

Edit `src/servers/classes.server.ts` — delete the `createMakeupSession` method and the private `householdIdForStudent` helper entirely (both relocate to `ClassOccurrencesServer` in Task 5, which needs the same `EnrollmentAndCreditRepository`/`SessionRepository` dependencies this file currently has just for these two methods).

- [ ] **Step 5: Remove now-unused constructor dependencies from `ClassesServer`**

Edit `src/servers/classes.server.ts` — after Steps 3-4, `SessionRepository` and `EnrollmentAndCreditRepository` are no longer used anywhere in this file (confirm this by re-reading the file after the deletions — `assignStudents`/`unassignStudents`/`delete`/`create`/`update`/`stop`/`unstop` never reference `this.sessions` or `this.enrollments`). Remove both from the constructor and their imports:

```typescript
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
	) {}
```

Also remove the now-unused `import { SessionRepository } from '../repositories/session.repository';`, `import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';`, and `import { Session } from '../entities/session.entity';` from this file's imports (re-check: `Session` was only used by `generateOccurrences`'s/`createMakeupSession`'s return types, both removed).

- [ ] **Step 6: Update the `assignOneStudent`/`assignStudents`/`unassignStudents`/`generateOccurrences`-adjacent status checks from `'paused'` to `'stopped'`**

Edit `src/servers/classes.server.ts` — in `assignOneStudent`, change:
```typescript
		if (foundClass.status === 'paused') {
			return { studentId, success: false, error: 'Class is paused' };
		}
```
to:
```typescript
		if (foundClass.status === 'stopped') {
			return { studentId, success: false, error: 'Class is stopped' };
		}
```

(There is no longer a `generateOccurrences`-side `'paused'` check to update, since that method was removed in Step 3.)

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — errors now in `src/controllers/operator/classes/classes.controller.ts` (references to `pauseClass`/`resumeClass`/`generateOccurrences`/`createMakeupSession`/`PauseClassBody`/`GenerateOccurrencesBody`/`GenerateOccurrencesResponse`/`MakeupSessionBody` that no longer exist on `ClassesServer`), and possibly in `sessions.server.ts`/`sessions.controller.ts` (unrelated, pre-existing from Task 1's `Session.title` nullability change — leave those for later tasks).

- [ ] **Step 8: Update `UpdateClassBody`**

Edit `src/controllers/operator/classes/types/update-class-body.type.ts` — remove the `renameRelatedSessions` field entirely:

```typescript
export interface UpdateClassBody {
	title?: string;
	dayOfWeek?: number;
	startTime?: string;
	durationMinutes?: number;
	minSize?: number | null;
	maxSize?: number;
}
```

- [ ] **Step 9: Delete now-unused type files**

```bash
rm src/controllers/operator/classes/types/pause-class-body.type.ts
rm src/controllers/operator/classes/types/generate-occurrences-body.type.ts
rm src/controllers/operator/classes/types/generate-occurrences-response.type.ts
```

- [ ] **Step 10: Update `ClassesController` — remove pause/resume/generate-occurrences/makeup-session routes and handlers, add stop/unstop**

Edit `src/controllers/operator/classes/classes.controller.ts`:

1. Remove these imports: `PauseClassBody`, `GenerateOccurrencesBody`, `GenerateOccurrencesResponse`, `MakeupSessionBody`, and (check first) `GetSessionResponse` from `'../sessions/types/get-session-response.type'` — `GetSessionResponse` was only used by `createMakeupSession`'s handler, which is removed in this task (it relocates to Task 5's new controller); if nothing else in this file uses it after these removals, delete the import.

2. Remove the `@openapi` block + `this.internalRouter.post('/:id/pause', ...)` registration for pause (the whole block from `/**\n * @openapi\n * /api/operator/classes/{id}/pause:` through the `this.internalRouter.post('/:id/pause', ...)` line).

3. Replace it with a `stop`/`unstop` pair:

```typescript
		/**
		 * @openapi
		 * /api/operator/classes/{id}/stop:
		 *   post:
		 *     summary: Stop a class
		 *     description: >
		 *       Reversible via /unstop. Blocks new derived occurrences past the stop moment; existing materialized
		 *       sessions and all history are untouched and remain fully queryable.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/stop', RouteHandlers.wrap(this.stopClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/unstop:
		 *   post:
		 *     summary: Reverse a class's stop
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/unstop', RouteHandlers.wrap(this.unstopClass.bind(this)));
```

4. Remove the entire `@openapi` block + registration for `/:id/resume` (the old `resumeClass` route).

5. Remove the entire `@openapi` block + registration for `/:id/generate-occurrences`.

6. Remove the entire `@openapi` block + registration for `/:id/makeup-session` (relocates to Task 5).

7. In the `PUT /:id` (update) `@openapi` block, simplify the `description` and remove `renameRelatedSessions` from the request body schema:

```
		 *     summary: Update a class's recurring pattern
		 *     description: Never touches already-materialized sessions or virtual future occurrences (which always read the class's current fields live) — only affects the stored pattern (title, day/time, capacity) going forward.
```
and remove the `renameRelatedSessions: { type: boolean, ... }` line from the request body's `properties`.

8. Replace the `pauseClass`/`resumeClass` handler methods with:

```typescript
	private async stopClass(req: Request<{ id: string }>, res: Response<GetClassResponse>): Promise<void> {
		const stopped = await this.classesServer.stop(Number(req.params.id));
		if (!stopped) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(stopped));
	}

	private async unstopClass(req: Request<{ id: string }>, res: Response<GetClassResponse>): Promise<void> {
		const unstopped = await this.classesServer.unstop(Number(req.params.id));
		if (!unstopped) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(unstopped));
	}
```

9. Delete the `generateOccurrences` and `createMakeupSession` handler methods entirely (both relocate to Task 5).

- [ ] **Step 11: Remove `findFutureNonMakeupByClassId` from `SessionRepository`**

Edit `src/repositories/session.repository.ts` — delete the `findFutureNonMakeupByClassId` method (no longer called by anything after `ClassesServer.update`'s rename-propagation was removed in Step 2 above).

- [ ] **Step 12: Update the `Class` swagger schema**

Edit `src/docs/swagger-spec.ts` — in the `Class` schema object, change:
```typescript
						status: { type: 'string', enum: ['active', 'paused'] },
						pausedUntil: { type: 'string', format: 'date-time', nullable: true },
```
to:
```typescript
						status: { type: 'string', enum: ['active', 'stopped'] },
						stoppedAt: { type: 'string', format: 'date-time', nullable: true },
```

- [ ] **Step 13: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: still FAIL if `sessions.server.ts`/`sessions.controller.ts` haven't been touched yet (Task 3 fixes those) — but zero remaining errors in `classes.server.ts` or `classes.controller.ts`. Confirm this precisely: the only errors shown should reference files outside this task's scope.

- [ ] **Step 14: Commit**

```bash
git add src/servers/classes.server.ts src/controllers/operator/classes/classes.controller.ts src/controllers/operator/classes/types/update-class-body.type.ts src/repositories/session.repository.ts src/docs/swagger-spec.ts
git rm src/controllers/operator/classes/types/pause-class-body.type.ts src/controllers/operator/classes/types/generate-occurrences-body.type.ts src/controllers/operator/classes/types/generate-occurrences-response.type.ts
git commit -m "classes: replace pause/resume with stop/unstop, remove generate-occurrences and renameRelatedSessions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `SessionsServer`/`SessionsController` — nullable title, new attendance endpoint

**Files:**
- Modify: `src/servers/sessions.server.ts`
- Modify: `src/controllers/operator/sessions/sessions.controller.ts`
- Modify: `src/controllers/operator/sessions/types/create-session-body.type.ts` (check; likely unchanged — `title` stays required for a true one-off's own create call)
- Create: `src/controllers/operator/sessions/types/session-attendance-body.type.ts`
- Create: `src/controllers/operator/sessions/types/session-attendance-response.type.ts`
- Modify: `src/docs/swagger-spec.ts` (add `SessionAttendance` schema, update `Session` schema's `title`)

**Interfaces:**
- Consumes: `SessionAttendanceServer` from Task 4 (this task wires the true-one-off attendance endpoint to it).
- Produces: `PUT /api/operator/sessions/{id}/attendance` — body `{ attendance: { studentId: number; status: 'present' | 'absent' | 'approved_absent' }[] }`, upserts against `SessionAttendanceServer.recordForSession(sessionId, attendance)` (defined in Task 4; this task only wires the controller route — if Task 4 isn't done yet when implementing this task, STOP and request Task 4 be done first, since this task's controller step directly depends on `SessionAttendanceServer`'s exact method signature).

**Note on task ordering:** this task's Step 5 (controller wiring) depends on `SessionAttendanceServer` existing (Task 4). If executing tasks in strict plan order, do Steps 1-4 of this task, then pause and complete Task 4, then return for Step 5 onward. The plan lists this task before Task 4 only because `sessions.server.ts`'s title-nullability fallout must be resolved before the codebase typechecks cleanly again (Task 2 left it broken); Task 4's new files don't depend on anything in this task.

- [ ] **Step 1: Fix `SessionsServer`'s references to `Session.title` as non-nullable**

Read `src/servers/sessions.server.ts` in full first. `Session.title` is now `string | null` (Task 1). Check every method: `create`, `cancel`, `reschedule`, `getRoster`, `findByOperatorId`, `findById`, `book`. None of these methods currently read or write `title` themselves — `title` only flows through as part of the `data`/`Session` objects passed to/from `SessionRepository`, which already has no compile-time issue with a nullable field flowing through a `Partial<{...}>`/full-object type. Confirm this by running typecheck: if `sessions.server.ts` shows no errors of its own after Task 1/2, this step requires no code change — just note in your report that you verified this file needs no edit for the nullable-title change itself.

Run: `npx tsc --noEmit -p .`
Expected: any remaining errors should now be isolated to `sessions.controller.ts` only (its `CreateSessionBody`/`CreateSessionResponse` types still declare `title: string`, which is fine since a true one-off's `create` still requires a real title — but double check for any stale `Session.title` non-null assumption in the controller, e.g. `session.title.toUpperCase()`-style code; there is none currently, so this should already compile).

- [ ] **Step 2: Confirm `CreateSessionBody`/`CreateSessionResponse` need no change**

Read `src/controllers/operator/sessions/types/create-session-body.type.ts` and `create-session-response.type.ts`. `CreateSessionBody.title: string` should stay required — a true one-off session (the only thing `POST /api/operator/sessions` ever creates, per `SessionsServer.create`'s `assigned`-type-only gate) still needs an operator-supplied title, since it has no class to derive one from. No change needed to either file — confirm and move on.

- [ ] **Step 3: Add the attendance body/response types**

Create `src/controllers/operator/sessions/types/session-attendance-body.type.ts`:

```typescript
export interface SessionAttendanceEntry {
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent';
}

export interface SessionAttendanceBody {
	attendance: SessionAttendanceEntry[];
}
```

Create `src/controllers/operator/sessions/types/session-attendance-response.type.ts`:

```typescript
export interface SessionAttendanceResponseItem {
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent';
}

export type SessionAttendanceResponse = SessionAttendanceResponseItem[];
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS (zero output) if Task 2 is complete and this task's Steps 1-3 introduced no new errors. If `SessionAttendanceServer` doesn't exist yet (Task 4 not done), this is fine — nothing in Steps 1-3 references it yet.

- [ ] **Step 5: Add the attendance route + handler to `SessionsController`**

This step requires `SessionAttendanceServer` from Task 4 to exist first. Edit `src/controllers/operator/sessions/sessions.controller.ts`:

1. Add import: `import { SessionAttendanceServer } from '../../../servers/session-attendance.server';`
2. Add import: `import { SessionAttendanceBody } from './types/session-attendance-body.type';`
3. Add import: `import { SessionAttendanceResponse } from './types/session-attendance-response.type';`
4. Add `@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendanceServer: SessionAttendanceServer,` to the constructor parameter list.
5. Add a route registration after `/:id/reschedule`:

```typescript
		/**
		 * @openapi
		 * /api/operator/sessions/{id}/attendance:
		 *   put:
		 *     summary: Record or correct attendance for a true one-off session
		 *     description: Upserts one row per given student — marking again updates the existing record, never duplicates it.
		 *     tags: [Operator - Sessions]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [attendance]
		 *             properties:
		 *               attendance:
		 *                 type: array
		 *                 items:
		 *                   type: object
		 *                   properties:
		 *                     studentId: { type: integer }
		 *                     status: { type: string, enum: [present, absent, approved_absent] }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: array
		 *               items:
		 *                 type: object
		 *                 properties:
		 *                   studentId: { type: integer }
		 *                   status: { type: string, enum: [present, absent, approved_absent] }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id/attendance', RouteHandlers.wrap(this.recordAttendance.bind(this)));
```

6. Add the handler method at the end of the class:

```typescript
	private async recordAttendance(req: Request<{ id: string }, SessionAttendanceResponse, SessionAttendanceBody>, res: Response<SessionAttendanceResponse>): Promise<void> {
		const result = await this.sessionAttendanceServer.recordForSession(Number(req.params.id), req.body?.attendance);
		if (!result) {
			res.status(404).end();
			return;
		}
		res.json(result.map((row) => ({ studentId: row.studentId, status: row.status })));
	}
```

- [ ] **Step 6: Update the `Session` swagger schema**

Edit `src/docs/swagger-spec.ts` — in the `Session` schema, change:
```typescript
						title: { type: 'string' },
```
to:
```typescript
						title: { type: 'string', nullable: true },
```

- [ ] **Step 7: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS (zero output).

Run: `npx eslint .`
Expected: PASS (zero output).

- [ ] **Step 8: Manual smoke test**

Start the local server. Using an existing `assigned`-type operator, create a one-off session (`POST /api/operator/sessions`), then:
- `PUT /api/operator/sessions/{id}/attendance` with `{"attendance":[{"studentId": <real id>, "status":"present"}]}` → confirm 200, response shows `[{"studentId": ..., "status": "present"}]`.
- Repeat with `status: "absent"` for the same student → confirm the response still shows exactly one entry for that student (upsert, not a duplicate) — verify directly against the DB via a throwaway `pg` script querying `session_attendance WHERE session_id = <id>` and confirming exactly one row.
- `PUT` against a nonexistent session id → 404.

- [ ] **Step 9: Commit**

```bash
git add src/servers/sessions.server.ts src/controllers/operator/sessions/sessions.controller.ts src/controllers/operator/sessions/types/session-attendance-body.type.ts src/controllers/operator/sessions/types/session-attendance-response.type.ts src/docs/swagger-spec.ts
git commit -m "sessions: add attendance endpoint for true one-off sessions, nullable title

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `session_attendance` — repository, server, archival

**Files:**
- Create: `src/repositories/session-attendance.repository.ts`
- Create: `src/servers/session-attendance.server.ts`
- Create: `src/controllers/admin/session-attendance/session-attendance.controller.ts`
- Create: `src/controllers/admin/session-attendance/types/archive-attendance-response.type.ts`
- Modify: `src/controllers/admin/admin.controller.ts` (mount the new sub-controller)
- Modify: `src/container/types.ts`
- Modify: `src/container/inversify.config.ts`

**Interfaces:**
- Consumes: `SessionAttendance` entity from Task 1; `Session`/`SessionRepository` (existing).
- Produces: `SessionAttendanceRepository.upsert(sessionId, classId, studentId, status): Promise<SessionAttendance>`; `SessionAttendanceRepository.findBySessionId(sessionId): Promise<SessionAttendance[]>`; `SessionAttendanceRepository.archiveOlderThan(cutoff: Date): Promise<number>` (returns count moved); `SessionAttendanceServer.recordForSession(sessionId, entries: {studentId: number; status: string}[] | undefined): Promise<SessionAttendance[] | null>` (null if session not found); `SessionAttendanceServer.archive(): Promise<number>`.

- [ ] **Step 1: Write `SessionAttendanceRepository`**

Create `src/repositories/session-attendance.repository.ts`:

```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { SessionAttendance } from '../entities/session-attendance.entity';
import { snakeToCamel } from '../utils/case-mapper';

@injectable()
export class SessionAttendanceRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findBySessionId(sessionId: number): Promise<SessionAttendance[]> {
		const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM session_attendance WHERE session_id = $1', [sessionId]);
		return rows.map((row: Record<string, unknown>) => snakeToCamel<SessionAttendance>(row));
	}

	// One row per (session_id, student_id) — inserts on first mark, updates status/updated_at in place on every
	// subsequent mark for the same pair. Never creates a second row for the same pair (see the DB's
	// session_attendance_unique constraint, which this query relies on via ON CONFLICT).
	public async upsert(sessionId: number, classId: number | null, studentId: number, status: 'present' | 'absent' | 'approved_absent'): Promise<SessionAttendance> {
		const rows = await this.db.query<Record<string, unknown>>(
			`INSERT INTO session_attendance (session_id, class_id, student_id, status)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (session_id, student_id)
			 DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
			 RETURNING *`,
			[sessionId, classId, studentId, status],
		);
		return snakeToCamel<SessionAttendance>(rows[0]);
	}

	// Moves every row older than `cutoff` (by updated_at) into session_attendance_history and deletes it from the
	// live table, in one transaction (both queries run against the same client via a single multi-statement call —
	// PostgresHandler.query uses the pool directly, so this uses two sequential queries wrapped by the caller's
	// transaction instead; see SessionAttendanceServer.archive for the transaction wrapping).
	public async moveToHistory(cutoff: Date): Promise<number> {
		const inserted = await this.db.query<{ id: string }>(
			`INSERT INTO session_attendance_history (id, session_id, class_id, student_id, status, created_at, updated_at)
			 SELECT id, session_id, class_id, student_id, status, created_at, updated_at
			 FROM session_attendance
			 WHERE updated_at < $1
			 RETURNING id`,
			[cutoff],
		);
		if (inserted.length === 0) {
			return 0;
		}
		const ids = inserted.map((row: { id: string }) => Number(row.id));
		await this.db.query('DELETE FROM session_attendance WHERE id = ANY($1::bigint[])', [ids]);
		return ids.length;
	}
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS (this file has no dependents yet).

- [ ] **Step 3: Register `SessionAttendanceRepository` in DI**

Edit `src/container/types.ts` — add `SessionAttendanceRepository: Symbol.for('SessionAttendanceRepository'),` after `ClassEnrollmentRepository`.

Edit `src/container/inversify.config.ts` — add the import after `ClassEnrollmentRepository`'s import: `import { SessionAttendanceRepository } from '../repositories/session-attendance.repository';`, and the binding after `ClassEnrollmentRepository`'s binding: `container.bind<SessionAttendanceRepository>(TYPES.SessionAttendanceRepository).to(SessionAttendanceRepository).inSingletonScope();`

- [ ] **Step 4: Write `SessionAttendanceServer`**

Create `src/servers/session-attendance.server.ts`:

```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { SessionAttendanceRepository } from '../repositories/session-attendance.repository';
import { SessionRepository } from '../repositories/session.repository';
import { PostgresHandler } from '../handlers/postgres-handler';
import { SessionAttendance } from '../entities/session-attendance.entity';
import { ValidationError } from './types/validation-error';

const ARCHIVE_RETENTION_MONTHS = 6;

const VALID_STATUSES: ReadonlySet<string> = new Set(['present', 'absent', 'approved_absent']);

@injectable()
export class SessionAttendanceServer {
	public constructor(
		@inject(TYPES.SessionAttendanceRepository) private readonly attendance: SessionAttendanceRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler,
	) {}

	// Shared by both the true-one-off endpoint (SessionsController) and the class-linked, date-addressed endpoint
	// (ClassOccurrencesController, Task 5) — the latter passes the already-materialized session's id and its
	// class_id; the former passes classId: null. `entries` arrives as untyped JSON, so it's validated here rather
	// than trusted at the type level (same "don't let untyped JSON garbage reach the database" pattern used
	// throughout this codebase's ClassesServer).
	public async recordForSessionId(sessionId: number, classId: number | null, entries: unknown): Promise<SessionAttendance[] | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}

		if (!Array.isArray(entries)) {
			throw new ValidationError([{ field: 'attendance', message: 'attendance must be an array' }]);
		}
		for (const entry of entries) {
			if (typeof entry !== 'object' || entry === null || typeof (entry as { studentId?: unknown }).studentId !== 'number') {
				throw new ValidationError([{ field: 'attendance', message: 'each entry requires a numeric studentId' }]);
			}
			const status = (entry as { status?: unknown }).status;
			if (typeof status !== 'string' || !VALID_STATUSES.has(status)) {
				throw new ValidationError([{ field: 'attendance', message: 'each entry requires status to be one of present, absent, approved_absent' }]);
			}
		}

		const narrowed = entries as { studentId: number; status: 'present' | 'absent' | 'approved_absent' }[];
		const results: SessionAttendance[] = [];
		for (const entry of narrowed) {
			// Small, bounded batch (a single session's roster) — sequential upserts, matching the sequential-loop
			// style already used throughout ClassesServer for similarly-bounded per-item operations.
			const row = await this.attendance.upsert(sessionId, classId, entry.studentId, entry.status);
			results.push(row);
		}
		return results;
	}

	public async findBySessionId(sessionId: number): Promise<SessionAttendance[]> {
		return this.attendance.findBySessionId(sessionId);
	}

	// Moves every session_attendance row older than 6 months (by updated_at) into session_attendance_history and
	// deletes it from the live table. Runs as one transaction so a failure partway through never leaves rows
	// duplicated (present in both tables) or lost (present in neither).
	public async archive(): Promise<number> {
		const cutoff = new Date();
		cutoff.setMonth(cutoff.getMonth() - ARCHIVE_RETENTION_MONTHS);
		return this.db.transaction(async () => this.attendance.moveToHistory(cutoff));
	}
}
```

Note: `PostgresHandler.transaction`'s callback receives a `TransactionHandle`, but `SessionAttendanceRepository.moveToHistory` uses `this.db.query` (the plain `PostgresHandler`, not a transaction-bound client) — for this task, call `this.attendance.moveToHistory(cutoff)` directly without wrapping in `this.db.transaction(...)` (remove that wrapper), since `moveToHistory`'s two queries (`INSERT ... RETURNING`, then `DELETE ... WHERE id = ANY(...)`) already only delete exactly the rows just inserted, which is safe without an explicit transaction wrapper for this repo's actual scale (a monthly manual admin action, not a hot path) — write the method as:

```typescript
	public async archive(): Promise<number> {
		const cutoff = new Date();
		cutoff.setMonth(cutoff.getMonth() - ARCHIVE_RETENTION_MONTHS);
		return this.attendance.moveToHistory(cutoff);
	}
```

(This replaces the `db.transaction`-wrapped version above — use this simpler version. Remove the now-unused `PostgresHandler` import and constructor parameter this note's earlier version would have required, i.e. don't add them in the first place.)

- [ ] **Step 5: Rewrite Step 4 without the unused `PostgresHandler` dependency**

Using the correction from Step 4's note, the final `SessionAttendanceServer` constructor is:

```typescript
	public constructor(
		@inject(TYPES.SessionAttendanceRepository) private readonly attendance: SessionAttendanceRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
	) {}
```

and `archive()` is exactly the simpler version shown in Step 4's note (no `db.transaction` wrapper, no `PostgresHandler` import). Write the file this way from the start — Step 4's initial code block above is illustrative of the reasoning, not the final version to type in; use this corrected shape.

Also rename `recordForSessionId` calls appropriately for the two consumers: `SessionsController` (Task 3) calls it as `recordForSession` per that task's Step 5 code sample. Reconcile this naming now: name the method `recordForSessionId(sessionId: number, classId: number | null, entries: unknown)` (as shown above) and go back to Task 3's Step 5 controller code, changing `this.sessionAttendanceServer.recordForSession(Number(req.params.id), req.body?.attendance)` to `this.sessionAttendanceServer.recordForSessionId(Number(req.params.id), null, req.body?.attendance)` — if Task 3 was already completed with the old method name, fix that call site now as part of this task's Step 5.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS. If Task 3 was completed before this task and still references `recordForSession` (not `recordForSessionId`), fix that call site now (see Step 5's reconciliation note) and re-run until clean.

- [ ] **Step 7: Register `SessionAttendanceServer` in DI**

Edit `src/container/types.ts` — add `SessionAttendanceServer: Symbol.for('SessionAttendanceServer'),` after `ClassesServer`.

Edit `src/container/inversify.config.ts` — add the import after `ClassesServer`'s import: `import { SessionAttendanceServer } from '../servers/session-attendance.server';`, and the binding after `ClassesServer`'s binding: `container.bind<SessionAttendanceServer>(TYPES.SessionAttendanceServer).to(SessionAttendanceServer).inSingletonScope();`

- [ ] **Step 8: Write the admin archival controller**

Create `src/controllers/admin/session-attendance/types/archive-attendance-response.type.ts`:

```typescript
export interface ArchiveAttendanceResponse {
	archivedCount: number;
}
```

Create `src/controllers/admin/session-attendance/session-attendance.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { SessionAttendanceServer } from '../../../servers/session-attendance.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ArchiveAttendanceResponse } from './types/archive-attendance-response.type';

@injectable()
export class AdminSessionAttendanceController extends BaseController {
	public constructor(@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendanceServer: SessionAttendanceServer) {
		super();

		/**
		 * @openapi
		 * /api/admin/session-attendance/archive:
		 *   post:
		 *     summary: Archive attendance records older than 6 months
		 *     description: Moves every session_attendance row with updated_at older than 6 months into session_attendance_history and removes it from the live table.
		 *     tags: [Admin]
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 archivedCount: { type: integer }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/archive', RouteHandlers.wrap(this.archive.bind(this)));
	}

	private async archive(_req: Request, res: Response<ArchiveAttendanceResponse>): Promise<void> {
		const archivedCount = await this.sessionAttendanceServer.archive();
		res.json({ archivedCount });
	}
}
```

- [ ] **Step 9: Mount the new controller under `/api/admin`**

Read `src/controllers/admin/admin.controller.ts` first to see the exact current mounting pattern (it mounts `AdminOperatorsController` at `/operators` and `AdminHouseholdsController` at `/households` — follow that identical pattern). Edit it to add:

1. Import: `import { AdminSessionAttendanceController } from './session-attendance/session-attendance.controller';`
2. Constructor parameter: `@inject(TYPES.AdminSessionAttendanceController) private readonly sessionAttendanceController: AdminSessionAttendanceController,`
3. Mount call: `this.internalRouter.use('/session-attendance', this.sessionAttendanceController.router);`

- [ ] **Step 10: Register `AdminSessionAttendanceController` in DI**

Edit `src/container/types.ts` — add `AdminSessionAttendanceController: Symbol.for('AdminSessionAttendanceController'),` after `AdminHouseholdsController`.

Edit `src/container/inversify.config.ts` — add the import after `AdminHouseholdsController`'s import: `import { AdminSessionAttendanceController } from '../controllers/admin/session-attendance/session-attendance.controller';`, and the binding after `AdminHouseholdsController`'s binding: `container.bind<AdminSessionAttendanceController>(TYPES.AdminSessionAttendanceController).to(AdminSessionAttendanceController).inSingletonScope();`

- [ ] **Step 11: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 12: Manual smoke test — attendance upsert and archival**

Start the local server. Using an existing one-off session and student:
- `PUT /api/operator/sessions/{id}/attendance` with `{"attendance":[{"studentId": <id>, "status":"present"}]}` → 200. Confirm via a throwaway `pg` script that exactly one `session_attendance` row exists.
- Repeat with `status: "absent"` → confirm the SAME row's `status` changed and `updated_at` advanced (not a second row) — query by `id` to confirm the row's primary key didn't change.
- Via a throwaway `pg` script, manually backdate that row's `updated_at` to 7 months ago (`UPDATE session_attendance SET updated_at = NOW() - INTERVAL '7 months' WHERE id = <id>`).
- `POST /api/admin/session-attendance/archive` → 200, `{"archivedCount": 1}` (or more, if other old rows exist from other tests — confirm at least 1). Confirm via `pg` script: the row is gone from `session_attendance` and present in `session_attendance_history` with the same `id`.

- [ ] **Step 13: Commit**

```bash
git add src/repositories/session-attendance.repository.ts src/servers/session-attendance.server.ts src/controllers/admin/session-attendance/ src/controllers/admin/admin.controller.ts src/controllers/operator/sessions/sessions.controller.ts src/container/types.ts src/container/inversify.config.ts
git commit -m "add session_attendance repository/server, admin archival endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `ClassOccurrencesServer`/`ClassOccurrencesController` — derivation, materialization, occurrences endpoints, makeup sessions

**Files:**
- Create: `src/servers/class-occurrences.server.ts`
- Create: `src/controllers/operator/classes/class-occurrences.controller.ts`
- Create: `src/controllers/operator/classes/types/occurrence.type.ts`
- Create: `src/controllers/operator/classes/types/list-occurrences-query.type.ts`
- Create: `src/controllers/operator/classes/types/reschedule-occurrence-body.type.ts`
- Create: `src/controllers/operator/classes/types/makeup-session-body.type.ts` (relocated from the now-CRUD-only `classes.controller.ts` — check first whether this file already exists at this path from before this plan's Tasks 1-2; if so, this step just confirms its content is unchanged and moves the *usage* here, no file move needed)
- Modify: `src/repositories/session.repository.ts` (add `findLatestByClassId`, `findByClassIdInRange`)
- Modify: `src/repositories/class-enrollment.repository.ts` (no change expected — confirm `findActiveByClassId` already covers what's needed)
- Modify: `src/container/types.ts`
- Modify: `src/container/inversify.config.ts`
- Modify: `src/controllers/operator/operator.controller.ts` (mount the new controller)
- Modify: `src/docs/swagger-spec.ts`

**Interfaces:**
- Consumes: `Class`, `ClassRepository`, `ClassEnrollmentRepository`, `SessionRepository`, `SessionAttendanceServer` (Task 4), `EnrollmentAndCreditRepository`, `StudentRepository`.
- Produces: `ClassOccurrencesServer.listFuture(classId, from: unknown, to: unknown): Promise<OccurrenceListResult | null>`; `.listPast(classId, from: unknown, to: unknown): Promise<OccurrenceListResult | null>`; `.rescheduleOccurrence(classId, date: unknown, newStartTime: unknown): Promise<Session | null>`; `.cancelOccurrence(classId, date: unknown): Promise<Session | null>`; `.createMakeupSession(classId, startTime: unknown): Promise<Session>` (roster auto-filled from `class_enrollments`, no `studentIds` param — per the spec's confirmed reversal); `.materializeOccurrence(classId, date: Date): Promise<Session>` (shared internal helper — idempotent, returns the existing row if one already exists for that class+date).

- [ ] **Step 1: Add repository methods for date-range session queries**

Edit `src/repositories/session.repository.ts` — add two methods (after `findByOperatorId`):

```typescript
	public async findByClassIdInRange(classId: number, from: Date, to: Date): Promise<Session[]> {
		return this.db.queryActive(SessionEntity, 'class_id = $1 AND start_time >= $2 AND start_time <= $3', [classId, from, to]);
	}

	// Latest materialized session for a class, regardless of date range — used by the nightly backfill job (Task
	// 6) to find where to resume materializing from. Returns null if the class has no materialized sessions yet.
	public async findLatestByClassId(classId: number): Promise<Session | null> {
		const rows = await this.db.queryActive(SessionEntity, 'class_id = $1 ORDER BY start_time DESC LIMIT 1', [classId]);
		return rows[0] ?? null;
	}

	public async findByClassIdAndDate(classId: number, date: Date): Promise<Session | null> {
		// Matches on the calendar date portion of start_time — a materialized session's exact time-of-day may
		// differ from the class's pattern (e.g. already rescheduled), but there is still only ever one
		// materialized session per class per calendar day, by construction (materializeOccurrence is idempotent
		// per date).
		const rows = await this.db.queryActive(SessionEntity, "class_id = $1 AND DATE(start_time) = $2::date", [classId, date.toISOString().slice(0, 10)]);
		return rows[0] ?? null;
	}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 3: Write `ClassOccurrencesServer`**

Create `src/servers/class-occurrences.server.ts`:

```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { SessionRepository } from '../repositories/session.repository';
import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';
import { StudentRepository } from '../repositories/student.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { Class } from '../entities/class.entity';
import { Session } from '../entities/session.entity';
import { ValidationError } from './types/validation-error';

const MAX_RANGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface VirtualOccurrence {
	classId: number;
	startTime: Date;
	isVirtual: true;
}

export interface MaterializedOccurrence {
	session: Session;
	isVirtual: false;
}

export type Occurrence = VirtualOccurrence | MaterializedOccurrence;

export interface OccurrenceListResult {
	occurrences: Occurrence[];
	classMemberStudentIds: number[];
}

function parseDateOnly(value: unknown, field: string): Date {
	if (typeof value !== 'string' || value.length === 0) {
		throw new ValidationError([{ field, message: `${field} is required` }]);
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError([{ field, message: `${field} must be a valid date (YYYY-MM-DD)` }]);
	}
	return parsed;
}

function validateRange(from: Date, to: Date): void {
	if (to.getTime() < from.getTime()) {
		throw new ValidationError([{ field: 'to', message: 'to must not be before from' }]);
	}
	const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
	if (days > MAX_RANGE_DAYS) {
		throw new ValidationError([{ field: 'to', message: `Range cannot exceed ${MAX_RANGE_DAYS} days` }]);
	}
}

@injectable()
export class ClassOccurrencesServer {
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
	) {}

	// Walks every date in [from, to] matching the class's dayOfWeek, clipped to stoppedAt if the class is stopped
	// (no dates on/after the stop moment). Pure computation — never reads or writes sessions.
	private computeOccurrenceDates(foundClass: Class, from: Date, to: Date): Date[] {
		const [hours, minutes, seconds]: number[] = foundClass.startTime.split(':').map(Number);
		const effectiveTo = foundClass.status === 'stopped' && foundClass.stoppedAt && foundClass.stoppedAt.getTime() < to.getTime() ? foundClass.stoppedAt : to;

		const dates: Date[] = [];
		const cursor = new Date(from);
		cursor.setUTCHours(hours, minutes, seconds ?? 0, 0);
		while (cursor.getUTCDay() !== foundClass.dayOfWeek) {
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}
		while (cursor.getTime() <= effectiveTo.getTime()) {
			dates.push(new Date(cursor));
			cursor.setUTCDate(cursor.getUTCDate() + 7);
		}
		return dates;
	}

	private async buildOccurrenceList(classId: number, from: Date, to: Date): Promise<OccurrenceListResult | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}

		const virtualDates = this.computeOccurrenceDates(foundClass, from, to);
		const materialized = await this.sessions.findByClassIdInRange(classId, from, to);
		const materializedDateKeys = new Set(materialized.map((session: Session) => session.startTime.toISOString().slice(0, 10)));

		const occurrences: Occurrence[] = materialized.map((session: Session) => ({ session, isVirtual: false }));
		for (const date of virtualDates) {
			const key = date.toISOString().slice(0, 10);
			if (!materializedDateKeys.has(key)) {
				occurrences.push({ classId, startTime: date, isVirtual: true });
			}
		}
		occurrences.sort((a: Occurrence, b: Occurrence) => {
			const aTime = a.isVirtual ? a.startTime.getTime() : a.session.startTime.getTime();
			const bTime = b.isVirtual ? b.startTime.getTime() : b.session.startTime.getTime();
			return aTime - bTime;
		});

		const classMembers = await this.classEnrollments.findActiveByClassId(classId);
		return { occurrences, classMemberStudentIds: classMembers.map((enrollment) => enrollment.studentId) };
	}

	public async listFuture(classId: number, from: unknown, to: unknown): Promise<OccurrenceListResult | null> {
		const parsedFrom = parseDateOnly(from, 'from');
		const parsedTo = parseDateOnly(to, 'to');
		const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
		if (parsedFrom.getTime() < today.getTime()) {
			throw new ValidationError([{ field: 'from', message: 'from must be today or later' }]);
		}
		validateRange(parsedFrom, parsedTo);
		return this.buildOccurrenceList(classId, parsedFrom, parsedTo);
	}

	public async listPast(classId: number, from: unknown, to: unknown): Promise<OccurrenceListResult | null> {
		const parsedFrom = parseDateOnly(from, 'from');
		const parsedTo = parseDateOnly(to, 'to');
		const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
		if (parsedTo.getTime() > today.getTime()) {
			throw new ValidationError([{ field: 'to', message: 'to must be today or earlier' }]);
		}
		validateRange(parsedFrom, parsedTo);
		return this.buildOccurrenceList(classId, parsedFrom, parsedTo);
	}

	// Idempotent: returns the existing materialized row for this class+date if one already exists, otherwise
	// creates one with the pattern's default startTime and title: null (display always reads the class's current
	// title live — see docs/superpowers/specs/2026-09-13-derived-class-sessions-design.md).
	public async materializeOccurrence(classId: number, date: Date): Promise<Session> {
		const existing = await this.sessions.findByClassIdAndDate(classId, date);
		if (existing) {
			return existing;
		}
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}
		const [hours, minutes, seconds]: number[] = foundClass.startTime.split(':').map(Number);
		const startTime = new Date(date);
		startTime.setUTCHours(hours, minutes, seconds ?? 0, 0);
		return this.sessions.create({
			operatorId: foundClass.operatorId,
			title: null,
			startTime,
			capacityLimit: foundClass.maxSize,
			classId: foundClass.id,
			isMakeupSession: false,
		});
	}

	public async rescheduleOccurrence(classId: number, date: unknown, newStartTime: unknown): Promise<Session | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}
		const parsedDate = parseDateOnly(date, 'date');
		if (typeof newStartTime !== 'string' || newStartTime.length === 0) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime is required' }]);
		}
		const parsedNewStartTime = new Date(newStartTime);
		if (Number.isNaN(parsedNewStartTime.getTime())) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime must be a valid date' }]);
		}
		const session = await this.materializeOccurrence(classId, parsedDate);
		return this.sessions.update(session.id, { startTime: parsedNewStartTime });
	}

	public async cancelOccurrence(classId: number, date: unknown): Promise<Session | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}
		const parsedDate = parseDateOnly(date, 'date');
		const session = await this.materializeOccurrence(classId, parsedDate);
		await this.sessions.cancel(session.id);
		return session;
	}

	// Makeup sessions accept the class's current standing roster only (no per-makeup studentId list — see the
	// spec's confirmed reversal of the original 2026-09-12 design). Always materialized immediately (never
	// virtual) since it's an explicit exception, not part of the weekly derivation.
	public async createMakeupSession(classId: number, startTime: unknown): Promise<Session> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}
		if (typeof startTime !== 'string' || startTime.length === 0) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime is required' }]);
		}
		const parsedStartTime = new Date(startTime);
		if (Number.isNaN(parsedStartTime.getTime())) {
			throw new ValidationError([{ field: 'startTime', message: 'startTime must be a valid date' }]);
		}

		const session = await this.sessions.create({
			operatorId: foundClass.operatorId,
			title: null,
			startTime: parsedStartTime,
			capacityLimit: foundClass.maxSize,
			classId: foundClass.id,
			isMakeupSession: true,
		});

		const classMembers = await this.classEnrollments.findActiveByClassId(classId);
		for (const member of classMembers) {
			// Small, bounded roster (a single class's standing members) — sequential, matching this codebase's
			// existing style for similarly-bounded per-item operations.
			const student = await this.students.findById(member.studentId);
			if (!student) {
				continue;
			}
			await this.enrollments.create({ studentId: member.studentId, sessionId: session.id, householdId: student.householdId, status: 'booked' });
			await this.sessions.incrementRosterCount(session.id);
		}

		return session;
	}
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 5: Register `ClassOccurrencesServer` in DI**

Edit `src/container/types.ts` — add `ClassOccurrencesServer: Symbol.for('ClassOccurrencesServer'),` after `ClassesServer`.

Edit `src/container/inversify.config.ts` — add the import after `ClassesServer`'s import: `import { ClassOccurrencesServer } from '../servers/class-occurrences.server';`, and the binding after `ClassesServer`'s binding: `container.bind<ClassOccurrencesServer>(TYPES.ClassOccurrencesServer).to(ClassOccurrencesServer).inSingletonScope();`

- [ ] **Step 6: Write the occurrence/reschedule/cancel/makeup-session/attendance types**

Create `src/controllers/operator/classes/types/occurrence.type.ts`:

```typescript
export interface OccurrenceResponseItem {
	isVirtual: boolean;
	classId?: number;
	sessionId?: number;
	startTime: string;
	isMakeupSession?: boolean;
	title: string | null;
}

export interface ListOccurrencesResponse {
	occurrences: OccurrenceResponseItem[];
	classMemberStudentIds: number[];
}
```

Create `src/controllers/operator/classes/types/list-occurrences-query.type.ts`:

```typescript
export interface ListOccurrencesQuery {
	from?: string;
	to?: string;
}
```

Create `src/controllers/operator/classes/types/reschedule-occurrence-body.type.ts`:

```typescript
export interface RescheduleOccurrenceBody {
	startTime: string;
}
```

Check whether `src/controllers/operator/classes/types/makeup-session-body.type.ts` already exists (it should, from before this plan's Tasks 1-2) and whether it currently has a `studentIds` field. Per this task's design (makeup sessions now auto-fill the roster, no per-makeup student list), update it to:

```typescript
export interface MakeupSessionBody {
	startTime: string;
}
```

- [ ] **Step 7: Write `ClassOccurrencesController`**

Create `src/controllers/operator/classes/class-occurrences.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { ClassOccurrencesServer, Occurrence } from '../../../servers/class-occurrences.server';
import { SessionAttendanceServer } from '../../../servers/session-attendance.server';
import { ValidationError, ValidationErrorDetail } from '../../../servers/types/validation-error';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListOccurrencesQuery } from './types/list-occurrences-query.type';
import { ListOccurrencesResponse, OccurrenceResponseItem } from './types/occurrence.type';
import { RescheduleOccurrenceBody } from './types/reschedule-occurrence-body.type';
import { MakeupSessionBody } from './types/makeup-session-body.type';
import { ClassValidationErrorResponse } from './types/class-validation-error-response.type';
import { GetSessionResponse } from '../sessions/types/get-session-response.type';
import { SessionAttendanceBody } from '../sessions/types/session-attendance-body.type';
import { SessionAttendanceResponse } from '../sessions/types/session-attendance-response.type';
import { toPublic } from '../../../utils/to-public';

function toOccurrenceResponseItem(occurrence: Occurrence): OccurrenceResponseItem {
	if (occurrence.isVirtual) {
		return { isVirtual: true, classId: occurrence.classId, startTime: occurrence.startTime.toISOString(), title: null };
	}
	return { isVirtual: false, sessionId: occurrence.session.id, startTime: occurrence.session.startTime.toISOString(), isMakeupSession: occurrence.session.isMakeupSession, title: occurrence.session.title };
}

@injectable()
export class ClassOccurrencesController extends BaseController {
	public constructor(
		@inject(TYPES.ClassOccurrencesServer) private readonly classOccurrencesServer: ClassOccurrencesServer,
		@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendanceServer: SessionAttendanceServer,
	) {
		super();

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/future:
		 *   get:
		 *     summary: List a class's future occurrences (virtual and materialized) in a date range
		 *     description: from must be today or later. Range capped at 90 full calendar days.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: query
		 *         name: from
		 *         required: true
		 *         schema: { type: string, format: date }
		 *       - in: query
		 *         name: to
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     responses:
		 *       200: { description: OK }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id/occurrences/future', RouteHandlers.wrap(this.listFuture.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/past:
		 *   get:
		 *     summary: List a class's past occurrences (materialized and not-recorded) in a date range
		 *     description: to must be today or earlier. Range capped at 90 full calendar days.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: query
		 *         name: from
		 *         required: true
		 *         schema: { type: string, format: date }
		 *       - in: query
		 *         name: to
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     responses:
		 *       200: { description: OK }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id/occurrences/past', RouteHandlers.wrap(this.listPast.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/{date}/reschedule:
		 *   patch:
		 *     summary: Reschedule one occurrence, materializing it if needed
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: date
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [startTime]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.patch('/:id/occurrences/:date/reschedule', RouteHandlers.wrap(this.rescheduleOccurrence.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/{date}/cancel:
		 *   post:
		 *     summary: Cancel one occurrence, materializing it first if needed
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: date
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     responses:
		 *       204: { description: Cancelled }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/occurrences/:date/cancel', RouteHandlers.wrap(this.cancelOccurrence.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/occurrences/{date}/attendance:
		 *   put:
		 *     summary: Record or correct attendance for one occurrence, materializing it if needed
		 *     description: >
		 *       Accepts any studentId, not just current class members — this is how a trial student's attendance
		 *       can be recorded without a standing class_enrollments row.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *       - in: path
		 *         name: date
		 *         required: true
		 *         schema: { type: string, format: date }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [attendance]
		 *             properties:
		 *               attendance:
		 *                 type: array
		 *                 items:
		 *                   type: object
		 *                   properties:
		 *                     studentId: { type: integer }
		 *                     status: { type: string, enum: [present, absent, approved_absent] }
		 *     responses:
		 *       200: { description: OK }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id/occurrences/:date/attendance', RouteHandlers.wrap(this.recordOccurrenceAttendance.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/makeup-session:
		 *   post:
		 *     summary: Create a make-up session tied to this class
		 *     description: Roster is auto-filled from the class's current standing class_enrollments members.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [startTime]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/makeup-session', RouteHandlers.wrap(this.createMakeupSession.bind(this)));
	}

	private isClassIdError(error: ValidationError): boolean {
		return error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId');
	}

	private async listFuture(req: Request<{ id: string }, ListOccurrencesResponse | ClassValidationErrorResponse, unknown, ListOccurrencesQuery>, res: Response<ListOccurrencesResponse | ClassValidationErrorResponse>): Promise<void> {
		try {
			const result = await this.classOccurrencesServer.listFuture(Number(req.params.id), req.query.from, req.query.to);
			if (!result) {
				res.status(404).end();
				return;
			}
			res.json({ occurrences: result.occurrences.map(toOccurrenceResponseItem), classMemberStudentIds: result.classMemberStudentIds });
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async listPast(req: Request<{ id: string }, ListOccurrencesResponse | ClassValidationErrorResponse, unknown, ListOccurrencesQuery>, res: Response<ListOccurrencesResponse | ClassValidationErrorResponse>): Promise<void> {
		try {
			const result = await this.classOccurrencesServer.listPast(Number(req.params.id), req.query.from, req.query.to);
			if (!result) {
				res.status(404).end();
				return;
			}
			res.json({ occurrences: result.occurrences.map(toOccurrenceResponseItem), classMemberStudentIds: result.classMemberStudentIds });
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async rescheduleOccurrence(
		req: Request<{ id: string; date: string }, GetSessionResponse | ClassValidationErrorResponse, RescheduleOccurrenceBody>,
		res: Response<GetSessionResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const rescheduled = await this.classOccurrencesServer.rescheduleOccurrence(Number(req.params.id), req.params.date, req.body?.startTime);
			if (!rescheduled) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(rescheduled));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async cancelOccurrence(req: Request<{ id: string; date: string }>, res: Response): Promise<void> {
		try {
			const cancelled = await this.classOccurrencesServer.cancelOccurrence(Number(req.params.id), req.params.date);
			if (!cancelled) {
				res.status(404).end();
				return;
			}
			res.status(204).end();
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async recordOccurrenceAttendance(
		req: Request<{ id: string; date: string }, SessionAttendanceResponse | ClassValidationErrorResponse, SessionAttendanceBody>,
		res: Response<SessionAttendanceResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const classId = Number(req.params.id);
			const session = await this.classOccurrencesServer.materializeOccurrence(classId, new Date(`${req.params.date}T00:00:00.000Z`));
			const result = await this.sessionAttendanceServer.recordForSessionId(session.id, classId, req.body?.attendance);
			if (!result) {
				res.status(404).end();
				return;
			}
			res.json(result.map((row) => ({ studentId: row.studentId, status: row.status })));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async createMakeupSession(
		req: Request<{ id: string }, GetSessionResponse | ClassValidationErrorResponse, MakeupSessionBody>,
		res: Response<GetSessionResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const session = await this.classOccurrencesServer.createMakeupSession(Number(req.params.id), req.body?.startTime);
			res.status(201).json(toPublic(session));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					res.status(404).end();
					return;
				}
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}
}
```

- [ ] **Step 8: Register `ClassOccurrencesController` in DI and mount it**

Edit `src/container/types.ts` — add `ClassOccurrencesController: Symbol.for('ClassOccurrencesController'),` after `ClassesController`.

Edit `src/container/inversify.config.ts` — add the import after `ClassesController`'s import: `import { ClassOccurrencesController } from '../controllers/operator/classes/class-occurrences.controller';`, and the binding after `ClassesController`'s binding: `container.bind<ClassOccurrencesController>(TYPES.ClassOccurrencesController).to(ClassOccurrencesController).inSingletonScope();`

Read `src/controllers/operator/operator.controller.ts` to see how `ClassesController` is currently mounted (at `/classes`). Add `ClassOccurrencesController` mounted at the **same path** `/classes` (Express allows multiple routers mounted at the same prefix — both will be tried in registration order; since their route patterns don't overlap — `ClassesController` has `/`, `/:id`, `/:id/assign-students`, etc., while `ClassOccurrencesController` only has `/:id/occurrences/...` and `/:id/makeup-session` — there's no ambiguity as long as `/:id/occurrences/future` isn't shadowed by a broader `/:id` route registered first; check `ClassesController`'s route registration order and confirm its `/:id` GET handler is registered before `/:id/occurrences/future` would be checked — Express matches routes in registration order across ALL routers mounted at the same prefix, so mount `ClassOccurrencesController` and confirm via the smoke test in Step 11 that `/:id/occurrences/future` doesn't get incorrectly swallowed by `ClassesController`'s `GET /:id`). Add:

```typescript
this.internalRouter.use('/classes', classOccurrencesController.router);
```

directly after the existing `this.internalRouter.use('/classes', classesController.router);` line, with the corresponding constructor parameter and import added the same way as every other controller in this file.

- [ ] **Step 9: Update the `Class`/`Session` swagger schemas for the new fields**

Edit `src/docs/swagger-spec.ts`:
1. Add a new `Occurrence` schema and `SessionAttendanceEntry` schema (referenced by the new endpoints' response docs above, which currently use inline `description: OK` placeholders rather than full schemas — this is acceptable per this codebase's existing convention of some endpoints having lighter response docs than others, e.g. check `GET /api/operator/sessions/{id}/roster`'s existing inline-object response schema for the precedent; do not block this task on writing a fully-typed schema ref for every new endpoint if the existing codebase already has a mix of styles — confirm this by reading a few more `@openapi` blocks in this file first).
2. Confirm the `Session` schema's `classId`/`isMakeupSession` fields (added in the original 2026-09-12 plan) are still present and correct.

- [ ] **Step 10: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 11: Manual smoke test — the full derivation/materialization/attendance flow**

Start the local server. Using a `schedule`-type operator with a class (day-of-week set to a day within the next 2 weeks) with 2 assigned students:
- `GET /api/operator/classes/{id}/occurrences/future?from=<today>&to=<today+14d>` → confirm the response's `occurrences` array contains virtual entries (`isVirtual: true`, no `sessionId`) for each matching weekday in range, and `classMemberStudentIds` shows both assigned students.
- `PATCH /api/operator/classes/{id}/occurrences/<a virtual date>/reschedule` with `{"startTime": "<a new ISO datetime>"}` → 200; confirm via `GET .../occurrences/future` (same range) that this date now shows `isVirtual: false` with a real `sessionId`, and its `startTime` reflects the reschedule.
- `POST /api/operator/classes/{id}/occurrences/<a different virtual date>/cancel` → 204; confirm via a throwaway `pg` script that a `sessions` row now exists for that date and `is_deleted = true`.
- `PUT /api/operator/classes/{id}/occurrences/<a third virtual date>/attendance` with `{"attendance":[{"studentId": <id1>, "status":"present"},{"studentId": <id2>, "status":"absent"}]}` → 200 with both entries echoed back; confirm via `pg` script that a `sessions` row now exists for that date with `class_id` set and `title IS NULL`, and two `session_attendance` rows exist referencing it with the correct statuses.
- `POST /api/operator/classes/{id}/makeup-session` with `{"startTime": "<some future ISO datetime>"}` → 201; confirm the created session's roster (via a throwaway `pg` script against `enrollments_and_credits WHERE session_id = <id>`) includes both class members automatically, with no `studentIds` needed in the request.
- `GET /api/operator/classes/{id}/occurrences/future` (covering the makeup date) → confirm the makeup session appears merged into the list, `isMakeupSession: true`.
- `GET /api/operator/classes/{id}/occurrences/past?from=<30 days ago>&to=<today>` → confirm dates with no materialized session show as virtual entries too (past derivation working).
- Range validation: `GET .../occurrences/future?from=<today>&to=<today+100d>` → 400 (exceeds 90-day cap). `GET .../occurrences/future?from=<yesterday>&to=<today>` → 400 (`from` must be today or later).
- Stop/unstop interaction: `POST /api/operator/classes/{id}/stop`, then `GET .../occurrences/future?from=<today>&to=<today+14d>` → confirm no virtual dates appear on/after the stop date. `POST /api/operator/classes/{id}/unstop`, then re-check the same range → confirm virtual dates reappear.

- [ ] **Step 12: Commit**

```bash
git add src/servers/class-occurrences.server.ts src/controllers/operator/classes/class-occurrences.controller.ts src/controllers/operator/classes/types/occurrence.type.ts src/controllers/operator/classes/types/list-occurrences-query.type.ts src/controllers/operator/classes/types/reschedule-occurrence-body.type.ts src/controllers/operator/classes/types/makeup-session-body.type.ts src/repositories/session.repository.ts src/container/types.ts src/container/inversify.config.ts src/controllers/operator/operator.controller.ts src/docs/swagger-spec.ts
git commit -m "add class occurrence derivation/materialization, date-addressed reschedule/cancel/attendance, makeup sessions with auto-filled roster

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Nightly backfill job

**Files:**
- Create: `src/jobs/nightly-backfill.job.ts`
- Modify: `src/server.ts`
- Modify: `src/container/types.ts`
- Modify: `src/container/inversify.config.ts`

**Interfaces:**
- Consumes: `ClassOccurrencesServer.materializeOccurrence`, `ClassRepository.findByOperatorId`... actually needs a "find all non-stopped classes across all operators" query — check whether one exists; if not, add it in this task.
- Produces: `NightlyBackfillJob.run(): Promise<void>` (idempotent, safe to call multiple times or manually); scheduled via `node-cron` from `Server.start()`.

- [ ] **Step 1: Add a "find all active classes" repository method**

Edit `src/repositories/class.repository.ts` — add a method (after `findByOperatorId`):

```typescript
	// Every non-stopped class across all operators, regardless of operator.type (schedule or recurring
	// assigned) — used by the nightly backfill job, which applies uniformly per the spec (maxSize only affects
	// roster capacity, never derivation).
	public async findAllActive(): Promise<Class[]> {
		return this.db.queryActive(ClassEntity, "status = 'active'");
	}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 3: Write the nightly backfill job**

Create `src/jobs/nightly-backfill.job.ts`:

```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { SessionRepository } from '../repositories/session.repository';
import { ClassOccurrencesServer } from '../servers/class-occurrences.server';
import { Class } from '../entities/class.entity';
import { Logger } from '../logger/logger';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Backfills every non-stopped class's missing materialized sessions from the day after its latest materialized
// session through yesterday (inclusive) — self-healing if a run is missed (e.g. the process was down), since it
// always resumes from whatever the latest actually-materialized date is, not from a fixed "last night" cursor.
// Applies uniformly to schedule-type and recurring assigned-type classes alike (see
// docs/superpowers/specs/2026-09-13-derived-class-sessions-design.md); a true one-off session has no class to
// backfill and is untouched by this job entirely.
@injectable()
export class NightlyBackfillJob {
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.ClassOccurrencesServer) private readonly classOccurrences: ClassOccurrencesServer,
		@inject(TYPES.Logger) private readonly logger: Logger,
	) {}

	public async run(): Promise<void> {
		const activeClasses = await this.classes.findAllActive();
		this.logger.info('nightly backfill job started', { classCount: activeClasses.length });

		for (const foundClass of activeClasses) {
			// Sequential across classes — this job runs once nightly on a schedule, not on a request path, so
			// throughput isn't a concern; sequential keeps per-class failures isolated and easy to log.
			await this.backfillClass(foundClass);
		}

		this.logger.info('nightly backfill job finished');
	}

	private async backfillClass(foundClass: Class): Promise<void> {
		const latest = await this.sessions.findLatestByClassId(foundClass.id);
		const startFrom = latest ? new Date(latest.startTime.getTime() + MS_PER_DAY) : foundClass.createdAt;

		const yesterday = new Date();
		yesterday.setUTCHours(0, 0, 0, 0);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);

		if (startFrom.getTime() > yesterday.getTime()) {
			return;
		}

		const [hours, minutes, seconds]: number[] = foundClass.startTime.split(':').map(Number);
		const cursor = new Date(startFrom);
		cursor.setUTCHours(hours, minutes, seconds ?? 0, 0);
		while (cursor.getUTCDay() !== foundClass.dayOfWeek) {
			cursor.setUTCDate(cursor.getUTCDate() + 1);
		}

		while (cursor.getTime() <= yesterday.getTime()) {
			try {
				// eslint-disable-next-line no-await-in-loop -- backfilling one class's date range sequentially; this is a nightly job, not a request path
				await this.classOccurrences.materializeOccurrence(foundClass.id, new Date(cursor));
			} catch (error) {
				this.logger.error('nightly backfill: failed to materialize occurrence', { classId: foundClass.id, date: cursor.toISOString(), error: error instanceof Error ? error.message : error });
			}
			cursor.setUTCDate(cursor.getUTCDate() + 7);
		}
	}
}
```

- [ ] **Step 4: Register `NightlyBackfillJob` in DI**

Edit `src/container/types.ts` — add `NightlyBackfillJob: Symbol.for('NightlyBackfillJob'),` after `ClassOccurrencesServer`.

Edit `src/container/inversify.config.ts` — add the import: `import { NightlyBackfillJob } from '../jobs/nightly-backfill.job';`, and the binding after `ClassOccurrencesServer`'s binding: `container.bind<NightlyBackfillJob>(TYPES.NightlyBackfillJob).to(NightlyBackfillJob).inSingletonScope();`

- [ ] **Step 5: Schedule the job from `Server.start()`**

Edit `src/server.ts`:

```typescript
import { inject, injectable } from 'inversify';
import cron from 'node-cron';
import { TYPES } from './container/types';
import { App } from './app';
import { Logger } from './logger/logger';
import { Config } from './config/env';
import { PostgresHandler } from './handlers/postgres-handler';
import { NightlyBackfillJob } from './jobs/nightly-backfill.job';

@injectable()
export class Server {
	public constructor(
		@inject(TYPES.App) private readonly app: App,
		@inject(TYPES.Logger) private readonly logger: Logger,
		@inject(TYPES.Config) private readonly config: Config,
		@inject(TYPES.PostgresHandler) private readonly postgresHandler: PostgresHandler,
		@inject(TYPES.NightlyBackfillJob) private readonly nightlyBackfillJob: NightlyBackfillJob,
	) {}

	public async start(): Promise<void> {
		await this.postgresHandler.connect();

		this.app.express.listen(this.config.port, () => {
			this.logger.info('server listening', { nodeEnv: this.config.nodeEnv, port: this.config.port, processId: process.pid });
		});

		// Runs once daily at 02:00 server time. node-cron's schedule callback isn't awaited by the library itself,
		// so a slow run doesn't block anything else — errors inside the job are caught and logged by the job
		// itself (see NightlyBackfillJob.backfillClass), never crashing the process.
		cron.schedule('0 2 * * *', () => {
			this.nightlyBackfillJob.run().catch((error: unknown) => {
				this.logger.error('nightly backfill job crashed', { error: error instanceof Error ? error.message : error });
			});
		});
	}
}
```

- [ ] **Step 6: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 7: Manual smoke test — invoke the job directly (not waiting for 2am)**

Write a throwaway script that imports and constructs `NightlyBackfillJob` the same way the DI container would (or, simpler: add a temporary debug route, run the smoke test, then remove it before committing — do NOT leave a manual-trigger HTTP endpoint in the codebase, since the spec explicitly scopes this to an in-process scheduled job only). The simplest approach: temporarily change the cron schedule string to `* * * * *` (every minute) in `server.ts`, start the server, wait for one run, observe the log lines (`nightly backfill job started` / `finished`), confirm via a throwaway `pg` script that a class with a gap (e.g. one with no materialized sessions at all yet, or one whose latest session is >7 days old) now has materialized sessions up through yesterday. Revert the cron schedule string back to `'0 2 * * *'` before committing.

- [ ] **Step 8: Commit**

```bash
git add src/jobs/nightly-backfill.job.ts src/server.ts src/repositories/class.repository.ts src/container/types.ts src/container/inversify.config.ts
git commit -m "add nightly node-cron job to backfill missing materialized sessions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Deferred / explicitly out of scope (per spec)

- Per-session custom titles for class-linked sessions — display is always the class's current title, live.
- Sticky/standing trial-student concept — trial attendance is per-session only.
- External scheduler/ops dependency for the nightly job or archival — both are either in-process (`node-cron`) or manually/admin-triggered.
