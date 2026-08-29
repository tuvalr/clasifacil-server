import { Router } from 'express';
import { injectable } from 'inversify';
import { notImplemented } from '../shared/not-implemented';

// UC5: Automated Payment Reminders & Consolidated Invoicing.
// TODO: entirely unsupported by the current schema — no table for
// reminder-timeline config, dunning-retry state, or broadcast
// delivery-receipt tracking exists yet (PRD: "7 days before due, 1 day
// before due", 3-day dunning retry sequence, bounced-email/phone
// tracking for broadcasts). Routes below exist to establish the API
// surface; none are backed by real logic.
@injectable()
export class OperatorRemindersController {
	private readonly internalRouter: Router;

	public constructor() {
		this.internalRouter = Router();
		this.internalRouter.put('/config', notImplemented);
		this.internalRouter.get('/dunning-status/:householdId', notImplemented);
		this.internalRouter.post('/broadcast', notImplemented);
		this.internalRouter.get('/broadcast/:id/delivery-receipts', notImplemented);
	}

	public get router(): Router {
		return this.internalRouter;
	}
}
