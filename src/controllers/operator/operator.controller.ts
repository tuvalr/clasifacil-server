import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { BaseController } from '../shared/base.controller';
import { HouseholdsController } from './households/households.controller';
import { SessionsController } from './sessions/sessions.controller';
import { ClassesController } from './classes/classes.controller';
import { ClassOccurrencesController } from './classes/class-occurrences.controller';
import { AttendanceCreditsController } from './attendance-credits/attendance-credits.controller';
import { BillingController } from './billing/billing.controller';
import { RemindersController } from './reminders/reminders.controller';
import { AutopayController } from './autopay/autopay.controller';
import { OperatorSettingsController } from './settings/settings.controller';

@injectable()
export class OperatorController extends BaseController {
	public constructor(
		@inject(TYPES.HouseholdsController) householdsController: HouseholdsController,
		@inject(TYPES.SessionsController) sessionsController: SessionsController,
		@inject(TYPES.ClassesController) classesController: ClassesController,
		@inject(TYPES.ClassOccurrencesController) classOccurrencesController: ClassOccurrencesController,
		@inject(TYPES.AttendanceCreditsController) attendanceCreditsController: AttendanceCreditsController,
		@inject(TYPES.BillingController) billingController: BillingController,
		@inject(TYPES.RemindersController) remindersController: RemindersController,
		@inject(TYPES.AutopayController) autopayController: AutopayController,
		@inject(TYPES.OperatorSettingsController) settingsController: OperatorSettingsController,
	) {
		super();
		this.internalRouter.use('/sessions', sessionsController.router);
		this.internalRouter.use('/classes', classesController.router);
		this.internalRouter.use('/classes', classOccurrencesController.router);

		this.internalRouter.use('/households', householdsController.router);
		this.internalRouter.use('/attendance-credits', attendanceCreditsController.router);
		this.internalRouter.use('/billing', billingController.router);
		this.internalRouter.use('/reminders', remindersController.router);
		this.internalRouter.use('/autopay', autopayController.router);
		this.internalRouter.use('/settings', settingsController.router);
	}
}
