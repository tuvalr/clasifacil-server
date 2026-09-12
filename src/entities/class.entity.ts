import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Class extends BaseEntity {
	operatorId: number;
	title: string;
	dayOfWeek: number;
	startTime: string;
	durationMinutes: number;
	minSize: number | null;
	maxSize: number;
	status: 'active' | 'paused';
	pausedUntil: Date | null;
}

export const ClassEntity: EntityDescriptor<Class> = {
	tableName: 'classes',
};
