import { injectable } from 'inversify';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';

// UC6: Household Autopay Opt-Out & Operator Notice Controls
// TODO: entirely unsupported by the current schema — see AutopayServer.
@injectable()
export class AutopayController extends BaseController {
	public constructor() {
		super();
		this.internalRouter.put('/policy', RouteHandlers.notImplemented);
		this.internalRouter.put('/policy/:householdId', RouteHandlers.notImplemented);
	}
}
