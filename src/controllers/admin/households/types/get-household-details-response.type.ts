import { Household } from '../../../../entities/household.entity';
import { Student } from '../../../../entities/student.entity';
import { EnrollmentAndCredit } from '../../../../entities/enrollment-and-credit.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type GetHouseholdDetailsResponse = PublicEntity<Household> & {
	students: (PublicEntity<Student> & { enrollments: PublicEntity<EnrollmentAndCredit>[] })[];
};
