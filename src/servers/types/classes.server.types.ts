import { Class } from '../../entities/class.entity';
import { ClassEnrollment } from '../../entities/class-enrollment.entity';

export const MAX_DAY_OF_WEEK = 6;

// Matches Postgres TIME's accepted 24-hour formats reasonably strictly (HH:MM or HH:MM:SS), rejecting inputs like
// "banana" or "25:00:00" at the application layer instead of letting Postgres reject them raw (a raw 500 instead
// of a clean 400) - see ClassesServer.validateRequired/validate's startTime checks below.
export const START_TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

// Runtime type guard for the assign/unassign-students request body's studentIds: it arrives as untyped JSON, so
// the `number[]` signature on ClassesServer's methods only guards call sites within this codebase, not an actual
// HTTP request. Without this check, a missing/malformed studentIds (undefined, a single number, a string, etc.)
// would reach a `for...of` loop and throw a raw TypeError, forwarded by the route wrapper to the generic error
// handler as a 500 instead of a clean 400 - the same gotcha OperatorsServer.validateCreate and
// ClassesServer.validateRequired work around elsewhere.
export function isNumberArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item: unknown): boolean => typeof item === 'number');
}

function startTimeToMinutes(startTime: string): number {
	const [hours, minutes]: number[] = startTime.split(':').map(Number);
	return hours * 60 + minutes;
}

// True if two classes on the same dayOfWeek would have a student physically in both at once - a straight
// interval-overlap check (a.start < b.end && b.start < a.end) on each class's local wall-clock [start, start +
// duration) window. Different dayOfWeek never overlaps, regardless of time. Both classes' startTime/durationMinutes
// are always the same operator's local wall-clock values when they share an operator, but this check is also used
// across different operators (a student isn't scoped to one) - comparing local wall-clock times across operators in
// different timezones is a known simplification (see ClassesServer.hasScheduleConflict), acceptable because this
// project's operators are all assumed to be in the same market/timezone today.
export function classesOverlap(a: { dayOfWeek: number; startTime: string; durationMinutes: number }, b: { dayOfWeek: number; startTime: string; durationMinutes: number }): boolean {
	if (a.dayOfWeek !== b.dayOfWeek) {
		return false;
	}
	const aStart = startTimeToMinutes(a.startTime);
	const aEnd = aStart + a.durationMinutes;
	const bStart = startTimeToMinutes(b.startTime);
	const bEnd = bStart + b.durationMinutes;
	return aStart < bEnd && bStart < aEnd;
}

export class ClassHasActiveEnrollmentsError extends Error {
	public constructor() {
		super('Cannot delete a class with active student enrollments');
		this.name = 'ClassHasActiveEnrollmentsError';
	}
}

export class ClassMaxSizeBelowEnrolledCountError extends Error {
	public constructor() {
		super('The maximum class size cannot be lower than the number of students currently assigned to this class');
		this.name = 'ClassMaxSizeBelowEnrolledCountError';
	}
}

export class StudentScheduleConflictError extends Error {
	public constructor() {
		super('This student is already enrolled in another class at an overlapping time');
		this.name = 'StudentScheduleConflictError';
	}
}

export interface AssignStudentSuccess {
	studentId: number;
	success: true;
	enrollment: ClassEnrollment;
}

export interface AssignStudentFailure {
	studentId: number;
	success: false;
	error: string;
}

export type AssignStudentResult = AssignStudentSuccess | AssignStudentFailure;

export interface ClassWithEnrolledCount extends Class {
	enrolledCount: number;
}
