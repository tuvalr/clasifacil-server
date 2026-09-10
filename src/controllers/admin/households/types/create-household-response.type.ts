import { Household } from '../../../../entities/household.entity';
import { User } from '../../../../entities/user.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export interface CreateHouseholdResponse {
	household: PublicEntity<Household>;
	user: PublicEntity<User>;
}
