import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { HouseholdsServer } from '../../../servers/households.server';
import { AvatarsServer } from '../../../servers/avatars.server';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { avatarUpload } from '../../shared/avatar-upload.middleware';
import { toPublic } from '../../../utils/to-public';
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { GetHouseholdSettingsResponse } from './types/get-household-settings-response.type';
import { UpdateHouseholdSettingsBody } from './types/update-household-settings-body.type';
import { UpdateHouseholdSettingsResponse } from './types/update-household-settings-response.type';
import { UpdateHouseholdAvatarResponse } from './types/update-household-avatar-response.type';

@injectable()
export class HouseholdSettingsController extends BaseController {
	public constructor(
		@inject(TYPES.HouseholdsServer) private readonly householdsServer: HouseholdsServer,
		@inject(TYPES.AvatarsServer) private readonly avatarsServer: AvatarsServer,
	) {
		super();

		/**
		 * @openapi
		 * /api/household/settings/{id}:
		 *   get:
		 *     summary: Get own settings
		 *     tags: [Household - Settings]
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
		this.internalRouter.get('/:id', RouteHandlers.wrapOneParam('id', this.getSettings.bind(this)));

		/**
		 * @openapi
		 * /api/household/settings/{id}:
		 *   put:
		 *     summary: Update own settings
		 *     tags: [Household - Settings]
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
		this.internalRouter.put('/:id', RouteHandlers.wrapOneParamBody('id', this.updateSettings.bind(this)));

		/**
		 * @openapi
		 * /api/household/settings/{id}/avatar:
		 *   put:
		 *     summary: Upload own avatar photo
		 *     description: Accepts a JPEG or PNG image up to 2MB as multipart/form-data, field name "avatar".
		 *     tags: [Household - Settings]
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
		this.internalRouter.put('/:id/avatar', avatarUpload, RouteHandlers.wrapOneParamFile('id', this.updateAvatar.bind(this)));
	}

	private async getSettings(id: string): Promise<Result<GetHouseholdSettingsResponse>> {
		const household = await this.householdsServer.getById(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}

	private async updateSettings(id: string, body: UpdateHouseholdSettingsBody): Promise<Result<UpdateHouseholdSettingsResponse>> {
		const { name, email } = body;
		const household = await this.householdsServer.update(Number(id), { name, email });
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}

	private async updateAvatar(id: string, file: Express.Multer.File | undefined): Promise<Result<UpdateHouseholdAvatarResponse>> {
		if (!file) {
			return Results.badRequest('No avatar file provided');
		}

		const result = await this.avatarsServer.updateHouseholdAvatar(Number(id), { buffer: file.buffer, mimetype: file.mimetype });
		if (!result) {
			return Results.notFound();
		}
		return Results.ok(result);
	}
}
