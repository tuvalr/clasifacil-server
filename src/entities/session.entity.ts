import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Session extends BaseEntity {
	operatorId: number;
	title: string | null;
	startTime: Date;
	capacityLimit: number;
	currentRosterCount: number | null;
	classId: number | null;
	// A plain 'YYYY-MM-DD' calendar day, not a Date — see postgres-handler.ts's DATE (OID 1082) type parser.
	originalDate: string | null;
	isMakeupSession: boolean;
}

export const SessionEntity: EntityDescriptor<Session> = {
	tableName: 'sessions',
};
