import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { BillingServer } from '../../../servers/billing.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListOwnInvoicesResponse } from './types/list-own-invoices-response.type';

// UC4: Flexible Multi-Tier Payment & Billing Engine
@injectable()
export class ParentBillingController extends BaseController {
	public constructor(@inject(TYPES.BillingServer) private readonly billingServer: BillingServer) {
		super();

		/**
		 * @openapi
		 * /api/parent/billing/households/{householdId}/invoices:
		 *   get:
		 *     summary: List own household's invoices
		 *     tags: [Parent - Billing]
		 *     parameters:
		 *       - in: path
		 *         name: householdId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/InvoiceAndPayment' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Household not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/households/:householdId/invoices', RouteHandlers.wrap(this.listInvoices.bind(this)));

		// Model 1: Pay-Per-Class (Drop-in) card checkout. TODO: requires a payment-processor integration (Stripe) — no Stripe SDK is
		// installed and invoices_and_payments.stripe_charge_id, while present, has no write path yet.
		this.internalRouter.post('/invoices/:id/pay', RouteHandlers.notImplemented);

		// TODO: requires a class-pack balance table (PRD Model 3) — no such table exists yet.
		this.internalRouter.get('/households/:householdId/class-packs', RouteHandlers.notImplemented);

		this.internalRouter.post('/households/:householdId/class-packs/purchase', RouteHandlers.notImplemented);
	}

	private async listInvoices(req: Request<{ householdId: string }>, res: Response<ListOwnInvoicesResponse>): Promise<void> {
		const invoices = await this.billingServer.findByHouseholdId(Number(req.params.householdId));
		if (!invoices) {
			res.status(404).end();
			return;
		}
		res.json(invoices);
	}
}
