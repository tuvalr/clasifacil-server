export interface BaseEntity {
	id: number;
	isDeleted: boolean;
	deletedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface EntityDescriptor<T extends BaseEntity> {
	tableName: string;
	// Phantom property: never assigned, exists only so T is anchored to
	// the descriptor and inferred at call sites like
	// postgresHandler.queryActive(UserEntity) instead of needing an
	// explicit <User> everywhere.
	readonly _rowType?: T;
}
