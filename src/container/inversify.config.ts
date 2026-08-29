import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.${process.env.NODE_ENV ?? 'dev'}`;
const result = dotenv.config({ path: path.resolve(process.cwd(), envFile) });
if (result.error) {
	throw new Error(`Failed to load env file "${envFile}": ${result.error.message}`);
}

import { Container } from 'inversify';
import { TYPES } from './types';
import { Config, loadConfig } from '../config/env';
import { Logger } from '../logger/logger';
import { PinoLogger } from '../logger/pino-logger';
import { App } from '../app';
import { Server } from '../server';
import { PostgresHandler } from '../services/postgres-handler';
import { EnvHandler } from '../services/env-handler';
import { HouseholdRepository } from '../repositories/household.repository';
import { StudentRepository } from '../repositories/student.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { SessionRepository } from '../repositories/session.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { InvoiceAndPaymentRepository } from '../repositories/invoice-and-payment.repository';
import { UserRepository } from '../repositories/user.repository';
import { AdminOperatorsController } from '../controllers/admin/operators.controller';
import { OperatorHouseholdsController } from '../controllers/operator/households.controller';
import { OperatorSessionsController } from '../controllers/operator/sessions.controller';
import { OperatorAttendanceCreditsController } from '../controllers/operator/attendance-credits.controller';
import { OperatorBillingController } from '../controllers/operator/billing.controller';
import { OperatorRemindersController } from '../controllers/operator/reminders.controller';
import { OperatorAutopayController } from '../controllers/operator/autopay.controller';
import { ParentHouseholdsController } from '../controllers/parent/households.controller';
import { ParentBookingController } from '../controllers/parent/booking.controller';
import { ParentAttendanceCreditsController } from '../controllers/parent/attendance-credits.controller';
import { ParentBillingController } from '../controllers/parent/billing.controller';
import { ParentAutopayController } from '../controllers/parent/autopay.controller';

async function bootstrap(): Promise<void> {
	const logger: Logger = new PinoLogger();
	const envHandler = new EnvHandler(logger);
	await envHandler.load();

	const config = loadConfig();

	const container = new Container();

	container.bind<Config>(TYPES.Config).toConstantValue(config);
	container.bind<Logger>(TYPES.Logger).toConstantValue(logger);
	container.bind<EnvHandler>(TYPES.EnvHandler).toConstantValue(envHandler);
	container.bind<PostgresHandler>(TYPES.PostgresHandler).to(PostgresHandler).inSingletonScope();

	container.bind<HouseholdRepository>(TYPES.HouseholdRepository).to(HouseholdRepository).inSingletonScope();
	container.bind<StudentRepository>(TYPES.StudentRepository).to(StudentRepository).inSingletonScope();
	container.bind<OperatorRepository>(TYPES.OperatorRepository).to(OperatorRepository).inSingletonScope();
	container.bind<SessionRepository>(TYPES.SessionRepository).to(SessionRepository).inSingletonScope();
	container.bind<EnrollmentAndCreditRepository>(TYPES.EnrollmentAndCreditRepository).to(EnrollmentAndCreditRepository).inSingletonScope();
	container.bind<InvoiceAndPaymentRepository>(TYPES.InvoiceAndPaymentRepository).to(InvoiceAndPaymentRepository).inSingletonScope();
	container.bind<UserRepository>(TYPES.UserRepository).to(UserRepository).inSingletonScope();

	container.bind<AdminOperatorsController>(TYPES.AdminOperatorsController).to(AdminOperatorsController).inSingletonScope();

	container.bind<OperatorHouseholdsController>(TYPES.OperatorHouseholdsController).to(OperatorHouseholdsController).inSingletonScope();
	container.bind<OperatorSessionsController>(TYPES.OperatorSessionsController).to(OperatorSessionsController).inSingletonScope();
	container.bind<OperatorAttendanceCreditsController>(TYPES.OperatorAttendanceCreditsController).to(OperatorAttendanceCreditsController).inSingletonScope();
	container.bind<OperatorBillingController>(TYPES.OperatorBillingController).to(OperatorBillingController).inSingletonScope();
	container.bind<OperatorRemindersController>(TYPES.OperatorRemindersController).to(OperatorRemindersController).inSingletonScope();
	container.bind<OperatorAutopayController>(TYPES.OperatorAutopayController).to(OperatorAutopayController).inSingletonScope();

	container.bind<ParentHouseholdsController>(TYPES.ParentHouseholdsController).to(ParentHouseholdsController).inSingletonScope();
	container.bind<ParentBookingController>(TYPES.ParentBookingController).to(ParentBookingController).inSingletonScope();
	container.bind<ParentAttendanceCreditsController>(TYPES.ParentAttendanceCreditsController).to(ParentAttendanceCreditsController).inSingletonScope();
	container.bind<ParentBillingController>(TYPES.ParentBillingController).to(ParentBillingController).inSingletonScope();
	container.bind<ParentAutopayController>(TYPES.ParentAutopayController).to(ParentAutopayController).inSingletonScope();

	container.bind<App>(TYPES.App).to(App).inSingletonScope();
	container.bind<Server>(TYPES.Server).to(Server).inSingletonScope();

	await container.get<Server>(TYPES.Server).start();
}

bootstrap().catch((error: unknown) => {
	// eslint-disable-next-line no-console -- logger may not be available if bootstrap failed before it was constructed
	console.error('server failed to start', error);
	process.exit(1);
});
