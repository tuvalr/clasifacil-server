import path from 'path';

export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');
export const AVATARS_DIR = path.join(UPLOADS_ROOT, 'avatars');
export const AVATARS_URL_PREFIX = '/uploads/avatars';
