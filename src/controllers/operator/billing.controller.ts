import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { InvoiceAndPaymentRepository } from '../../repositories/invoice-and-payment.repository';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';

// UC4: Flexible Multi-Tier Payment & Billing Engine (operator side).
@injectable()
export class OperatorBillingController extends BaseController {
	public constructor(@inject(TYPES.InvoiceAndPaymentRepository) private readonly invoices: InvoiceAndPaymentRepository) {
		super();
		this.internalRouter.get('/', RouteHandlers.wrap(this.list.bind(this)));
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getById.bind(this)));
		// Model 2: Cash / Offline Payment Recording. PRD requires logging
		// WHO recorded the payment "to prevent unrecorded revenue" — the
		// invoices_and_payments table has operator_id (who the invoice
		// belongs to) but no separate recorded_by_user_id column, so this
		// only marks the invoice paid; it can't yet record which staff
		// member logged it.
		this.internalRouter.post('/:id/record-offline-payment', RouteHandlers.wrap(this.recordOfflinePayment.bind(this)));
		// TODO: requires a class-pack balance table (PRD Model 3: "10-class
		// pack for €130", decremented per booking) — no such table exists
		// yet.
		this.internalRouter.get('/class-packs/:householdId', RouteHandlers.notImplemented);
		// TODO: requires Stripe Connect integration (PRD Model 4: split
		// payouts to the operator's connected account) — no Stripe SDK is
		// installed and operators.stripe_account_id, while present, isn't
		// wired to any payment flow yet.
		this.internalRouter.post('/stripe/connect', RouteHandlers.notImplemented);
	}

	private async list(req: Request, res: Response): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		const invoices = await this.invoices.findByOperatorId(operatorId);
		res.json(invoices);
	}

	private async getById(req: Request, res: Response): Promise<void> {
		const invoice = await this.invoices.findById(Number(req.params.id));
		if (!invoice) {
			res.status(404).end();
			return;
		}
		res.json(invoice);
	}

	private async recordOfflinePayment(req: Request, res: Response): Promise<void> {
		const invoice = await this.invoices.updateStatus(Number(req.params.id), 'paid_offline', null);
		if (!invoice) {
			res.status(404).end();
			return;
		}
		res.json(invoice);
	}
}
