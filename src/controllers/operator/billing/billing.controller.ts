import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { BillingServer } from '../../../servers/billing.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListOperatorInvoicesQuery } from './types/list-operator-invoices-query.type';
import { ListOperatorInvoicesResponse } from './types/list-operator-invoices-response.type';
import { GetInvoiceResponse } from './types/get-invoice-response.type';
import { RecordOfflinePaymentResponse } from './types/record-offline-payment-response.type';
import { toPublic } from '../../../utils/to-public';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';

// UC4: Flexible Multi-Tier Payment & Billing Engine
@injectable()
export class BillingController extends BaseController {
	public constructor(@inject(TYPES.BillingServer) private readonly billingServer: BillingServer) {
		super();

		/**
		 * @openapi
		 * /api/operator/billing:
		 *   get:
		 *     summary: List invoices for an operator
		 *     tags: [Operator - Billing]
		 *     parameters:
		 *       - in: query
		 *         name: operatorId
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
		 *       404: { description: Operator not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/', RouteHandlers.wrapNoParamsQuery(this.listInvoices.bind(this)));

		/**
		 * @openapi
		 * /api/operator/billing/{id}:
		 *   get:
		 *     summary: Get invoice by ID
		 *     tags: [Operator - Billing]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/InvoiceAndPayment' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id', RouteHandlers.wrapOneParam('id', this.getInvoiceById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/billing/{id}/record-offline-payment:
		 *   post:
		 *     summary: Record an offline (cash) payment
		 *     tags: [Operator - Billing]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/InvoiceAndPayment' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/record-offline-payment', RouteHandlers.wrapOneParam('id', this.recordOfflinePayment.bind(this)));

		// TODO: requires a class-pack balance table (PRD Model 3: "10-class pack for €130", decremented per booking) - no such table exists yet.
		this.internalRouter.get('/class-packs/:householdId', RouteHandlers.notImplemented);

		// TODO: requires Stripe Connect integration (PRD Model 4: split payouts to the operator's connected account) - no Stripe SDK is
		// installed and operators.stripe_account_id, while present, isn't wired to any payment flow yet.
		this.internalRouter.post('/stripe/connect', RouteHandlers.notImplemented);
	}

	private async listInvoices(query: ListOperatorInvoicesQuery): Promise<Result<ListOperatorInvoicesResponse>> {
		const operatorId = Number(query.operatorId);
		if (!query.operatorId || Number.isNaN(operatorId)) {
			return Results.badRequest('operatorId is required');
		}

		const invoices = await this.billingServer.findByOperatorId(operatorId);
		if (!invoices) {
			return Results.notFound();
		}
		return Results.ok(invoices.map(toPublic));
	}

	private async getInvoiceById(id: string): Promise<Result<GetInvoiceResponse>> {
		const invoice = await this.billingServer.findById(Number(id));
		if (!invoice) {
			return Results.notFound();
		}
		return Results.ok(toPublic(invoice));
	}

	private async recordOfflinePayment(id: string): Promise<Result<RecordOfflinePaymentResponse>> {
		const invoice = await this.billingServer.recordOfflinePayment(Number(id));
		if (!invoice) {
			return Results.notFound();
		}
		return Results.ok(toPublic(invoice));
	}
}
