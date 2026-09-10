import { Operator } from '../../../../entities/operator.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListOperatorsResponse = PublicEntity<Operator>[];
