import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Session extends BaseEntity {
	operatorId: number;
	title: string | null;
	startTime: Date;
	capacityLimit: number;
	currentRosterCount: number | null;
	classId: number | null;
	// A plain 'YYYY-MM-DD' calendar day, not a Date - see postgres-handler.ts's DATE (OID 1082) type parser.
	originalDate: string | null;
	isMakeupSession: boolean;
	// Copied from the class's durationMinutes at materialization time (or set directly for a makeup session) and
	// frozen from then on - a later change to the class's durationMinutes must not retroactively change a past or
	// already-materialized occurrence's end time. NULL for true one-off sessions (class_id IS NULL, not a makeup).
	durationMinutes: number | null;
}

export const SessionEntity: EntityDescriptor<Session> = {
	tableName: 'sessions',
};
