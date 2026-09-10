import { Student } from '../../../../entities/student.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListHouseholdStudentsResponse = PublicEntity<Student>[];
