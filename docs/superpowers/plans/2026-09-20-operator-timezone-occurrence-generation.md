# Operator Timezone Applied to Class Occurrence Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make class occurrence generation (virtual date listing, materialization, and the nightly backfill job) interpret `Class.dayOfWeek`/`startTime` in the class's operator's `timezone` using real DST-aware conversion, while `Class.dayOfWeek`/`startTime` themselves remain the operator's local wall-clock values forever — never converted on read, never reinterpreted after the fact. An operator's `timezone` becomes locked once they have ever had any class.

**Architecture:** New `date-fns-tz` dependency (`fromZonedTime`: local wall-clock string + IANA zone → UTC `Date`; `toZonedTime`: UTC `Date` → a `Date` whose UTC-getters read as local-in-that-zone, verified against a real day-crossing case). Three call sites that currently do UTC-verbatim date math against `Class.dayOfWeek`/`startTime` — `ClassOccurrencesServer.computeOccurrenceDates`, `ClassOccurrencesServer.materializeOccurrence`, `NightlyBackfillJob.backfillClass` — are rewritten to walk calendar dates in the operator's local calendar (via `toZonedTime`-shifted day-of-week checks) and convert each match to its true UTC instant (via `fromZonedTime`). `OperatorsServer.update` gains a timezone-change guard (mirroring the existing `changeType`/`OperatorHasActiveClassesError` circular-dependency-avoiding callback pattern) that rejects a `timezone` change once the operator has ever had any class, active or not.

**Tech Stack:** TypeScript, Express, Inversify DI, raw `pg` (no ORM), `date-fns-tz` (new dependency). No test framework — verification is `npx tsc --noEmit -p .` + `npx eslint .` + manual DB-backed smoke tests via curl/throwaway `pg` scripts.

**Spec:** `docs/superpowers/specs/2026-09-20-operator-timezone-occurrence-generation-design.md`

## Global Constraints

- `Class.dayOfWeek`/`startTime` are the operator's local wall-clock values, always — never converted on read, never re-derived after the fact. Only occurrence-generation/materialization code paths perform timezone math.
- `Session.startTime`, `Occurrence.startTime`, and makeup-session `startTime` are already correct, fully-tagged UTC instants — their shape/meaning does not change; only the *computation* that produces a materialized/virtual occurrence's UTC instant changes.
- An operator's `timezone` cannot be changed once that operator has ever had any class — active, stopped, or soft-deleted (any row at all). This is enforced at the `OperatorsServer.update` layer via a callback, following the exact pattern `changeType`/`OperatorHasActiveClassesError` already uses to avoid a circular `OperatorsServer ↔ ClassesServer` dependency.
- Stop-clipping (a stopped class's last derivable occurrence) clips to the start of the operator's **local** calendar day the stop was registered on, not the UTC day.
- No change to already-materialized `sessions` rows — only newly-generated virtual dates and newly-materialized rows (from implementation forward) use the corrected DST-aware computation.
- No migration tooling exists in this repo — this task introduces no schema/DDL change, only a new `package.json` dependency and computation-logic changes.
- Follow existing conventions exactly: tabs, `@injectable()` + constructor `@inject(TYPES.X)` DI, `ValidationError`/`ValidationErrorDetail` for clean 400s, `RouteHandlers.wrap(...)` for handlers, `@openapi` JSDoc blocks matching existing controllers' style.
- `git commit` messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: Add `date-fns-tz`, build the timezone-aware date-walking helper, fix `computeOccurrenceDates` and `materializeOccurrence`

**Files:**
- Modify: `package.json`, `package-lock.json` (add `date-fns-tz`)
- Create: `src/utils/timezone.util.ts` (shared local-calendar-day-walking + conversion helpers)
- Modify: `src/servers/class-occurrences.server.ts`

**Interfaces:**
- Consumes: `Operator.timezone` (existing field), `date-fns-tz`'s `fromZonedTime`/`toZonedTime`.
- Produces: `src/utils/timezone.util.ts` exports `walkLocalWeekday(from: Date, to: Date, timezone: string, dayOfWeek: number): Date[]` (every UTC instant at **local midnight** of a date in `[from, to]` matching `dayOfWeek` in `timezone` — the caller then composes the actual local time-of-day on top) and `localWallClockToUtc(localDate: Date, timeOfDay: string, timezone: string): Date` (given a UTC instant representing local midnight of some day, plus a class's `"HH:MM:SS"` string, plus the timezone, returns the true UTC instant for that local wall-clock moment). `ClassOccurrencesServer.computeOccurrenceDates`/`materializeOccurrence` are updated to fetch the class's operator and use these helpers instead of `setUTCHours`/`getUTCDay`.

- [ ] **Step 1: Add `date-fns-tz` as a real dependency**

Run: `npm install date-fns-tz`

Verify `package.json`'s `dependencies` now includes `"date-fns-tz"` (this will also pull in `date-fns` as a dependency if not already present — confirm both appear in `package-lock.json`).

- [ ] **Step 2: Verify the library's exact behavior against a real DST transition, before writing any application code**

Write a throwaway script (delete after running) that imports `fromZonedTime`/`toZonedTime` from `date-fns-tz` and confirms:
```typescript
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
console.log(fromZonedTime('2026-07-15 15:00:00', 'Europe/Madrid').toISOString()); // expect 2026-07-15T13:00:00.000Z (UTC+2, DST)
console.log(fromZonedTime('2026-01-15 15:00:00', 'Europe/Madrid').toISOString()); // expect 2026-01-15T14:00:00.000Z (UTC+1, standard)
```
Both must print the expected values (a 1-hour difference between the two, confirming DST is applied correctly) before proceeding — this has already been manually verified during design, but re-confirm it in your own environment since a version mismatch between `date-fns-tz` and `date-fns` could silently produce wrong results.

- [ ] **Step 3: Create the shared timezone-walking utility**

Create `src/utils/timezone.util.ts`:

```typescript
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(value: number): string {
	return value.toString().padStart(2, '0');
}

// Formats a UTC Date's own getUTC* components as a local calendar-day string ('YYYY-MM-DD') — used together with
// toZonedTime, whose whole purpose is to produce a Date object whose getUTC* components read as if they were
// local-in-some-timezone components. Never call this on a Date that wasn't itself produced by toZonedTime.
function formatZonedDateOnly(zonedDate: Date): string {
	return `${zonedDate.getUTCFullYear()}-${pad(zonedDate.getUTCMonth() + 1)}-${pad(zonedDate.getUTCDate())}`;
}

// Every UTC instant representing LOCAL MIDNIGHT of a calendar day in [from, to] (inclusive) whose LOCAL day-of-week
// (0=Sunday..6=Saturday) matches `dayOfWeek` — walked in the operator's own local calendar, not UTC. A UTC-anchored
// instant near a local midnight can read as a different weekday locally than it does in UTC, so day-of-week
// matching must happen against the zoned (local) view of the cursor, not the cursor's own raw UTC getters.
//
// The caller is responsible for composing the actual local time-of-day on top of each returned local-midnight
// instant (see localWallClockToUtc) — this function only walks calendar days.
export function walkLocalWeekday(from: Date, to: Date, timezone: string, dayOfWeek: number): Date[] {
	const results: Date[] = [];
	let cursorZoned = toZonedTime(from, timezone);
	// Bound the loop by a UTC-domain comparison against `to` plus one full day of slack, since the last matching
	// local day's actual occurrence instant (once time-of-day is composed on top) could still fall at or before
	// `to` even if this loop's own local-midnight cursor has technically stepped past `to` in raw terms.
	while (fromZonedTime(`${formatZonedDateOnly(cursorZoned)} 00:00:00`, timezone).getTime() <= to.getTime() + MS_PER_DAY) {
		if (cursorZoned.getUTCDay() === dayOfWeek) {
			results.push(fromZonedTime(`${formatZonedDateOnly(cursorZoned)} 00:00:00`, timezone));
		}
		cursorZoned = new Date(cursorZoned.getTime() + MS_PER_DAY);
	}
	return results;
}

// Given a UTC instant representing local midnight of some calendar day (as produced by walkLocalWeekday, or any
// other local-midnight-in-`timezone` instant), and a class's stored "HH:MM:SS" local time-of-day, returns the true
// UTC instant for that local wall-clock moment on that day — DST-aware (the offset applied depends on which side
// of a DST transition the specific date falls on, not a fixed offset).
export function localWallClockToUtc(localMidnightUtc: Date, timeOfDay: string, timezone: string): Date {
	const zonedMidnight = toZonedTime(localMidnightUtc, timezone);
	const dateOnly = formatZonedDateOnly(zonedMidnight);
	return fromZonedTime(`${dateOnly} ${timeOfDay}`, timezone);
}

// The start of the LOCAL calendar day (00:00:00 in `timezone`) that the given UTC instant falls on — used for
// stop-clipping, which must clip to the operator's local day, not the UTC day, so a stop registered near a
// local-midnight/UTC-midnight mismatch clips the correct week.
export function startOfLocalDay(instant: Date, timezone: string): Date {
	const zoned = toZonedTime(instant, timezone);
	return fromZonedTime(`${formatZonedDateOnly(zoned)} 00:00:00`, timezone);
}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS (this new file has no dependents yet).

- [ ] **Step 5: Write a throwaway smoke test for the utility functions before wiring them into `ClassOccurrencesServer`**

Write a throwaway script (delete after running) that imports `walkLocalWeekday`/`localWallClockToUtc`/`startOfLocalDay` and checks:
- `walkLocalWeekday(new Date('2026-07-01T00:00:00Z'), new Date('2026-07-31T00:00:00Z'), 'Europe/Madrid', 1)` (Mondays in July 2026, Madrid) returns exactly the UTC instants for local midnight of every Monday in that range — cross-check the dates against a calendar (Madrid Mondays in July 2026: 6, 13, 20, 27).
- `localWallClockToUtc(<one of those Monday-midnight instants>, '15:00:00', 'Europe/Madrid')` produces the correct DST-aware UTC instant (13:00 UTC in July, since Madrid is UTC+2 in July).
- Repeat for a January range/date and confirm the offset is UTC+1 instead (14:00 UTC for the same 15:00 local time).
- A day-crossing case: `walkLocalWeekday` with a timezone far ahead of UTC (e.g. `Pacific/Kiritimati`, UTC+14) across a range boundary, confirming the walk uses the LOCAL weekday, not the UTC weekday, for dates near the range edges.

All must produce correct, manually-verified results before proceeding to Step 6.

- [ ] **Step 6: Wire `Operator` fetching into `ClassOccurrencesServer`**

Edit `src/servers/class-occurrences.server.ts` — add the import and constructor dependency:

```typescript
import { OperatorRepository } from '../repositories/operator.repository';
```

```typescript
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
		@inject(TYPES.SessionAttendanceServer) private readonly sessionAttendance: SessionAttendanceServer,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
	) {}
```

- [ ] **Step 7: Rewrite `computeOccurrenceDates` to be timezone-aware**

Edit `src/servers/class-occurrences.server.ts` — replace the entire `computeOccurrenceDates` method and its call site in `buildOccurrenceList`:

```typescript
import { walkLocalWeekday, localWallClockToUtc, startOfLocalDay } from '../utils/timezone.util';
```

```typescript
	// Walks every date in [from, to] matching the class's dayOfWeek IN THE OPERATOR'S LOCAL TIMEZONE, clipped to
	// stoppedAt (in local-day terms) if the class is stopped. Pure computation — never reads or writes sessions.
	// Class.dayOfWeek/startTime are always the operator's local wall-clock values (see
	// docs/superpowers/specs/2026-09-20-operator-timezone-occurrence-generation-design.md) — this is the one place
	// (along with materializeOccurrence and NightlyBackfillJob.backfillClass) that converts them to real UTC
	// instants, using that specific occurrence date's correct DST-aware offset.
	private computeOccurrenceDates(foundClass: Class, timezone: string, from: Date, to: Date): Date[] {
		let effectiveTo = to;
		if (foundClass.status === 'stopped' && foundClass.stoppedAt) {
			// Clip to the start of the OPERATOR'S LOCAL day the class was stopped on — not the exact stop instant,
			// and not the UTC day. A stop registered near midnight UTC could otherwise clip the wrong local day.
			const stoppedDayStartLocal = startOfLocalDay(foundClass.stoppedAt, timezone);
			const dayBeforeStop = new Date(stoppedDayStartLocal.getTime() - MS_PER_DAY);
			if (dayBeforeStop.getTime() < effectiveTo.getTime()) {
				effectiveTo = dayBeforeStop;
			}
		}

		const localMidnights = walkLocalWeekday(from, effectiveTo, timezone, foundClass.dayOfWeek);
		const dates = localMidnights
			.map((localMidnight: Date): Date => localWallClockToUtc(localMidnight, foundClass.startTime, timezone))
			.filter((occurrenceUtc: Date): boolean => occurrenceUtc.getTime() >= from.getTime() && occurrenceUtc.getTime() <= effectiveTo.getTime());
		dates.sort((a: Date, b: Date): number => a.getTime() - b.getTime());
		return dates;
	}
```

- [ ] **Step 8: Update `buildOccurrenceList` to fetch the operator's timezone and pass it through**

Edit `src/servers/class-occurrences.server.ts` — in `buildOccurrenceList`, immediately after `foundClass` is loaded, fetch the operator and pass its timezone into `computeOccurrenceDates`:

```typescript
	private async buildOccurrenceList(classId: number, from: Date, to: Date): Promise<OccurrenceListResult | null> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			return null;
		}
		const operator = await this.operators.findById(foundClass.operatorId);
		if (!operator) {
			return null;
		}

		const virtualDates = this.computeOccurrenceDates(foundClass, operator.timezone, from, to);
		// ... rest of the method unchanged (materialized sessions, originalDateKeys, occurrences array construction) ...
```

(Only the `foundClass` load, the new operator fetch, and the `computeOccurrenceDates` call signature change — nothing else in this method's body changes.)

- [ ] **Step 9: Rewrite `materializeOccurrence` to be timezone-aware**

Edit `src/servers/class-occurrences.server.ts` — replace the body of `materializeOccurrence`:

```typescript
	public async materializeOccurrence(classId: number, date: Date): Promise<Session> {
		const existing = await this.sessions.findByClassIdAndOriginalDateIncludingDeleted(classId, date);
		if (existing) {
			return existing;
		}
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}
		const operator = await this.operators.findById(foundClass.operatorId);
		if (!operator) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}
		// `date` is a UTC instant representing the calendar day's identity (originalDate), not itself a real
		// wall-clock moment — localWallClockToUtc composes the class's local startTime on top of that day, in the
		// operator's timezone, producing the true DST-aware UTC instant for this specific occurrence.
		const startTime = localWallClockToUtc(date, foundClass.startTime, operator.timezone);
		return this.sessions.create({
			operatorId: foundClass.operatorId,
			title: null,
			startTime,
			capacityLimit: foundClass.maxSize,
			classId: foundClass.id,
			originalDate: date,
			isMakeupSession: false,
		});
	}
```

(The `ValidationError` message/field for a missing operator reuses `'classId'`/`'Class not found'` rather than inventing a new error shape — an operator's absence here would only happen if the class's `operatorId` pointed at a deleted/nonexistent operator, an inconsistent-data scenario callers already treat identically to "class not found" via `isClassIdError`.)

- [ ] **Step 10: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — `NightlyBackfillJob` (Task 2) still calls the old UTC-verbatim logic independently and is not yet updated; this is expected. Confirm the only errors, if any, are unrelated to this task's own files (`class-occurrences.server.ts`, `timezone.util.ts`) — if there's a compile error inside those two files, fix it now before proceeding.

- [ ] **Step 11: Manual smoke test — DST-correctness for both `computeOccurrenceDates` and `materializeOccurrence`**

Start the local server. Using an existing operator (or a fresh one created via the admin endpoint) with `timezone` set to `Europe/Madrid`, create a class with `dayOfWeek` set to a weekday and `startTime: "15:00:00"`.

1. `GET /classes/{id}/occurrences/future?from=<a July Monday-matching date>&to=<+7 days>` → confirm the virtual occurrence's `startTime` is `...T13:00:00.000Z` (UTC+2).
2. `GET /classes/{id}/occurrences/future?from=<a January Monday-matching date>&to=<+7 days>` → confirm the virtual occurrence's `startTime` is `...T14:00:00.000Z` (UTC+1) — a full 1-hour difference from the July case for the identical local `startTime`, confirming DST is applied per-date rather than a fixed offset.
3. `PATCH /classes/{id}/occurrences/{the July date}/reschedule` with a body that doesn't change the date (or `POST .../cancel` then inspect the created row, or trigger materialization via `PUT .../attendance`) → confirm the materialized `sessions` row's `start_time` (query the DB directly) matches the same `...T13:00:00.000Z` the virtual listing showed, confirming `materializeOccurrence` and `computeOccurrenceDates` agree.
4. Confirm `Class.startTime`/`dayOfWeek` themselves, read via `GET /classes/{id}`, are unchanged — still `"15:00:00"` and whatever `dayOfWeek` was set, never converted.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json src/utils/timezone.util.ts src/servers/class-occurrences.server.ts
git commit -m "occurrences: interpret Class.startTime/dayOfWeek in the operator's timezone

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Fix `NightlyBackfillJob` and stop-clipping consistency

**Files:**
- Modify: `src/jobs/nightly-backfill.job.ts`

**Interfaces:**
- Consumes: `walkLocalWeekday`, `localWallClockToUtc` from Task 1's `src/utils/timezone.util.ts`; `OperatorRepository` (new dependency for this file).
- Produces: `NightlyBackfillJob.backfillClass` now fetches the class's operator and walks/converts dates identically to `ClassOccurrencesServer.computeOccurrenceDates`/`materializeOccurrence`, so all three code paths agree on the same DST-aware UTC instant for a given class+date.

- [ ] **Step 1: Add `OperatorRepository` to `NightlyBackfillJob`'s constructor**

Edit `src/jobs/nightly-backfill.job.ts`:

```typescript
import { OperatorRepository } from '../repositories/operator.repository';
import { walkLocalWeekday, localWallClockToUtc } from '../utils/timezone.util';
```

```typescript
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.ClassOccurrencesServer) private readonly classOccurrences: ClassOccurrencesServer,
		@inject(TYPES.Logger) private readonly logger: Logger,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
	) {}
```

- [ ] **Step 2: Rewrite `backfillClass`'s date-walking to be timezone-aware**

Edit `src/jobs/nightly-backfill.job.ts` — replace the body of `backfillClass`:

```typescript
	private async backfillClass(foundClass: Class): Promise<void> {
		const yesterday = new Date();
		yesterday.setUTCHours(0, 0, 0, 0);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);

		// Excludes makeup sessions (ad hoc, can land far in the future) from the "latest materialized" lookup — a
		// future makeup session must never make this job think the class's regular pattern is already backfilled
		// past that point (see findLatestRegularByClassIdBefore).
		const latest = await this.sessions.findLatestRegularByClassIdBefore(foundClass.id, yesterday);
		const startFrom = latest ? new Date(latest.startTime.getTime() + MS_PER_DAY) : foundClass.createdAt;

		if (startFrom.getTime() > yesterday.getTime()) {
			return;
		}

		const operator = await this.operators.findById(foundClass.operatorId);
		if (!operator) {
			this.logger.error('nightly backfill: class references a nonexistent operator, skipping', { classId: foundClass.id, operatorId: foundClass.operatorId });
			return;
		}

		// Same local-calendar walk + DST-aware conversion as ClassOccurrencesServer.computeOccurrenceDates and
		// materializeOccurrence — all three code paths must agree on the same UTC instant for a given class+date.
		const localMidnights = walkLocalWeekday(startFrom, yesterday, operator.timezone, foundClass.dayOfWeek);
		for (const localMidnight of localMidnights) {
			try {
				// eslint-disable-next-line no-await-in-loop -- backfilling one class's date range sequentially; this is a nightly job, not a request path
				await this.classOccurrences.materializeOccurrence(foundClass.id, localMidnight);
			} catch (error) {
				this.logger.error('nightly backfill: failed to materialize occurrence', {
					classId: foundClass.id,
					date: localMidnight.toISOString(),
					error: error instanceof Error ? error.message : error,
				});
			}
		}
	}
```

Note: `walkLocalWeekday`'s returned instants are UTC instants representing **local midnight** (not the actual occurrence time) — this exactly matches what `materializeOccurrence` expects for its `date` parameter (an `originalDate` identity, not a real wall-clock moment), so no further conversion is needed here; `materializeOccurrence` itself calls `localWallClockToUtc` internally to produce the real `startTime`.

- [ ] **Step 3: Remove the now-unused inline UTC date-walking code and constant, if any remain**

Confirm the old `cursor.setUTCHours`/`getUTCDay`/`setUTCDate` lines and the local `[hours, minutes, seconds]` destructuring in the previous `backfillClass` body are fully removed (replaced by Step 2's version). Confirm `MS_PER_DAY` is still used elsewhere in the file (it is, in the `startFrom`/`yesterday` computation) — do not remove the constant itself.

- [ ] **Step 4: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS (zero output) — this should also resolve Task 1 Step 10's expected failure, since `NightlyBackfillJob` is now updated too.

Run: `npx eslint .`
Expected: PASS (zero output).

- [ ] **Step 5: Manual smoke test — nightly job produces DST-correct instants matching the other two code paths**

Using the same `Europe/Madrid` operator/class from Task 1's smoke test: create a fresh class with a backfill-able gap (push `created_at` back via a throwaway `pg` script, as in prior nightly-job smoke tests in this codebase's history), spanning both a July date and a January date. Temporarily change `server.ts`'s cron schedule to `* * * * *` (or invoke `NightlyBackfillJob.run()` directly via a throwaway in-process script, per this codebase's established preference for avoiding wall-clock-dependent verification) and confirm:
- The backfilled July-dated session's `start_time` is `...T13:00:00.000Z`.
- The backfilled January-dated session's `start_time` is `...T14:00:00.000Z`.
- Both match exactly what `GET .../occurrences/future|past` would have shown for those same dates (cross-check against Task 1's verified values).

Revert any temporary cron schedule change before committing, and delete all throwaway scripts.

- [ ] **Step 6: Commit**

```bash
git add src/jobs/nightly-backfill.job.ts
git commit -m "nightly backfill: use the same timezone-aware date-walking as occurrence generation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Lock `Operator.timezone` once the operator has any class

**Files:**
- Modify: `src/repositories/class.repository.ts`
- Modify: `src/servers/operators.server.ts`
- Modify: `src/controllers/admin/operators/operators.controller.ts`
- Modify: `src/controllers/operator/settings/settings.controller.ts`

**Interfaces:**
- Consumes: none new beyond existing repository/server patterns.
- Produces: `ClassRepository.existsAnyForOperator(operatorId: number): Promise<boolean>` (ignores `is_deleted`, unlike every other `ClassRepository` query); `OperatorTimezoneLockedError` (new, exported from `operators.server.ts`); `OperatorsServer.update`'s signature gains a required `hasAnyClass: (operatorId: number) => Promise<boolean>` callback parameter, mirroring `changeType`'s existing pattern.

- [ ] **Step 1: Add `ClassRepository.existsAnyForOperator`**

Edit `src/repositories/class.repository.ts` — add a new method (after `existsActiveForOperator`):

```typescript
	// Unlike every other query in this repository, deliberately ignores is_deleted — used only to decide whether an
	// operator's timezone may still be changed. Once any class has ever existed for this operator (even one since
	// soft-deleted), its historical sessions/occurrences were already computed under the operator's timezone at the
	// time, so the timezone must not change afterward (see OperatorsServer.update's timezone-lock guard).
	public async existsAnyForOperator(operatorId: number): Promise<boolean> {
		const rows = await this.db.query<{ count: string }>('SELECT COUNT(*) AS count FROM "classes" WHERE operator_id = $1', [operatorId]);
		return Number(rows[0]?.count ?? 0) > 0;
	}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 3: Add `OperatorTimezoneLockedError` and update `OperatorsServer.update`'s signature**

Edit `src/servers/operators.server.ts` — add the new error class near `OperatorHasActiveClassesError`:

```typescript
export class OperatorTimezoneLockedError extends Error {
	public constructor() {
		super('Cannot change timezone once the operator has any class — contact an admin for manual correction');
		this.name = 'OperatorTimezoneLockedError';
	}
}
```

Edit `update`'s signature and body:

```typescript
	// findById first — same reasoning as pause()/resume(): update() has no is_deleted guard, so without this check a
	// soft-deleted operator would still match and get silently updated instead of 404ing like every other endpoint.
	// hasAnyClass is injected as a callback (rather than this server depending on ClassRepository directly) to avoid
	// a circular dependency between operators.server.ts and classes.server.ts — same pattern as changeType's
	// hasActiveClasses callback.
	public async update(
		id: number,
		data: { name?: string; email?: string; phone?: string; countryCode?: string; timezone?: string },
		hasAnyClass: (operatorId: number) => Promise<boolean>,
	): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}

		if (data.timezone !== undefined && data.timezone !== operator.timezone && (await hasAnyClass(id))) {
			throw new OperatorTimezoneLockedError();
		}

		const details = await this.validateUpdate(id, data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		return this.operators.update(id, data);
	}
```

Note: the guard only fires when `data.timezone` is both present AND different from the operator's current value — an update that resends the same timezone (or omits it entirely) is never blocked, even for an operator with existing classes.

- [ ] **Step 4: Run typecheck to find both call sites**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — both `AdminOperatorsController.updateOperator` and `OperatorSettingsController.updateSettings` call `this.operatorsServer.update(id, data)` with only two arguments; both need the new third callback argument.

- [ ] **Step 5: Wire the callback into `AdminOperatorsController`**

Edit `src/controllers/admin/operators/operators.controller.ts` — this controller already injects `ClassRepository` (used by `changeOperatorType`). Update `updateOperator`:

```typescript
	private async updateOperator(
		req: Request<{ id: string }, GetOperatorResponse | CreateOperatorValidationErrorResponse, UpdateOperatorBody>,
		res: Response<GetOperatorResponse | CreateOperatorValidationErrorResponse>,
	): Promise<void> {
		const { name, email, phone, countryCode, timezone } = req.body;
		try {
			const operator = await this.operatorsServer.update(Number(req.params.id), { name, email, phone, countryCode, timezone }, (operatorId: number) =>
				this.classRepository.existsAnyForOperator(operatorId),
			);
			if (!operator) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(operator));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			if (error instanceof OperatorTimezoneLockedError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}
```

Add `OperatorTimezoneLockedError` to the existing import: `import { OperatorsServer, OperatorHasActiveClassesError, OperatorTimezoneLockedError } from '../../../servers/operators.server';`

- [ ] **Step 6: Wire the callback into `OperatorSettingsController` (needs a new `ClassRepository` injection)**

Edit `src/controllers/operator/settings/settings.controller.ts`:

1. Add imports: `import { ClassRepository } from '../../../repositories/class.repository';` and add `OperatorTimezoneLockedError` to the existing `operators.server` import: `import { OperatorsServer, OperatorTimezoneLockedError } from '../../../servers/operators.server';` (adjust the existing bare `import { OperatorsServer } from '../../../servers/operators.server';` line accordingly).
2. Add the constructor dependency:

```typescript
	public constructor(
		@inject(TYPES.OperatorsServer) private readonly operatorsServer: OperatorsServer,
		@inject(TYPES.AvatarsServer) private readonly avatarsServer: AvatarsServer,
		@inject(TYPES.ClassRepository) private readonly classRepository: ClassRepository,
	) {
```

3. Update `updateSettings`:

```typescript
	private async updateSettings(
		req: Request<{ id: string }, UpdateOperatorSettingsResponse | UpdateOperatorSettingsValidationErrorResponse, UpdateOperatorSettingsBody>,
		res: Response<UpdateOperatorSettingsResponse | UpdateOperatorSettingsValidationErrorResponse>,
	): Promise<void> {
		const { name, email, phone, countryCode, timezone } = req.body;
		try {
			const operator = await this.operatorsServer.update(Number(req.params.id), { name, email, phone, countryCode, timezone }, (operatorId: number) =>
				this.classRepository.existsAnyForOperator(operatorId),
			);
			if (!operator) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(operator));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			if (error instanceof OperatorTimezoneLockedError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}
```

No `container/types.ts`/`inversify.config.ts` changes are needed — `TYPES.ClassRepository` is already registered and bound as a singleton (confirmed: used identically by `AdminOperatorsController` already).

- [ ] **Step 7: Add the 409 response to both endpoints' swagger docs**

Edit `src/controllers/admin/operators/operators.controller.ts`'s `PUT /api/admin/operators/{id}` JSDoc block — add after the existing `401` line:

```
		 *       409: { description: 'timezone cannot be changed once the operator has any class' }
```

Edit `src/controllers/operator/settings/settings.controller.ts`'s `PUT /api/operator/settings/{id}` JSDoc block — same addition, after its existing `401` line.

- [ ] **Step 8: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS (zero output).

Run: `npx eslint .`
Expected: PASS (zero output).

- [ ] **Step 9: Manual smoke test — timezone lock**

Start the local server.
1. Create a fresh operator (via `POST /api/admin/operators`) with `timezone: "UTC"` and zero classes.
2. `PUT /api/operator/settings/{id}` with `{"timezone": "Europe/Madrid"}` → 200, confirm the timezone changed.
3. Create a class for this operator (`POST /api/operator/classes`).
4. `PUT /api/operator/settings/{id}` with `{"timezone": "America/New_York"}` → 409, confirm the operator's timezone is unchanged (`GET /api/operator/settings/{id}` still shows `Europe/Madrid`).
5. `PUT /api/operator/settings/{id}` with `{"timezone": "Europe/Madrid"}` (same value, no actual change) → 200 — confirm re-sending the unchanged value is never blocked.
6. `PUT /api/operator/settings/{id}` with `{"name": "New Name"}` (no `timezone` field at all) → 200 — confirm omitting timezone entirely is never blocked, even with an existing class.
7. Soft-delete the class (`DELETE /api/operator/classes/{id}`), then retry step 4's timezone change → still 409, confirming a soft-deleted class still locks the timezone (per "any class ever," not just active ones).
8. Repeat steps 2-4 against `PUT /api/admin/operators/{id}` (the admin-side update endpoint) to confirm the same guard applies there too.

- [ ] **Step 10: Commit**

```bash
git add src/repositories/class.repository.ts src/servers/operators.server.ts src/controllers/admin/operators/operators.controller.ts src/controllers/operator/settings/settings.controller.ts
git commit -m "operators: lock timezone once any class has ever existed for the operator

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: API documentation — declare the timezone semantics explicitly

**Files:**
- Modify: `src/docs/swagger-spec.ts`
- Modify: `src/controllers/operator/classes/classes.controller.ts`

**Interfaces:** none (documentation-only task).

- [ ] **Step 1: Update the `Class` schema in `swagger-spec.ts`**

Edit `src/docs/swagger-spec.ts` — update the `Class` schema's `dayOfWeek`/`startTime` fields:

```typescript
						dayOfWeek: {
							type: 'integer',
							description: "0 (Sunday) through 6 (Saturday), in the class's operator's timezone (Operator.timezone) — never UTC, never converted on read.",
						},
						startTime: {
							type: 'string',
							description:
								"24-hour local wall-clock time (HH:MM:SS), in the class's operator's timezone (Operator.timezone) — never UTC, never converted on read. Occurrence generation is the only place this value is converted to a UTC instant, using the specific occurrence date's correct DST-aware offset.",
						},
```

(These replace the existing bare `dayOfWeek: { type: 'integer' }` / `startTime: { type: 'string' }` lines in the `Class` schema block.)

- [ ] **Step 2: Update the `Operator`/`OperatorDetails` schemas' `timezone` description**

Edit `src/docs/swagger-spec.ts` — update both occurrences of the `timezone` field (in `Operator` and `OperatorDetails`):

```typescript
						timezone: {
							type: 'string',
							description:
								"IANA timezone name, e.g. America/New_York. Governs how this operator's classes' dayOfWeek/startTime are converted to real UTC occurrence instants. Immutable once this operator has ever had any class — see PUT /api/operator/settings/{id} and PUT /api/admin/operators/{id}.",
						},
```

- [ ] **Step 3: Update `classes.controller.ts`'s create/update request-body field docs**

Edit `src/controllers/operator/classes/classes.controller.ts` — in the `POST /api/operator/classes` JSDoc block, update:

```
		 *               dayOfWeek: { type: integer, minimum: 0, maximum: 6, description: "0 (Sunday) through 6 (Saturday), in the operator's timezone" }
		 *               startTime: { type: string, description: "HH:MM:SS, local wall-clock time in the operator's timezone (see Operator.timezone) — never UTC" }
```

Apply the identical change to the `PUT /api/operator/classes/{id}` JSDoc block's `dayOfWeek`/`startTime` lines.

- [ ] **Step 4: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 5: Manual verification — swagger spec renders without error**

Start the local server, navigate to `/api-docs` (or fetch the underlying `swaggerSpec` object via a throwaway script, per this codebase's established verification method for prior swagger changes) and confirm: the `Class` schema shows the new `dayOfWeek`/`startTime` descriptions, the `Operator`/`OperatorDetails` schemas show the updated `timezone` description, and the `POST`/`PUT /api/operator/classes` request bodies show the new field descriptions — no rendering errors, no broken YAML/JSDoc syntax.

- [ ] **Step 6: Commit**

```bash
git add src/docs/swagger-spec.ts src/controllers/operator/classes/classes.controller.ts
git commit -m "docs: document Class.dayOfWeek/startTime and Operator.timezone semantics

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-review notes (from plan authoring)

- **Spec coverage check**: every goal in the spec (occurrence generation uses operator timezone; `Class.startTime`/`dayOfWeek` never change meaning; timezone lock once any class exists; stop-clipping uses local day; API docs) maps to a task above (Tasks 1-2, 3, 3, 4 respectively).
- **Type consistency check**: `computeOccurrenceDates`'s new signature (`foundClass, timezone, from, to`) is used consistently in Task 1 Step 8's `buildOccurrenceList` update. `walkLocalWeekday`/`localWallClockToUtc`/`startOfLocalDay`'s names and signatures, once defined in Task 1 Step 3, are used identically in Task 1 Steps 7/9 and Task 2 Step 2 — no drift. `OperatorsServer.update`'s new third parameter (`hasAnyClass`) is threaded identically through both call sites in Task 3 Steps 5-6.
- **Placeholder scan**: no TBD/TODO markers; every step contains real, complete code, not descriptions of code to write.
- **Cross-task dependency note**: Task 2 depends on Task 1's `timezone.util.ts` existing; Task 3 is independent of Tasks 1-2 (touches operator update, not occurrence generation) and could be executed in parallel with them if using a worktree-per-task strategy, but is listed after Task 2 for narrative simplicity since it's the smaller, more isolated change. Task 4 (docs) has no code dependency on Tasks 1-3 but is listed last since its descriptions reference behavior established by them.
