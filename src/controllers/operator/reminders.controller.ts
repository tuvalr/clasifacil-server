import { injectable } from 'inversify';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';

// UC5: Automated Payment Reminders & Consolidated Invoicing.
// TODO: entirely unsupported by the current schema — no table for
// reminder-timeline config, dunning-retry state, or broadcast
// delivery-receipt tracking exists yet (PRD: "7 days before due, 1 day
// before due", 3-day dunning retry sequence, bounced-email/phone
// tracking for broadcasts). Routes below exist to establish the API
// surface; none are backed by real logic.
@injectable()
export class OperatorRemindersController extends BaseController {
	public constructor() {
		super();
		this.internalRouter.put('/config', RouteHandlers.notImplemented);
		this.internalRouter.get('/dunning-status/:householdId', RouteHandlers.notImplemented);
		this.internalRouter.post('/broadcast', RouteHandlers.notImplemented);
		this.internalRouter.get('/broadcast/:id/delivery-receipts', RouteHandlers.notImplemented);
	}
}
