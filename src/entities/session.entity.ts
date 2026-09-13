import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Session extends BaseEntity {
	operatorId: number;
	title: string;
	startTime: Date;
	capacityLimit: number;
	currentRosterCount: number | null;
	classId: number | null;
	isMakeupSession: boolean;
}

export const SessionEntity: EntityDescriptor<Session> = {
	tableName: 'sessions',
};
