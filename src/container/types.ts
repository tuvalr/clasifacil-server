// Symbol identifiers for Inversify bindings.
// Add entries here as services/repositories are introduced, e.g.:
//   SomeService: Symbol.for('SomeService'),
export const TYPES = {
	Logger: Symbol.for('Logger'),
	Config: Symbol.for('Config'),
	App: Symbol.for('App'),
	Server: Symbol.for('Server'),
	PostgresHandler: Symbol.for('PostgresHandler'),
	EnvHandler: Symbol.for('EnvHandler'),

	HouseholdRepository: Symbol.for('HouseholdRepository'),
	StudentRepository: Symbol.for('StudentRepository'),
	OperatorRepository: Symbol.for('OperatorRepository'),
	SessionRepository: Symbol.for('SessionRepository'),
	EnrollmentAndCreditRepository: Symbol.for('EnrollmentAndCreditRepository'),
	InvoiceAndPaymentRepository: Symbol.for('InvoiceAndPaymentRepository'),

	OperatorHouseholdsController: Symbol.for('OperatorHouseholdsController'),
	OperatorSessionsController: Symbol.for('OperatorSessionsController'),
	OperatorAttendanceCreditsController: Symbol.for('OperatorAttendanceCreditsController'),
	OperatorBillingController: Symbol.for('OperatorBillingController'),
	OperatorRemindersController: Symbol.for('OperatorRemindersController'),
	OperatorAutopayController: Symbol.for('OperatorAutopayController'),

	ParentHouseholdsController: Symbol.for('ParentHouseholdsController'),
	ParentBookingController: Symbol.for('ParentBookingController'),
	ParentAttendanceCreditsController: Symbol.for('ParentAttendanceCreditsController'),
	ParentBillingController: Symbol.for('ParentBillingController'),
	ParentAutopayController: Symbol.for('ParentAutopayController'),
};
