import { Class } from '../../../../entities/class.entity';
import { PublicEntity } from '../../../../entities/base.entity';

// Used by endpoints that return a plain Class (update, stop, unstop) - unlike GetClassResponse, this deliberately
// omits enrolledCount, since these mutation endpoints don't need the extra class_enrollments query.
export type ClassMutationResponse = PublicEntity<Class>;
