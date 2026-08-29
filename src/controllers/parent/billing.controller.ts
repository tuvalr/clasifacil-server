import { Router, Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { InvoiceAndPaymentRepository } from '../../repositories/invoice-and-payment.repository';
import { notImplemented } from '../shared/not-implemented';
import { asyncHandler } from '../shared/async-handler';

// UC4: Flexible Multi-Tier Payment & Billing Engine (parent side).
@injectable()
export class ParentBillingController {
	private readonly internalRouter: Router;

	public constructor(@inject(TYPES.InvoiceAndPaymentRepository) private readonly invoices: InvoiceAndPaymentRepository) {
		this.internalRouter = Router();
		this.internalRouter.get('/households/:householdId/invoices', asyncHandler(this.listInvoices.bind(this)));
		// Model 1: Pay-Per-Class (Drop-in) card checkout. TODO: requires a
		// payment-processor integration (Stripe) — no Stripe SDK is
		// installed and invoices_and_payments.stripe_charge_id, while
		// present, has no write path yet.
		this.internalRouter.post('/invoices/:id/pay', notImplemented);
		// TODO: requires a class-pack balance table (PRD Model 3) — no
		// such table exists yet.
		this.internalRouter.get('/households/:householdId/class-packs', notImplemented);
		this.internalRouter.post('/households/:householdId/class-packs/purchase', notImplemented);
	}

	public get router(): Router {
		return this.internalRouter;
	}

	private async listInvoices(req: Request, res: Response): Promise<void> {
		const invoices = await this.invoices.findByHouseholdId(Number(req.params.householdId));
		res.json(invoices);
	}
}
