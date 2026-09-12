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
import { ClassRepository } from '../repositories/class.repository';
import { HouseholdsServer } from '../servers/households.server';
import { SessionsServer } from '../servers/sessions.server';
import { AttendanceCreditsServer } from '../servers/attendance-credits.server';
import { BillingServer } from '../servers/billing.server';
import { AutopayServer } from '../servers/autopay.server';
import { RemindersServer } from '../servers/reminders.server';
import { OperatorsServer } from '../servers/operators.server';
import { ClassesServer } from '../servers/classes.server';
import { AvatarsServer } from '../servers/avatars.server';
import { AvatarStorage } from '../servers/types/avatar-storage';
import { LocalDiskAvatarStorage } from '../servers/local-disk-avatar-storage';
import { AdminController } from '../controllers/admin/admin.controller';
import { AdminOperatorsController } from '../controllers/admin/operators/operators.controller';
import { AdminHouseholdsController } from '../controllers/admin/households/households.controller';
import { OperatorController } from '../controllers/operator/operator.controller';
import { HouseholdsController } from '../controllers/operator/households/households.controller';
import { SessionsController } from '../controllers/operator/sessions/sessions.controller';
import { AttendanceCreditsController } from '../controllers/operator/attendance-credits/attendance-credits.controller';
import { BillingController } from '../controllers/operator/billing/billing.controller';
import { RemindersController } from '../controllers/operator/reminders/reminders.controller';
import { AutopayController } from '../controllers/operator/autopay/autopay.controller';
import { ClassesController } from '../controllers/operator/classes/classes.controller';
import { HouseholdController } from '../controllers/household/household.controller';
import { HouseholdHouseholdsController } from '../controllers/household/households/households.controller';
import { BookingController } from '../controllers/household/booking/booking.controller';
import { HouseholdAttendanceCreditsController } from '../controllers/household/attendance-credits/attendance-credits.controller';
import { HouseholdBillingController } from '../controllers/household/billing/billing.controller';
import { HouseholdAutopayController } from '../controllers/household/autopay/autopay.controller';
import { HouseholdSettingsController } from '../controllers/household/settings/settings.controller';
import { OperatorSettingsController } from '../controllers/operator/settings/settings.controller';

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
	container.bind<ClassRepository>(TYPES.ClassRepository).to(ClassRepository).inSingletonScope();

	container.bind<HouseholdsServer>(TYPES.HouseholdsServer).to(HouseholdsServer).inSingletonScope();
	container.bind<SessionsServer>(TYPES.SessionsServer).to(SessionsServer).inSingletonScope();
	container.bind<AttendanceCreditsServer>(TYPES.AttendanceCreditsServer).to(AttendanceCreditsServer).inSingletonScope();
	container.bind<BillingServer>(TYPES.BillingServer).to(BillingServer).inSingletonScope();
	container.bind<AutopayServer>(TYPES.AutopayServer).to(AutopayServer).inSingletonScope();
	container.bind<RemindersServer>(TYPES.RemindersServer).to(RemindersServer).inSingletonScope();
	container.bind<OperatorsServer>(TYPES.OperatorsServer).to(OperatorsServer).inSingletonScope();
	container.bind<ClassesServer>(TYPES.ClassesServer).to(ClassesServer).inSingletonScope();
	container.bind<AvatarStorage>(TYPES.AvatarStorage).to(LocalDiskAvatarStorage).inSingletonScope();
	container.bind<AvatarsServer>(TYPES.AvatarsServer).to(AvatarsServer).inSingletonScope();

	container.bind<AdminOperatorsController>(TYPES.AdminOperatorsController).to(AdminOperatorsController).inSingletonScope();
	container.bind<AdminHouseholdsController>(TYPES.AdminHouseholdsController).to(AdminHouseholdsController).inSingletonScope();
	container.bind<AdminController>(TYPES.AdminController).to(AdminController).inSingletonScope();
	container.bind<HouseholdsController>(TYPES.HouseholdsController).to(HouseholdsController).inSingletonScope();
	container.bind<SessionsController>(TYPES.SessionsController).to(SessionsController).inSingletonScope();
	container.bind<AttendanceCreditsController>(TYPES.AttendanceCreditsController).to(AttendanceCreditsController).inSingletonScope();
	container.bind<BillingController>(TYPES.BillingController).to(BillingController).inSingletonScope();
	container.bind<RemindersController>(TYPES.RemindersController).to(RemindersController).inSingletonScope();
	container.bind<AutopayController>(TYPES.AutopayController).to(AutopayController).inSingletonScope();
	container.bind<ClassesController>(TYPES.ClassesController).to(ClassesController).inSingletonScope();
	container.bind<OperatorController>(TYPES.OperatorController).to(OperatorController).inSingletonScope();
	container.bind<HouseholdHouseholdsController>(TYPES.HouseholdHouseholdsController).to(HouseholdHouseholdsController).inSingletonScope();
	container.bind<BookingController>(TYPES.BookingController).to(BookingController).inSingletonScope();
	container.bind<HouseholdAttendanceCreditsController>(TYPES.HouseholdAttendanceCreditsController).to(HouseholdAttendanceCreditsController).inSingletonScope();
	container.bind<HouseholdBillingController>(TYPES.HouseholdBillingController).to(HouseholdBillingController).inSingletonScope();
	container.bind<HouseholdAutopayController>(TYPES.HouseholdAutopayController).to(HouseholdAutopayController).inSingletonScope();
	container.bind<HouseholdSettingsController>(TYPES.HouseholdSettingsController).to(HouseholdSettingsController).inSingletonScope();
	container.bind<OperatorSettingsController>(TYPES.OperatorSettingsController).to(OperatorSettingsController).inSingletonScope();
	container.bind<HouseholdController>(TYPES.HouseholdController).to(HouseholdController).inSingletonScope();

	container.bind<App>(TYPES.App).to(App).inSingletonScope();
	container.bind<Server>(TYPES.Server).to(Server).inSingletonScope();

	await container.get<Server>(TYPES.Server).start();
}

bootstrap().catch((error: unknown) => {
	// eslint-disable-next-line no-console -- logger may not be available if bootstrap failed before it was constructed
	console.error('server failed to start', error);
	process.exit(1);
});
