import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { InvoiceAndPaymentRepository } from '../repositories/invoice-and-payment.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { HouseholdRepository } from '../repositories/household.repository';
import { InvoiceAndPayment } from '../entities/invoice-and-payment.entity';

// UC4: Flexible Multi-Tier Payment & Billing Engine. Operator-side
// (viewing invoices, recording offline payments) and household-side
// (viewing own invoices) live together since both operate on the same
// invoices_and_payments data.
@injectable()
export class BillingServer {
	public constructor(
		@inject(TYPES.InvoiceAndPaymentRepository) private readonly invoices: InvoiceAndPaymentRepository,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.HouseholdRepository) private readonly households: HouseholdRepository,
	) {}

	// Operator-side

	public async findByOperatorId(operatorId: number): Promise<InvoiceAndPayment[] | null> {
		const operator = await this.operators.findById(operatorId);
		if (!operator) {
			return null;
		}
		return this.invoices.findByOperatorId(operatorId);
	}

	public async findById(id: number): Promise<InvoiceAndPayment | null> {
		return this.invoices.findById(id);
	}

	// Model 2: Cash / Offline Payment Recording. PRD requires logging WHO
	// recorded the payment "to prevent unrecorded revenue" - the
	// invoices_and_payments table has operator_id (who the invoice
	// belongs to) but no separate recorded_by_user_id column, so this
	// only marks the invoice paid; it can't yet record which staff member
	// logged it.
	public async recordOfflinePayment(id: number): Promise<InvoiceAndPayment | null> {
		return this.invoices.updateStatus(id, 'paid_offline', null);
	}

	// TODO: requires a class-pack balance table (PRD Model 3: "10-class
	// pack for €130", decremented per booking) - no such table exists yet.

	// TODO: requires Stripe Connect integration (PRD Model 4: split
	// payouts to the operator's connected account) - no Stripe SDK is
	// installed and operators.stripe_account_id, while present, isn't
	// wired to any payment flow yet.

	// Household-side

	public async findByHouseholdId(householdId: number): Promise<InvoiceAndPayment[] | null> {
		const household = await this.households.findById(householdId);
		if (!household) {
			return null;
		}
		return this.invoices.findByHouseholdId(householdId);
	}

	// TODO: Model 1 Pay-Per-Class (Drop-in) card checkout - requires a
	// payment-processor integration (Stripe) - no Stripe SDK is installed
	// and invoices_and_payments.stripe_charge_id, while present, has no
	// write path yet.
}
