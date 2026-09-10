import { Operator } from '../../../../entities/operator.entity';
import { User } from '../../../../entities/user.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export interface CreateOperatorResponse {
	operator: PublicEntity<Operator>;
	user: PublicEntity<User>;
}
