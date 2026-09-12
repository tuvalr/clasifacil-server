import { EnrollmentAndCredit } from '../../../../entities/enrollment-and-credit.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export interface GetSessionRosterResponse {
	enrollments: PublicEntity<EnrollmentAndCredit>[];
	classMemberStudentIds: number[];
}
