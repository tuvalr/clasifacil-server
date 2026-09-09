import { injectable } from 'inversify';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';

// UC6: Parent Autopay Opt-Out & Operator Notice Controls
// TODO: entirely unsupported by the current schema — see AutopayServer.
@injectable()
export class ParentAutopayController extends BaseController {
	public constructor() {
		super();
		this.internalRouter.get('/households/:householdId/autopay', RouteHandlers.notImplemented);
		this.internalRouter.put('/households/:householdId/autopay', RouteHandlers.notImplemented);
	}
}
