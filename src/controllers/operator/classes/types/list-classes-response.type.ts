import { ClassWithEnrolledCount } from '../../../../servers/types/classes.server.types';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListClassesResponse = PublicEntity<ClassWithEnrolledCount>[];
