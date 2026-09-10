import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { HouseholdsServer } from './households.server';
import { OperatorsServer } from './operators.server';
import { AvatarStorage } from './types/avatar-storage';

const MIME_EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
};

// Shared by both HouseholdSettingsController and OperatorSettingsController — the upload/validation/storage flow is
// identical for a household's and an operator's avatar, only the entity being updated differs.
@injectable()
export class AvatarsServer {
	public constructor(
		@inject(TYPES.AvatarStorage) private readonly storage: AvatarStorage,
		@inject(TYPES.HouseholdsServer) private readonly households: HouseholdsServer,
		@inject(TYPES.OperatorsServer) private readonly operators: OperatorsServer,
	) {}

	public static isSupportedMimeType(mimeType: string): boolean {
		return mimeType in MIME_EXTENSIONS;
	}

	public async updateHouseholdAvatar(householdId: number, file: { buffer: Buffer; mimetype: string }): Promise<{ avatarUrl: string } | null> {
		const existing = await this.households.getById(householdId);
		if (!existing) {
			return null;
		}

		const avatarUrl = await this.storage.save('household', householdId, file.buffer, MIME_EXTENSIONS[file.mimetype]);
		await this.households.updateAvatarUrl(householdId, avatarUrl);

		if (existing.avatarUrl) {
			await this.storage.delete(existing.avatarUrl);
		}

		return { avatarUrl };
	}

	public async updateOperatorAvatar(operatorId: number, file: { buffer: Buffer; mimetype: string }): Promise<{ avatarUrl: string } | null> {
		const existing = await this.operators.findById(operatorId);
		if (!existing) {
			return null;
		}

		const avatarUrl = await this.storage.save('operator', operatorId, file.buffer, MIME_EXTENSIONS[file.mimetype]);
		await this.operators.updateAvatarUrl(operatorId, avatarUrl);

		if (existing.avatarUrl) {
			await this.storage.delete(existing.avatarUrl);
		}

		return { avatarUrl };
	}
}
