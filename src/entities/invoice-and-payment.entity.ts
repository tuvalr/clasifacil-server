import { BaseEntity, EntityDescriptor } from './base.entity';

export interface InvoiceAndPayment extends BaseEntity {
	householdId: number;
	operatorId: number;
	// NUMERIC column — pg returns this as a decimal string (e.g. "49.99"),
	// not a JS number, to avoid floating-point rounding on monetary
	// values. Use a decimal-safe library for arithmetic if/when needed.
	amount: string;
	paymentType: string;
	status: string;
	stripeChargeId: string | null;
}

export const InvoiceAndPaymentEntity: EntityDescriptor<InvoiceAndPayment> = {
	tableName: 'invoices_and_payments',
};
