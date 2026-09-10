import { NextFunction, Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { AvatarsServer } from '../../servers/avatars.server';

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;

class UnsupportedAvatarTypeError extends Error {}

// memoryStorage() (not diskStorage) since AvatarsServer/AvatarStorage own where the bytes actually end up — this
// middleware only parses the multipart body and enforces size/type limits before the request reaches the controller.
const parseAvatarUpload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: MAX_AVATAR_SIZE_BYTES },
	fileFilter: (req: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
		if (!AvatarsServer.isSupportedMimeType(file.mimetype)) {
			callback(new UnsupportedAvatarTypeError('Unsupported file type: only JPEG and PNG images are allowed'));
			return;
		}
		callback(null, true);
	},
}).single('avatar');

// Shared by the household and operator settings controllers' avatar-upload routes. Wraps multer's callback-style
// middleware so its errors (file too large, unsupported type) become 400s instead of falling through to the generic
// 500 error handler, which is what next(err) would otherwise trigger for any unrecognized error.
export function avatarUpload(req: Request, res: Response, next: NextFunction): void {
	parseAvatarUpload(req, res, (err: unknown) => {
		if (err instanceof multer.MulterError || err instanceof UnsupportedAvatarTypeError) {
			res.status(400).json({ error: err.message });
			return;
		}
		if (err) {
			next(err);
			return;
		}
		next();
	});
}
