import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { InvoiceAndPaymentRepository } from '../../repositories/invoice-and-payment.repository';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';

// UC4: Flexible Multi-Tier Payment & Billing Engine (parent side).
@injectable()
export class ParentBillingController extends BaseController {
	public constructor(@inject(TYPES.InvoiceAndPaymentRepository) private readonly invoices: InvoiceAndPaymentRepository) {
		super();
		this.internalRouter.get('/households/:householdId/invoices', RouteHandlers.wrap(this.listInvoices.bind(this)));
		// Model 1: Pay-Per-Class (Drop-in) card checkout. TODO: requires a
		// payment-processor integration (Stripe) — no Stripe SDK is
		// installed and invoices_and_payments.stripe_charge_id, while
		// present, has no write path yet.
		this.internalRouter.post('/invoices/:id/pay', RouteHandlers.notImplemented);
		// TODO: requires a class-pack balance table (PRD Model 3) — no
		// such table exists yet.
		this.internalRouter.get('/households/:householdId/class-packs', RouteHandlers.notImplemented);
		this.internalRouter.post('/households/:householdId/class-packs/purchase', RouteHandlers.notImplemented);
	}

	private async listInvoices(req: Request, res: Response): Promise<void> {
		const invoices = await this.invoices.findByHouseholdId(Number(req.params.householdId));
		res.json(invoices);
	}
}
