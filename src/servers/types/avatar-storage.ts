// Storage backend for avatar image bytes, kept behind this interface so the local-disk implementation used today
// (LocalDiskAvatarStorage) can be swapped for a cloud implementation (e.g. S3) later with no changes to AvatarsServer
// or its callers — only a new class + a DI rebinding in inversify.config.ts.
export interface AvatarStorage {
	// role/id namespace the key so parent and operator avatars never collide; extension is derived from the upload's mime type.
	save(role: 'parent' | 'operator', id: number, buffer: Buffer, extension: string): Promise<string>;

	// Accepts the URL previously returned by save() and removes the backing file. Best-effort: callers should not fail
	// the request if this fails (e.g. the old file was already removed out-of-band).
	delete(url: string): Promise<void>;
}
