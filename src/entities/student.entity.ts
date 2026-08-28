import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Student extends BaseEntity {
	householdId: number;
	fullName: string;
	dateOfBirth: Date | null;
	notes: string | null;
}

export const StudentEntity: EntityDescriptor<Student> = {
	tableName: 'students',
};
