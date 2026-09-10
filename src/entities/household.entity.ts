import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Household extends BaseEntity {
	name: string;
	email: string;
	avatarUrl: string | null;
}

export const HouseholdEntity: EntityDescriptor<Household> = {
	tableName: 'households',
};
