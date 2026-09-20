# Operator Timezone Applied to Class Occurrence Generation

## Context

`Operator.timezone` (IANA name, validated against `Intl.supportedValuesOf('timeZone')`) already exists and is settable/readable via the operator create/read/update endpoints. It is not yet consumed anywhere — occurrence generation, materialization, and the nightly backfill job all treat `Class.startTime`/`dayOfWeek` as UTC-verbatim, via `Date.prototype.setUTCHours`/`getUTCDay`. Verified: an operator set to `Europe/Madrid` (UTC+2 in July) with a class `startTime: "15:00:00"` produces an occurrence at `...T15:00:00.000Z` — the same digits, un-shifted, regardless of the operator's timezone.

A weekly-recurring local time (`dayOfWeek` + `startTime`, no calendar date of its own) has no single fixed UTC offset once the operator's timezone observes DST — resolving "Sunday 15:00 local" to a UTC instant requires knowing which actual calendar date is being resolved, so the DST period is unambiguous. This computation belongs entirely server-side: the server already has to do it once per occurrence, and duplicating it client-side risks the two sides disagreeing on edge cases (which date counts as "current" for a class with no date of its own, DST-transition-week handling, etc.).

## Goals

- Occurrence generation (`GET .../occurrences/future|past`, materialization, the nightly backfill job) interprets `Class.startTime`/`dayOfWeek` in the class's operator's `timezone`, converting to each occurrence's actual UTC instant using that occurrence's real calendar date and that date's correct DST-aware offset.
- `Class.startTime`/`dayOfWeek` are documented, on the wire, as the operator's local wall-clock values — they never change meaning and are never converted on read. Only the occurrence-generation/materialization code paths do timezone math.
- An operator's `timezone` becomes immutable once they have ever had any class (active, stopped, or soft-deleted) — changing it afterward is rejected, since prior occurrences/sessions were already computed under the original timezone and no reconciliation story exists (or is wanted) for a timezone change after the fact.
- Stop-clipping (a stopped class's last occurrence) clips to the start of the operator's *local* calendar day the stop was registered on, consistent with local-time semantics used everywhere else in this fix.

## Non-goals

- No change to `Class.startTime`/`dayOfWeek`'s stored representation, validation format, create/update semantics, or read-time value — they remain exactly what the operator typed, in whatever timezone the operator has set, for as long as that timezone is set (which per the immutability rule above, is forever once any class exists).
- No change to `Session.startTime`, `Occurrence.startTime`, or makeup-session `startTime` — these are already correctly generated as fully-tagged ISO UTC instants and don't change shape or meaning; only the *computation* that produces a materialized/virtual occurrence's UTC instant changes.
- No reconciliation/backfill of already-materialized sessions when nothing about the operator's timezone can change after the fact (the immutability rule makes this moot: a timezone is fixed for the operator's whole class-owning lifetime).
- No attempt to let an admin force-override the timezone-immutability rule via this feature; if a real-world correction is ever needed, that's explicitly manual/out-of-band ("admin will handle manually" per the request), not a new endpoint.

## Design

### New dependency: `date-fns-tz`

Chosen over Luxon (heavier API surface) and moment-timezone (maintenance mode). Verified directly: `fromZonedTime('2026-07-15 15:00:00', 'Europe/Madrid')` → `2026-07-15T13:00:00.000Z` (UTC+2, DST); `fromZonedTime('2026-01-15 15:00:00', 'Europe/Madrid')` → `2026-01-15T14:00:00.000Z` (UTC+1, standard) — a correct 1-hour DST-driven difference for the same local wall-clock time, confirming the library resolves DST transitions correctly rather than needing hand-rolled offset math.

Two functions used throughout:
- `fromZonedTime(localDateTimeString, timezone): Date` — local wall-clock (as a `'yyyy-MM-dd HH:mm:ss'` string) in the given IANA zone → the correct UTC `Date`.
- `toZonedTime(date, timezone): Date` — a UTC `Date` → a `Date` object whose UTC-getters read as if they were local-in-that-zone getters (used for the date-walking loop, so `getUTCDay()` on the zoned-view date reads the operator's local weekday, not the raw UTC weekday).

### Occurrence generation and materialization

Three call sites currently do UTC-verbatim date math against `Class.dayOfWeek`/`startTime`; all three get the same fix:

1. **`ClassOccurrencesServer.computeOccurrenceDates`** (virtual date generation for `GET .../occurrences/future|past`)
2. **`ClassOccurrencesServer.materializeOccurrence`** (the actual UTC `startTime` written to a newly materialized `sessions` row)
3. **`NightlyBackfillJob.backfillClass`** (duplicates the same date-walking logic independently)

Each needs the class's operator's `timezone` (fetched via `OperatorRepository.findById(foundClass.operatorId)` — none of these three currently inject `OperatorRepository`; all three need it added).

**Date-walking approach**: to find which UTC-anchored calendar dates match the class's `dayOfWeek` in the operator's *local* calendar (not UTC), walk the cursor using `toZonedTime`-based day-of-week checks instead of `getUTCDay()` directly on the raw UTC cursor — a UTC instant near a local midnight can read as a different weekday locally than it does in UTC, and the class's `dayOfWeek` is defined in local terms. Once a matching local calendar date is found, compose `${localDate} ${class.startTime}` as a local wall-clock string and convert to the occurrence's real UTC instant via `fromZonedTime(..., operator.timezone)`.

**Concretely** (`computeOccurrenceDates`, extended to accept the operator's timezone):

```typescript
private computeOccurrenceDates(foundClass: Class, timezone: string, from: Date, to: Date): Date[] {
	let effectiveTo = to;
	if (foundClass.status === 'stopped' && foundClass.stoppedAt) {
		// Clip to the start of the OPERATOR'S LOCAL day the class was stopped on (not the exact stop instant, and
		// not the UTC day) — a stop registered near midnight UTC could otherwise clip the wrong local day for the
		// operator. toZonedTime's getters read as local-in-timezone even though the Date object's own timestamp is
		// still a real UTC instant internally.
		const stoppedLocal = toZonedTime(foundClass.stoppedAt, timezone);
		const stoppedLocalDateStr = `${stoppedLocal.getUTCFullYear()}-${pad(stoppedLocal.getUTCMonth() + 1)}-${pad(stoppedLocal.getUTCDate())}`;
		const stoppedDayStartUtc = fromZonedTime(`${stoppedLocalDateStr} 00:00:00`, timezone);
		const dayBeforeStop = new Date(stoppedDayStartUtc.getTime() - MS_PER_DAY);
		if (dayBeforeStop.getTime() < effectiveTo.getTime()) {
			effectiveTo = dayBeforeStop;
		}
	}

	const dates: Date[] = [];
	// Walk in whole local calendar days, checking each date's LOCAL day-of-week against the class's dayOfWeek (which
	// is defined in the operator's local terms) — not the UTC day-of-week of an arbitrary UTC-anchored cursor.
	let cursorLocalDate = toZonedTime(from, timezone);
	while (true) {
		const localDateStr = `${cursorLocalDate.getUTCFullYear()}-${pad(cursorLocalDate.getUTCMonth() + 1)}-${pad(cursorLocalDate.getUTCDate())}`;
		if (cursorLocalDate.getUTCDay() === foundClass.dayOfWeek) {
			const occurrenceUtc = fromZonedTime(`${localDateStr} ${foundClass.startTime}`, timezone);
			if (occurrenceUtc.getTime() > effectiveTo.getTime()) {
				break;
			}
			if (occurrenceUtc.getTime() >= from.getTime()) {
				dates.push(occurrenceUtc);
			}
		}
		cursorLocalDate = new Date(cursorLocalDate.getTime() + MS_PER_DAY);
	}
	return dates;
}
```

(Illustrative — exact loop bounds/off-by-one handling to be nailed down with real tests during implementation, especially around `from`'s own day potentially already being past the class's `startTime` for that day.)

**`materializeOccurrence`**: the `date` parameter (a calendar date, already timezone-agnostic — YYYY-MM-DD) composes with `foundClass.startTime` and the operator's `timezone` via `fromZonedTime` instead of `setUTCHours`.

**`NightlyBackfillJob.backfillClass`**: same fix — fetch the class's operator's timezone, walk local calendar days via `toZonedTime`, convert each match via `fromZonedTime`.

### `dayOfWeek` interpretation

`Class.dayOfWeek` (0=Sunday..6=Saturday) is defined in the operator's local calendar. A UTC-anchored instant that's late-night in UTC could be a different local calendar day (and thus a different `dayOfWeek`) — the date-walking logic above handles this by checking day-of-week against the `toZonedTime`-shifted view, not the raw UTC cursor.

### Timezone immutability once classes exist

`OperatorsServer.update`, when `data.timezone` is present and differs from `existing.timezone`, must reject the change if the operator has *ever* had any class — active, stopped, or soft-deleted (any row at all, per the explicit decision that even a since-deleted class's historical sessions were computed under the original timezone).

New `ClassRepository.existsAnyForOperator(operatorId): Promise<boolean>` — a raw query ignoring `is_deleted` (existing `queryActive`-based methods all exclude soft-deleted rows; this one deliberately doesn't).

Wired via the same callback-injection pattern `OperatorsServer.changeType` already uses to avoid a circular `OperatorsServer ↔ ClassesServer/ClassRepository` dependency: `AdminOperatorsController`/`OperatorSettingsController` already have (or gain) a `ClassRepository` injection and pass a `(operatorId) => Promise<boolean>` callback into `OperatorsServer.update`.

New error type `OperatorTimezoneLockedError`, surfaced as 409 (matching `OperatorHasActiveClassesError`'s existing 409 precedent for a similar "can't change this now" guard), with a message pointing at manual/admin-side handling for any real-world correction need.

### API documentation

Add explicit `description` text to:
- `Class.startTime` / `Class.dayOfWeek` in the `Class`/`OperatorDetails`-adjacent swagger schema: "Interpreted in the operator's `timezone` (see `Operator.timezone`) — never UTC, never converted on read."
- The corresponding `POST /classes` / `PUT /classes/{id}` request-body field docs, same language.
- `Operator.timezone`'s existing description, extended to note it becomes immutable once the operator has any class.

## Testing

Per this repo's established convention (no test framework; `npx tsc --noEmit` + `npx eslint .` + manual DB-backed smoke tests):
- Set an operator's timezone to a DST-observing zone (`Europe/Madrid`). Create a class at a known local wall-clock `startTime`. Generate occurrences for a July date (DST) and a January date (standard) for the same class; confirm the two occurrences' UTC `startTime`s, converted back to `Europe/Madrid` for display, both equal the class's intended local time, and confirm the raw UTC values differ by exactly the DST shift (1 hour for Madrid) between the two dates — not a fixed offset in both cases.
- Confirm `materializeOccurrence` (via reschedule/cancel/attendance triggering it) produces the same DST-correct UTC instant as `computeOccurrenceDates`'s virtual-date preview for the same calendar date.
- Confirm the nightly backfill job produces the same DST-correct UTC instant for a backfilled date as the two paths above.
- Confirm a `dayOfWeek` edge case: a class scheduled near local midnight in a timezone behind UTC, verifying the generated occurrence lands on the correct local calendar day even though the raw UTC instant falls on the adjacent UTC day.
- Confirm stop-clipping now clips to the operator's local day, not the UTC day, for a stop registered near a local-midnight/UTC-midnight mismatch.
- Confirm `PUT /operator/settings/{id}` (and the admin equivalent) rejects a `timezone` change with 409 once the operator has any class (active, stopped, or soft-deleted), and that changing the timezone still works freely for an operator with zero classes ever created.
- Confirm `Class.startTime`/`dayOfWeek` are returned unchanged (still the operator's original local values) on every read, regardless of how many occurrences have been generated/materialized since.

## Migration note

As with every prior schema/behavior change in this repo: no migration tooling exists. This change has no new schema (no DDL) — it only changes computation logic and adds a library dependency (`date-fns-tz` to `package.json`). Existing materialized `sessions` rows are untouched; only newly-generated virtual dates and newly-materialized rows (from this point forward) use the corrected DST-aware computation. Any already-materialized session computed under the old (UTC-verbatim) logic keeps its existing `startTime` — this is consistent with the rest of this feature's principle that materialization is a one-time event never silently rewritten later.
