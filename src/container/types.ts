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
	UserRepository: Symbol.for('UserRepository'),

	HouseholdsServer: Symbol.for('HouseholdsServer'),
	SessionsServer: Symbol.for('SessionsServer'),
	AttendanceCreditsServer: Symbol.for('AttendanceCreditsServer'),
	BillingServer: Symbol.for('BillingServer'),
	AutopayServer: Symbol.for('AutopayServer'),
	RemindersServer: Symbol.for('RemindersServer'),
	OperatorsServer: Symbol.for('OperatorsServer'),

	AdminController: Symbol.for('AdminController'),
	OperatorController: Symbol.for('OperatorController'),
	ParentController: Symbol.for('ParentController'),
};
