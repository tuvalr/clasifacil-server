import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Household extends BaseEntity {
	name: string;
	email: string;
}

export const HouseholdEntity: EntityDescriptor<Household> = {
	tableName: 'households',
};
