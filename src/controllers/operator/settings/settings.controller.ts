import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { OperatorsServer } from '../../../servers/operators.server';
import { OperatorTimezoneLockedError } from '../../../servers/types/operators.server.types';
import { AvatarsServer } from '../../../servers/avatars.server';
import { ValidationError } from '../../../servers/types/validation-error';
import { ClassRepository } from '../../../repositories/class.repository';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { avatarUpload } from '../../shared/avatar-upload.middleware';
import { toPublic } from '../../../utils/to-public';
import { GetOperatorSettingsResponse } from './types/get-operator-settings-response.type';
import { UpdateOperatorSettingsBody } from './types/update-operator-settings-body.type';
import { UpdateOperatorSettingsResponse } from './types/update-operator-settings-response.type';
import { UpdateOperatorSettingsValidationErrorResponse } from './types/update-operator-settings-validation-error-response.type';
import { UpdateOperatorAvatarResponse } from './types/update-operator-avatar-response.type';
import { AvatarErrorResponse } from './types/avatar-error-response.type';

@injectable()
export class OperatorSettingsController extends BaseController {
	public constructor(
		@inject(TYPES.OperatorsServer) private readonly operatorsServer: OperatorsServer,
		@inject(TYPES.AvatarsServer) private readonly avatarsServer: AvatarsServer,
		@inject(TYPES.ClassRepository) private readonly classRepository: ClassRepository,
	) {
		super();

		/**
		 * @openapi
		 * /api/operator/settings/{id}:
		 *   get:
		 *     summary: Get own settings
		 *     tags: [Operator - Settings]
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
		 *             schema: { $ref: '#/components/schemas/Operator' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getSettings.bind(this)));

		/**
		 * @openapi
		 * /api/operator/settings/{id}:
		 *   put:
		 *     summary: Update own settings
		 *     description: >
		 *       phone must be unique across operators; when provided alongside countryCode, phone is also validated
		 *       against it.
		 *     tags: [Operator - Settings]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             properties:
		 *               name: { type: string }
		 *               email: { type: string }
		 *               phone: { type: string }
		 *               countryCode: { type: string }
		 *               timezone: { type: string, description: 'IANA timezone name, e.g. America/New_York' }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Operator' }
		 *       400:
		 *         description: Validation failed
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 error: { type: string }
		 *                 details:
		 *                   type: array
		 *                   items:
		 *                     type: object
		 *                     properties:
		 *                       field: { type: string }
		 *                       message: { type: string }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       409: { description: 'timezone cannot be changed once the operator has any class' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id', RouteHandlers.wrap(this.updateSettings.bind(this)));

		/**
		 * @openapi
		 * /api/operator/settings/{id}/avatar:
		 *   put:
		 *     summary: Upload own avatar photo
		 *     description: Accepts a JPEG or PNG image up to 2MB as multipart/form-data, field name "avatar".
		 *     tags: [Operator - Settings]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         multipart/form-data:
		 *           schema:
		 *             type: object
		 *             required: [avatar]
		 *             properties:
		 *               avatar: { type: string, format: binary }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 avatarUrl: { type: string }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id/avatar', avatarUpload, RouteHandlers.wrap(this.updateAvatar.bind(this)));
	}

	private async getSettings(req: Request<{ id: string }>, res: Response<GetOperatorSettingsResponse>): Promise<void> {
		const operator = await this.operatorsServer.findById(Number(req.params.id));
		if (!operator) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(operator));
	}

	private async updateSettings(
		req: Request<{ id: string }, UpdateOperatorSettingsResponse | UpdateOperatorSettingsValidationErrorResponse | { error: string }, UpdateOperatorSettingsBody>,
		res: Response<UpdateOperatorSettingsResponse | UpdateOperatorSettingsValidationErrorResponse | { error: string }>,
	): Promise<void> {
		const { name, email, phone, countryCode, timezone } = req.body;
		try {
			const operator = await this.operatorsServer.update(Number(req.params.id), { name, email, phone, countryCode, timezone }, (operatorId: number) => this.classRepository.existsAnyForOperator(operatorId));
			if (!operator) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(operator));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			if (error instanceof OperatorTimezoneLockedError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}

	private async updateAvatar(req: Request<{ id: string }>, res: Response<UpdateOperatorAvatarResponse | AvatarErrorResponse>): Promise<void> {
		if (!req.file) {
			res.status(400).json({ error: 'No avatar file provided' });
			return;
		}

		const result = await this.avatarsServer.updateOperatorAvatar(Number(req.params.id), { buffer: req.file.buffer, mimetype: req.file.mimetype });
		if (!result) {
			res.status(404).end();
			return;
		}
		res.json(result);
	}
}
