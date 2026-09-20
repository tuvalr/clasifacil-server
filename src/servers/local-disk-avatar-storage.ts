import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { injectable } from 'inversify';
import { AvatarStorage } from './types/avatar-storage';
import { AVATARS_DIR, AVATARS_URL_PREFIX } from './types/local-disk-avatar-storage.types';

// Stand-in for a cloud object store (e.g. S3) until one is actually provisioned. Saves under <repo>/uploads/avatars and
// returns a URL served by express.static (see App.middleware) - swap this class for a cloud-backed AvatarStorage
// implementation later; AvatarsServer and every controller stay unchanged.

@injectable()
export class LocalDiskAvatarStorage implements AvatarStorage {
	public async save(role: 'household' | 'operator', id: number, buffer: Buffer, extension: string): Promise<string> {
		await fs.mkdir(AVATARS_DIR, { recursive: true });
		const fileName = `${role}-${id}-${randomUUID()}.${extension}`;
		await fs.writeFile(path.join(AVATARS_DIR, fileName), buffer);
		return `${AVATARS_URL_PREFIX}/${fileName}`;
	}

	public async delete(url: string): Promise<void> {
		const fileName = path.basename(url);
		await fs.rm(path.join(AVATARS_DIR, fileName), { force: true });
	}
}
