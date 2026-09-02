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
import { PostgresHandler } from '../handlers/postgres-handler';
import { EnvHandler } from '../handlers/env-handler';
import { HouseholdRepository } from '../repositories/household.repository';
import { StudentRepository } from '../repositories/student.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { SessionRepository } from '../repositories/session.repository';
import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';
import { InvoiceAndPaymentRepository } from '../repositories/invoice-and-payment.repository';
import { UserRepository } from '../repositories/user.repository';
import { HouseholdsServer } from '../servers/households.server';
import { SessionsServer } from '../servers/sessions.server';
import { AttendanceCreditsServer } from '../servers/attendance-credits.server';
import { BillingServer } from '../servers/billing.server';
import { AutopayServer } from '../servers/autopay.server';
import { RemindersServer } from '../servers/reminders.server';
import { OperatorsServer } from '../servers/operators.server';
import { AdminController } from '../controllers/admin/admin.controller';
import { OperatorController } from '../controllers/operator/operator.controller';
import { ParentController } from '../controllers/parent/parent.controller';

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

	container.bind<HouseholdsServer>(TYPES.HouseholdsServer).to(HouseholdsServer).inSingletonScope();
	container.bind<SessionsServer>(TYPES.SessionsServer).to(SessionsServer).inSingletonScope();
	container.bind<AttendanceCreditsServer>(TYPES.AttendanceCreditsServer).to(AttendanceCreditsServer).inSingletonScope();
	container.bind<BillingServer>(TYPES.BillingServer).to(BillingServer).inSingletonScope();
	container.bind<AutopayServer>(TYPES.AutopayServer).to(AutopayServer).inSingletonScope();
	container.bind<RemindersServer>(TYPES.RemindersServer).to(RemindersServer).inSingletonScope();
	container.bind<OperatorsServer>(TYPES.OperatorsServer).to(OperatorsServer).inSingletonScope();

	container.bind<AdminController>(TYPES.AdminController).to(AdminController).inSingletonScope();
	container.bind<OperatorController>(TYPES.OperatorController).to(OperatorController).inSingletonScope();
	container.bind<ParentController>(TYPES.ParentController).to(ParentController).inSingletonScope();

	container.bind<App>(TYPES.App).to(App).inSingletonScope();
	container.bind<Server>(TYPES.Server).to(Server).inSingletonScope();

	await container.get<Server>(TYPES.Server).start();
}

bootstrap().catch((error: unknown) => {
	// eslint-disable-next-line no-console -- logger may not be available if bootstrap failed before it was constructed
	console.error('server failed to start', error);
	process.exit(1);
});
