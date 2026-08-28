import { BaseEntity, EntityDescriptor } from './base.entity';

export interface User extends BaseEntity {
	authUid: string;
	email: string;
	role: string;
	associatedEntityId: number | null;
}

export const UserEntity: EntityDescriptor<User> = {
	tableName: 'users',
};
