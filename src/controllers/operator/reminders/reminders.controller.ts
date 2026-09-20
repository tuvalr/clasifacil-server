import { injectable } from 'inversify';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';

// UC5: Automated Payment Reminders & Consolidated Invoicing
// TODO: entirely unsupported by the current schema - see RemindersServer.
@injectable()
export class RemindersController extends BaseController {
	public constructor() {
		super();
		this.internalRouter.put('/config', RouteHandlers.notImplemented);
		this.internalRouter.get('/dunning-status/:householdId', RouteHandlers.notImplemented);
		this.internalRouter.post('/broadcast', RouteHandlers.notImplemented);
		this.internalRouter.get('/broadcast/:id/delivery-receipts', RouteHandlers.notImplemented);
	}
}
