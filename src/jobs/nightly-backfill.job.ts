import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { SessionRepository } from '../repositories/session.repository';
import { ClassOccurrencesServer } from '../servers/class-occurrences.server';
import { Class } from '../entities/class.entity';
import { Logger } from '../logger/logger';
import { OperatorRepository } from '../repositories/operator.repository';
import { localWallClockToUtc, toCanonicalOriginalDate, walkLocalWeekday } from '../utils/timezone.util';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Backfills every non-stopped class's missing materialized sessions from the day after its latest materialized
// session through yesterday (inclusive) - self-healing if a run is missed (e.g. the process was down), since it
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
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
	) {}

	public async run(): Promise<void> {
		const activeClasses = await this.classes.findAllActive();
		this.logger.info('nightly backfill job started', { classCount: activeClasses.length });

		for (const foundClass of activeClasses) {
			// Sequential across classes - this job runs once nightly on a schedule, not on a request path, so
			// throughput isn't a concern; sequential keeps per-class failures isolated and easy to log.
			await this.backfillClass(foundClass);
		}

		this.logger.info('nightly backfill job finished');
	}

	private async backfillClass(foundClass: Class): Promise<void> {
		const yesterday = new Date();
		yesterday.setUTCHours(0, 0, 0, 0);
		yesterday.setUTCDate(yesterday.getUTCDate() - 1);

		// Excludes makeup sessions (ad hoc, can land far in the future) from the "latest materialized" lookup - a
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
		// materializeOccurrence - all three code paths must agree on the same UTC instant for a given class+date.
		const localMidnights = walkLocalWeekday(startFrom, yesterday, operator.timezone, foundClass.dayOfWeek);
		for (const localMidnight of localMidnights) {
			// walkLocalWeekday's loop bound has deliberate slack past `yesterday` (see its own comment) - the request
			// path re-filters its composed occurrence times back down to [from, to] (computeOccurrenceDates) before
			// using them; this job must do the same against `yesterday`, or it can materialize an occurrence whose
			// real startTime lands past the job's own "through yesterday inclusive" contract. `localMidnight` (the
			// raw walkLocalWeekday output, local-midnight-shaped) is the correct input to localWallClockToUtc here -
			// NOT canonicalDate below, which is UTC-midnight-shaped and would compose the wrong wall-clock instant.
			const composedStartTime = localWallClockToUtc(localMidnight, foundClass.startTime, operator.timezone);
			if (composedStartTime.getTime() > yesterday.getTime()) {
				continue;
			}

			// Normalizes this local-midnight instant to the same canonical UTC-midnight-of-that-calendar-day form
			// ClassOccurrencesServer's parseDateOnly already produces for the request path - materializeOccurrence's
			// `date` is used as the originalDate identity (a DATE column), so every caller must agree on the same
			// canonical form for the same calendar day, or the request path and this job silently disagree on
			// originalDate for what's supposed to be the same occurrence, producing duplicate sessions rows (see
			// toCanonicalOriginalDate's own doc comment).
			const canonicalDate = toCanonicalOriginalDate(localMidnight, operator.timezone);
			try {
				// Sequential - backfilling one class's date range in order; this is a nightly job, not a request path.
				await this.classOccurrences.materializeOccurrence(foundClass.id, canonicalDate);
			} catch (error) {
				this.logger.error('nightly backfill: failed to materialize occurrence', {
					classId: foundClass.id,
					date: canonicalDate.toISOString(),
					error: error instanceof Error ? error.message : error,
				});
			}
		}
	}
}
