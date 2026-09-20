import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { BillingServer } from '../../../servers/billing.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListOwnInvoicesResponse } from './types/list-own-invoices-response.type';
import { toPublic } from '../../../utils/to-public';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';

// UC4: Flexible Multi-Tier Payment & Billing Engine
@injectable()
export class HouseholdBillingController extends BaseController {
	public constructor(@inject(TYPES.BillingServer) private readonly billingServer: BillingServer) {
		super();

		/**
		 * @openapi
		 * /api/household/billing/households/{householdId}/invoices:
		 *   get:
		 *     summary: List own household's invoices
		 *     tags: [Household - Billing]
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
		this.internalRouter.get('/households/:householdId/invoices', RouteHandlers.wrapOneParam('householdId', this.listInvoices.bind(this)));

		// Model 1: Pay-Per-Class (Drop-in) card checkout. TODO: requires a payment-processor integration (Stripe) - no Stripe SDK is
		// installed and invoices_and_payments.stripe_charge_id, while present, has no write path yet.
		this.internalRouter.post('/invoices/:id/pay', RouteHandlers.notImplemented);

		// TODO: requires a class-pack balance table (PRD Model 3) - no such table exists yet.
		this.internalRouter.get('/households/:householdId/class-packs', RouteHandlers.notImplemented);

		this.internalRouter.post('/households/:householdId/class-packs/purchase', RouteHandlers.notImplemented);
	}

	private async listInvoices(householdId: string): Promise<Result<ListOwnInvoicesResponse>> {
		const invoices = await this.billingServer.findByHouseholdId(Number(householdId));
		if (!invoices) {
			return Results.notFound();
		}
		return Results.ok(invoices.map(toPublic));
	}
}
