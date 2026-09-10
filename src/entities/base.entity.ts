export interface BaseEntity {
	id: number;
	isDeleted: boolean;
	deletedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

// deletedAt/createdAt/updatedAt are DB-managed bookkeeping (soft-delete timestamp, row audit timestamps) — internal
// to the repository/entity layer, not something a client needs or should see. Every API response DTO should be
// built from this instead of the raw entity; see src/utils/to-public.ts for the runtime counterpart that actually
// strips them off a fetched row (this type alone only affects what TypeScript will let a handler send).
export type PublicEntity<T extends BaseEntity> = Omit<T, 'deletedAt' | 'createdAt' | 'updatedAt'>;

export interface EntityDescriptor<T extends BaseEntity> {
	tableName: string;
	// Phantom property: never assigned, exists only so T is anchored to
	// the descriptor and inferred at call sites like
	// postgresHandler.queryActive(UserEntity) instead of needing an
	// explicit <User> everywhere.
	readonly _rowType?: T;
}
