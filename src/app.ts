import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { inject, injectable } from 'inversify';
import { TYPES } from './container/types';
import { Config } from './config/env';
import { AdminOperatorsController } from './controllers/admin/operators.controller';
import { OperatorHouseholdsController } from './controllers/operator/households.controller';
import { OperatorSessionsController } from './controllers/operator/sessions.controller';
import { OperatorAttendanceCreditsController } from './controllers/operator/attendance-credits.controller';
import { OperatorBillingController } from './controllers/operator/billing.controller';
import { OperatorRemindersController } from './controllers/operator/reminders.controller';
import { OperatorAutopayController } from './controllers/operator/autopay.controller';
import { ParentHouseholdsController } from './controllers/parent/households.controller';
import { ParentBookingController } from './controllers/parent/booking.controller';
import { ParentAttendanceCreditsController } from './controllers/parent/attendance-credits.controller';
import { ParentBillingController } from './controllers/parent/billing.controller';
import { ParentAutopayController } from './controllers/parent/autopay.controller';

@injectable()
export class App {
	private readonly internalExpress: Express;

	public constructor(
		@inject(TYPES.Config) private readonly config: Config,
		@inject(TYPES.AdminOperatorsController) private readonly adminOperators: AdminOperatorsController,
		@inject(TYPES.OperatorHouseholdsController) private readonly operatorHouseholds: OperatorHouseholdsController,
		@inject(TYPES.OperatorSessionsController) private readonly operatorSessions: OperatorSessionsController,
		@inject(TYPES.OperatorAttendanceCreditsController) private readonly operatorAttendanceCredits: OperatorAttendanceCreditsController,
		@inject(TYPES.OperatorBillingController) private readonly operatorBilling: OperatorBillingController,
		@inject(TYPES.OperatorRemindersController) private readonly operatorReminders: OperatorRemindersController,
		@inject(TYPES.OperatorAutopayController) private readonly operatorAutopay: OperatorAutopayController,
		@inject(TYPES.ParentHouseholdsController) private readonly parentHouseholds: ParentHouseholdsController,
		@inject(TYPES.ParentBookingController) private readonly parentBooking: ParentBookingController,
		@inject(TYPES.ParentAttendanceCreditsController) private readonly parentAttendanceCredits: ParentAttendanceCreditsController,
		@inject(TYPES.ParentBillingController) private readonly parentBilling: ParentBillingController,
		@inject(TYPES.ParentAutopayController) private readonly parentAutopay: ParentAutopayController,
	) {
		this.internalExpress = express();
		this.middleware();
		this.routes();
	}

	public get express(): Express {
		return this.internalExpress;
	}

	private middleware(): void {
		this.internalExpress.use(helmet());
		this.internalExpress.use(cors({ origin: this.config.corsOrigin }));
		this.internalExpress.use(express.json());
	}

	private routes(): void {
		this.internalExpress.use('/api/admin/operators', this.adminOperators.router);

		this.internalExpress.use('/api/operator/households', this.operatorHouseholds.router);
		this.internalExpress.use('/api/operator/sessions', this.operatorSessions.router);
		this.internalExpress.use('/api/operator/attendance-credits', this.operatorAttendanceCredits.router);
		this.internalExpress.use('/api/operator/billing', this.operatorBilling.router);
		this.internalExpress.use('/api/operator/reminders', this.operatorReminders.router);
		this.internalExpress.use('/api/operator/autopay', this.operatorAutopay.router);

		this.internalExpress.use('/api/parent/households', this.parentHouseholds.router);
		this.internalExpress.use('/api/parent/booking', this.parentBooking.router);
		this.internalExpress.use('/api/parent/attendance-credits', this.parentAttendanceCredits.router);
		this.internalExpress.use('/api/parent/billing', this.parentBilling.router);
		this.internalExpress.use('/api/parent/autopay', this.parentAutopay.router);
	}
}
