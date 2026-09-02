import { Operator } from '../../../entities/operator.entity';
import { User } from '../../../entities/user.entity';

export interface CreateOperatorResponse {
	operator: Operator;
	user: User;
}
