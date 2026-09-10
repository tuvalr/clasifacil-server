import { Household } from '../../../../entities/household.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListHouseholdsResponse = PublicEntity<Household>[];
