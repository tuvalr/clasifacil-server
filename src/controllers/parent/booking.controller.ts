import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { SessionRepository } from '../../repositories/session.repository';
import { EnrollmentAndCreditRepository } from '../../repositories/enrollment-and-credit.repository';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';

// UC2: Automated Session Booking & Capacity Hard Limits (parent side).
@injectable()
export class ParentBookingController extends BaseController {
	public constructor(
		@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,
		@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,
	) {
		super();
		this.internalRouter.get('/sessions', RouteHandlers.notImplemented); // TODO: browse-by-availability listing, not yet designed
		this.internalRouter.post('/sessions/:sessionId/book', RouteHandlers.wrap(this.book.bind(this)));
		this.internalRouter.get('/households/:householdId/enrollments', RouteHandlers.wrap(this.listEnrollments.bind(this)));
		// TODO: requires a real waitlist (PRD: "queue-based waitlist
		// ordered strictly by timestamp", automated promotion with a
		// time-sensitive claim window on cancellation) — status is a free
		// -text column with no queue-position or claim-deadline tracking.
		this.internalRouter.get('/sessions/:sessionId/waitlist', RouteHandlers.notImplemented);
		this.internalRouter.post('/waitlist/:enrollmentId/claim', RouteHandlers.notImplemented);
	}

	private async listEnrollments(req: Request, res: Response): Promise<void> {
		const enrollments = await this.enrollments.findByHouseholdId(Number(req.params.householdId));
		res.json(enrollments);
	}

	// PRD UC2: bookings must use row-level locking (SELECT ... FOR UPDATE)
	// to check current_roster_count against capacity_limit and insert the
	// enrollment atomically, so two simultaneous requests for the last
	// slot can't both succeed. PostgresHandler has no transaction/locking
	// primitive yet (query() runs each call as its own implicit
	// transaction on a pool connection, not held across the
	// check-then-insert sequence) — the check and insert below are NOT
	// atomic and can race under real concurrent load. This is a
	// correctness gap flagged here, not silently accepted: implementing
	// it needs PostgresHandler to expose a way to run multiple statements
	// against one checked-out client inside BEGIN/COMMIT.
	private async book(req: Request, res: Response): Promise<void> {
		const sessionId = Number(req.params.sessionId);
		const { studentId, householdId } = req.body as { studentId: number; householdId: number };

		const session = await this.sessions.findById(sessionId);
		if (!session) {
			res.status(404).end();
			return;
		}

		if ((session.currentRosterCount ?? 0) >= session.capacityLimit) {
			// PRD: route to waitlist instead of rejecting outright — not
			// implemented (see the waitlist TODOs above), so this only
			// reports the capacity conflict for now.
			res.status(409).json({ error: 'Session at capacity', waitlisted: false });
			return;
		}

		const enrollment = await this.enrollments.create({ studentId, sessionId, householdId, status: 'booked' });
		await this.sessions.incrementRosterCount(sessionId);
		res.status(201).json(enrollment);
	}
}
