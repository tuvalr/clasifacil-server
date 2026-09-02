import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Operator extends BaseEntity {
	name: string;
	email: string;
	phone: string;
	countryCode: string;
	stripeAccountId: string | null;
	onboardingStatus: string | null;
}

export const OperatorEntity: EntityDescriptor<Operator> = {
	tableName: 'operators',
};
