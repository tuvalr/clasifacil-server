import { BaseEntity, EntityDescriptor } from './base.entity';

export interface EnrollmentAndCredit extends BaseEntity {
	studentId: number;
	sessionId: number | null;
	householdId: number;
	status: string;
	creditTokenExpiry: Date | null;
}

export const EnrollmentAndCreditEntity: EntityDescriptor<EnrollmentAndCredit> = {
	tableName: 'enrollments_and_credits',
};
