import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { InvoiceAndPayment, InvoiceAndPaymentEntity } from '../entities/invoice-and-payment.entity';

@injectable()
export class InvoiceAndPaymentRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByHouseholdId(householdId: number): Promise<InvoiceAndPayment[]> {
		return this.db.queryActive(InvoiceAndPaymentEntity, 'household_id = $1', [householdId]);
	}

	public async findByOperatorId(operatorId: number): Promise<InvoiceAndPayment[]> {
		return this.db.queryActive(InvoiceAndPaymentEntity, 'operator_id = $1', [operatorId]);
	}

	public async findById(id: number): Promise<InvoiceAndPayment | null> {
		return this.db.findById(InvoiceAndPaymentEntity, id);
	}

	public async create(data: { householdId: number; operatorId: number; amount: string; paymentType: string; status: string }): Promise<InvoiceAndPayment> {
		return this.db.insert(InvoiceAndPaymentEntity, { ...data, isDeleted: false });
	}

	public async updateStatus(id: number, status: string, stripeChargeId: string | null): Promise<InvoiceAndPayment | null> {
		return this.db.update(InvoiceAndPaymentEntity, id, { status, stripeChargeId });
	}
}
