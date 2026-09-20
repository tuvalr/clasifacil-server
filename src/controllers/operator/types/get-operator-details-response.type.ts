import { Operator } from '../../../entities/operator.entity';
import { Session } from '../../../entities/session.entity';
import { EnrollmentAndCredit } from '../../../entities/enrollment-and-credit.entity';
import { Student } from '../../../entities/student.entity';
import { Household } from '../../../entities/household.entity';
import { PublicEntity } from '../../../entities/base.entity';

export type GetOperatorDetailsResponse = PublicEntity<Operator> & {
	sessions: (PublicEntity<Session> & {
		enrollments: (PublicEntity<EnrollmentAndCredit> & {
			student: PublicEntity<Student> | null;
			household: PublicEntity<Household> | null;
		})[];
	})[];
};
