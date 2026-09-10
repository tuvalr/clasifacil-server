import { Student } from '../../../../entities/student.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListOwnStudentsResponse = PublicEntity<Student>[];
