import { fromZonedTime, toZonedTime } from 'date-fns-tz';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function pad(value: number): string {
	return value.toString().padStart(2, '0');
}

// Formats a toZonedTime()-produced Date's own LOCAL (system-timezone) getters as a calendar-day string
// ('YYYY-MM-DD'). date-fns-tz's toZonedTime writes its result via setFullYear/setHours (see its own source), which
// are local-timezone setters - the resulting Date is only correctly read back via getFullYear/getMonth/getDate
// (and getDay), NOT getUTCFullYear/getUTCMonth/getUTCDate/getUTCDay. Reading it via UTC getters only happens to
// produce the right answer when the running process's own system timezone is UTC (offset 0); on a machine/container
// whose system timezone is anything else, UTC getters silently disagree with the intended local date. Verified
// empirically across systemTZ=UTC/America/New_York/Europe/Madrid/Pacific/Kiritimati (see task-1-report.md).
// Never call this (or any local getter) on a Date that wasn't itself produced by toZonedTime.
function formatZonedDateOnly(zonedDate: Date): string {
	return `${zonedDate.getFullYear()}-${pad(zonedDate.getMonth() + 1)}-${pad(zonedDate.getDate())}`;
}

// Every UTC instant representing LOCAL MIDNIGHT of a calendar day in [from, to] (inclusive) whose LOCAL day-of-week
// (0=Sunday..6=Saturday) matches `dayOfWeek` - walked in the operator's own local calendar, not UTC. A UTC-anchored
// instant near a local midnight can read as a different weekday locally than it does in UTC, so day-of-week
// matching must happen against the zoned (local) view of the cursor, not the cursor's own raw UTC getters.
//
// The caller is responsible for composing the actual local time-of-day on top of each returned local-midnight
// instant (see localWallClockToUtc) - this function only walks calendar days.
export function walkLocalWeekday(from: Date, to: Date, timezone: string, dayOfWeek: number): Date[] {
	const results: Date[] = [];
	let cursorZoned = toZonedTime(from, timezone);
	// Bound the loop by a UTC-domain comparison against `to` plus one full day of slack, since the last matching
	// local day's actual occurrence instant (once time-of-day is composed on top) could still fall at or before
	// `to` even if this loop's own local-midnight cursor has technically stepped past `to` in raw terms.
	while (fromZonedTime(`${formatZonedDateOnly(cursorZoned)} 00:00:00`, timezone).getTime() <= to.getTime() + MS_PER_DAY) {
		// getDay(), not getUTCDay() - see formatZonedDateOnly's comment: cursorZoned was produced by toZonedTime and
		// must be read via local (system-timezone) getters, not UTC getters.
		if (cursorZoned.getDay() === dayOfWeek) {
			results.push(fromZonedTime(`${formatZonedDateOnly(cursorZoned)} 00:00:00`, timezone));
		}
		cursorZoned = new Date(cursorZoned.getTime() + MS_PER_DAY);
	}
	return results;
}

// Given a UTC instant representing local midnight of some calendar day (as produced by walkLocalWeekday, or any
// other local-midnight-in-`timezone` instant), and a class's stored "HH:MM:SS" local time-of-day, returns the true
// UTC instant for that local wall-clock moment on that day - DST-aware (the offset applied depends on which side
// of a DST transition the specific date falls on, not a fixed offset).
export function localWallClockToUtc(localMidnightUtc: Date, timeOfDay: string, timezone: string): Date {
	const zonedMidnight = toZonedTime(localMidnightUtc, timezone);
	const dateOnly = formatZonedDateOnly(zonedMidnight);
	return fromZonedTime(`${dateOnly} ${timeOfDay}`, timezone);
}

// The start of the LOCAL calendar day (00:00:00 in `timezone`) that the given UTC instant falls on - used for
// stop-clipping, which must clip to the operator's local day, not the UTC day, so a stop registered near a
// local-midnight/UTC-midnight mismatch clips the correct week.
export function startOfLocalDay(instant: Date, timezone: string): Date {
	const zoned = toZonedTime(instant, timezone);
	return fromZonedTime(`${formatZonedDateOnly(zoned)} 00:00:00`, timezone);
}

// Converts a local-midnight-in-`timezone` UTC instant (as produced by walkLocalWeekday) into UTC midnight of that
// SAME calendar day - the canonical date identity ClassOccurrencesServer's parseDateOnly already uses for the
// request path (a 'YYYY-MM-DD' string parsed as UTC midnight). materializeOccurrence's `date` parameter is used
// both as the originalDate identity (a DATE column, always read back via `date.toISOString().slice(0, 10)`) and
// as the anchor for composing the class's startTime - every caller must pass the SAME canonical form for the same
// calendar day, or two different UTC instants that both "mean" the same local date will silently produce two
// different originalDate values, breaking the row-dedup/reschedule/cancel identity this feature depends on. Only
// the nightly job needs this conversion - the request path's parseDateOnly is already in this canonical form by
// construction.
export function toCanonicalOriginalDate(localMidnightUtc: Date, timezone: string): Date {
	const zoned = toZonedTime(localMidnightUtc, timezone);
	const dateOnly = formatZonedDateOnly(zoned);
	return new Date(`${dateOnly}T00:00:00.000Z`);
}
