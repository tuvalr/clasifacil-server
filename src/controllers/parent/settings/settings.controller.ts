import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { HouseholdsServer } from '../../../servers/households.server';
import { AvatarsServer } from '../../../servers/avatars.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { avatarUpload } from '../../shared/avatar-upload.middleware';
import { toPublic } from '../../../utils/to-public';
import { GetParentSettingsResponse } from './types/get-parent-settings-response.type';
import { UpdateParentSettingsBody } from './types/update-parent-settings-body.type';
import { UpdateParentSettingsResponse } from './types/update-parent-settings-response.type';
import { UpdateParentAvatarResponse } from './types/update-parent-avatar-response.type';
import { AvatarErrorResponse } from './types/avatar-error-response.type';

@injectable()
export class ParentSettingsController extends BaseController {
	public constructor(
		@inject(TYPES.HouseholdsServer) private readonly householdsServer: HouseholdsServer,
		@inject(TYPES.AvatarsServer) private readonly avatarsServer: AvatarsServer,
	) {
		super();

		/**
		 * @openapi
		 * /api/parent/settings/{id}:
		 *   get:
		 *     summary: Get own settings
		 *     tags: [Parent - Settings]
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
		 *             schema: { $ref: '#/components/schemas/Household' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getSettings.bind(this)));

		/**
		 * @openapi
		 * /api/parent/settings/{id}:
		 *   put:
		 *     summary: Update own settings
		 *     tags: [Parent - Settings]
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
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Household' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id', RouteHandlers.wrap(this.updateSettings.bind(this)));

		/**
		 * @openapi
		 * /api/parent/settings/{id}/avatar:
		 *   put:
		 *     summary: Upload own avatar photo
		 *     description: Accepts a JPEG or PNG image up to 2MB as multipart/form-data, field name "avatar".
		 *     tags: [Parent - Settings]
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

	private async getSettings(req: Request<{ id: string }>, res: Response<GetParentSettingsResponse>): Promise<void> {
		const household = await this.householdsServer.getById(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}

	private async updateSettings(req: Request<{ id: string }, UpdateParentSettingsResponse, UpdateParentSettingsBody>, res: Response<UpdateParentSettingsResponse>): Promise<void> {
		const { name, email } = req.body;
		const household = await this.householdsServer.update(Number(req.params.id), { name, email });
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}

	private async updateAvatar(req: Request<{ id: string }>, res: Response<UpdateParentAvatarResponse | AvatarErrorResponse>): Promise<void> {
		if (!req.file) {
			res.status(400).json({ error: 'No avatar file provided' });
			return;
		}

		const result = await this.avatarsServer.updateParentAvatar(Number(req.params.id), { buffer: req.file.buffer, mimetype: req.file.mimetype });
		if (!result) {
			res.status(404).end();
			return;
		}
		res.json(result);
	}
}
