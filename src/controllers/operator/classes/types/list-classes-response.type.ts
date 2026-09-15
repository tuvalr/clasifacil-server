import { ClassWithEnrolledCount } from '../../../../servers/classes.server';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListClassesResponse = PublicEntity<ClassWithEnrolledCount>[];
