import { Session } from '../../entities/session.entity';
import { ValidationError } from './validation-error';

export const MAX_RANGE_DAYS = 90;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function parseDateOnly(value: unknown, field: string): Date {
	if (typeof value !== 'string' || value.length === 0) {
		throw new ValidationError([{ field, message: `${field} is required` }]);
	}
	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime())) {
		throw new ValidationError([{ field, message: `${field} must be a valid date (YYYY-MM-DD)` }]);
	}
	return parsed;
}

export function validateRange(from: Date, to: Date): void {
	if (to.getTime() < from.getTime()) {
		throw new ValidationError([{ field: 'to', message: 'to must not be before from' }]);
	}
	const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
	if (days > MAX_RANGE_DAYS) {
		throw new ValidationError([{ field: 'to', message: `Range cannot exceed ${MAX_RANGE_DAYS} days` }]);
	}
}

export interface OccurrenceAttendanceEntry {
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent' | 'not_recorded';
}

export interface VirtualOccurrence {
	classId: number;
	startTime: Date;
	isVirtual: true;
	displayTitle: string;
	displayEndTime: Date;
	attendance?: OccurrenceAttendanceEntry[];
}

export interface MaterializedOccurrence {
	session: Session;
	isVirtual: false;
	displayTitle: string;
	displayEndTime: Date;
	attendance?: OccurrenceAttendanceEntry[];
}

export type Occurrence = VirtualOccurrence | MaterializedOccurrence;

export interface OccurrenceListResult {
	occurrences: Occurrence[];
	classMemberStudentIds: number[];
}
