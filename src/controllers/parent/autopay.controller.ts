import { injectable } from 'inversify';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';

// UC6: Parent Autopay Opt-Out & Operator Notice Controls (parent side).
// TODO: entirely unsupported by the current schema — no
// households.autopay_enabled flag exists (PRD: "a prominent,
// frictionless toggle... Automatic Payments (Autopay)"), so there's
// nothing to read or write yet.
@injectable()
export class ParentAutopayController extends BaseController {
	public constructor() {
		super();
		this.internalRouter.get('/households/:householdId/autopay', RouteHandlers.notImplemented);
		this.internalRouter.put('/households/:householdId/autopay', RouteHandlers.notImplemented);
	}
}
