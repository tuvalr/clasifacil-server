import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Operator extends BaseEntity {
	name: string;
	email: string;
	phone: string;
	countryCode: string;
	stripeAccountId: string | null;
	onboardingStatus: string | null;
	status: 'active' | 'paused';
	pausedUntil: Date | null;
	avatarUrl: string | null;
	type: 'schedule' | 'assigned';
}

export const OperatorEntity: EntityDescriptor<Operator> = {
	tableName: 'operators',
};
