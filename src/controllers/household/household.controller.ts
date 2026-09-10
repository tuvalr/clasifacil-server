import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { BaseController } from '../shared/base.controller';
import { HouseholdHouseholdsController } from './households/households.controller';
import { BookingController } from './booking/booking.controller';
import { HouseholdAttendanceCreditsController } from './attendance-credits/attendance-credits.controller';
import { HouseholdBillingController } from './billing/billing.controller';
import { HouseholdAutopayController } from './autopay/autopay.controller';
import { HouseholdSettingsController } from './settings/settings.controller';

@injectable()
export class HouseholdController extends BaseController {
	public constructor(
		@inject(TYPES.HouseholdHouseholdsController) householdsController: HouseholdHouseholdsController,
		@inject(TYPES.BookingController) bookingController: BookingController,
		@inject(TYPES.HouseholdAttendanceCreditsController) attendanceCreditsController: HouseholdAttendanceCreditsController,
		@inject(TYPES.HouseholdBillingController) billingController: HouseholdBillingController,
		@inject(TYPES.HouseholdAutopayController) autopayController: HouseholdAutopayController,
		@inject(TYPES.HouseholdSettingsController) settingsController: HouseholdSettingsController,
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
