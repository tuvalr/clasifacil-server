import { BaseEntity, PublicEntity } from '../entities/base.entity';

// Strips the DB-managed bookkeeping fields (deletedAt/createdAt/updatedAt) off an entity before it reaches a
// response - the type-level PublicEntity<T> only stops a handler from statically declaring these fields on its
// response DTO; this is what actually removes them from the object being serialized.
export function toPublic<T extends BaseEntity>(entity: T): PublicEntity<T> {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to exclude them from `rest`
	const { deletedAt, createdAt, updatedAt, ...rest } = entity;
	return rest;
}
