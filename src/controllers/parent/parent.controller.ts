import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { BaseController } from '../shared/base.controller';
import { ParentHouseholdsController } from './households/households.controller';
import { BookingController } from './booking/booking.controller';
import { ParentAttendanceCreditsController } from './attendance-credits/attendance-credits.controller';
import { ParentBillingController } from './billing/billing.controller';
import { ParentAutopayController } from './autopay/autopay.controller';
import { ParentSettingsController } from './settings/settings.controller';

@injectable()
export class ParentController extends BaseController {
	public constructor(
		@inject(TYPES.ParentHouseholdsController) householdsController: ParentHouseholdsController,
		@inject(TYPES.BookingController) bookingController: BookingController,
		@inject(TYPES.ParentAttendanceCreditsController) attendanceCreditsController: ParentAttendanceCreditsController,
		@inject(TYPES.ParentBillingController) billingController: ParentBillingController,
		@inject(TYPES.ParentAutopayController) autopayController: ParentAutopayController,
		@inject(TYPES.ParentSettingsController) settingsController: ParentSettingsController,
	) {
		super();
		this.internalRouter.use('/households', householdsController.router);
		this.internalRouter.use('/booking', bookingController.router);
		this.internalRouter.use('/attendance-credits', attendanceCreditsController.router);
		this.internalRouter.use('/billing', billingController.router);
		this.internalRouter.use('/autopay', autopayController.router);
		this.internalRouter.use('/settings', settingsController.router);
	}
}
