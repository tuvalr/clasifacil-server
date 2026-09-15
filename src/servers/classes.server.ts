import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';
import { StudentRepository } from '../repositories/student.repository';
import { Class } from '../entities/class.entity';
import { ClassEnrollment } from '../entities/class-enrollment.entity';
import { ValidationError, ValidationErrorDetail } from './types/validation-error';

const MAX_DAY_OF_WEEK = 6;

// Matches Postgres TIME's accepted 24-hour formats reasonably strictly (HH:MM or HH:MM:SS), rejecting inputs like
// "banana" or "25:00:00" at the application layer instead of letting Postgres reject them raw (a raw 500 instead
// of a clean 400) — see ClassesServer.validateRequired/validate's startTime checks below.
const START_TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class ClassHasActiveEnrollmentsError extends Error {
	public constructor() {
		super('Cannot delete a class with active student enrollments');
		this.name = 'ClassHasActiveEnrollmentsError';
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

// Runtime type guard for the assign/unassign-students request body's studentIds: it arrives as untyped JSON, so
// the `number[]` signature on ClassesServer's methods only guards call sites within this codebase, not an actual
// HTTP request. Without this check, a missing/malformed studentIds (undefined, a single number, a string, etc.)
// would reach a `for...of` loop and throw a raw TypeError, forwarded by RouteHandlers.wrap to the generic error
// handler as a 500 instead of a clean 400 — the same gotcha OperatorsServer.validateCreate and
// ClassesServer.validateRequired work around elsewhere.
function isNumberArray(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((item: unknown): boolean => typeof item === 'number');
}

// UC-Scheduling: recurring weekly classes (schedule-type operators) and recurring 1:1 slots (assigned-type
// operators) share this same table — see docs/superpowers/specs/2026-09-12-operator-scheduling-design.md.
@injectable()
export class ClassesServer {
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,
		@inject(TYPES.StudentRepository) private readonly students: StudentRepository,
	) {}

	public async listByOperatorId(operatorId: number): Promise<ClassWithEnrolledCount[] | null> {
		const operator = await this.operators.findById(operatorId);
		if (!operator) {
			return null;
		}
		const found = await this.classes.findByOperatorId(operatorId);
		return this.withEnrolledCounts(found);
	}

	public async findById(id: number): Promise<ClassWithEnrolledCount | null> {
		const foundClass = await this.classes.findById(id);
		if (!foundClass) {
			return null;
		}
		const withCounts: ClassWithEnrolledCount[] = await this.withEnrolledCounts([foundClass]);
		return withCounts[0];
	}

	// Counts active class_enrollments per class — applies uniformly to schedule-type (many students) and
	// assigned-type (single student, also enrolled via class_enrollments at creation) classes alike. Sequential,
	// matching this file's existing style for similarly-bounded per-item operations (one operator's class list).
	private async withEnrolledCounts(found: Class[]): Promise<ClassWithEnrolledCount[]> {
		const results: ClassWithEnrolledCount[] = [];
		for (const foundClass of found) {
			const enrolledCount = await this.classEnrollments.countActiveByClassId(foundClass.id);
			results.push({ ...foundClass, enrolledCount });
		}
		return results;
	}

	public async create(data: {
		operatorId?: unknown;
		title?: unknown;
		dayOfWeek?: unknown;
		startTime?: unknown;
		durationMinutes?: unknown;
		minSize?: unknown;
		maxSize?: unknown;
		studentId?: unknown;
		color?: unknown;
	}): Promise<Class> {
		const requiredDetails = this.validateRequired(data);
		if (requiredDetails.length > 0) {
			throw new ValidationError(requiredDetails);
		}
		// studentId is optional at the type level (only required for assigned-type operators, checked below), but if
		// it's present it must actually be a number — same "don't let untyped JSON garbage sail through" reasoning as
		// validateRequired's other fields; a non-number studentId would otherwise reach classEnrollments.create and
		// fail as a raw 500 instead of a clean 400.
		if (data.studentId !== undefined && typeof data.studentId !== 'number') {
			throw new ValidationError([{ field: 'studentId', message: 'studentId must be a number' }]);
		}
		// color is optional and unenforced in format — but if present it must be a string or null, same reasoning as
		// studentId above.
		if (data.color !== undefined && data.color !== null && typeof data.color !== 'string') {
			throw new ValidationError([{ field: 'color', message: 'color must be a string or null' }]);
		}
		// Narrowed by validateRequired and the studentId/color checks above: every required field is confirmed
		// present and of the correct type, and studentId/color (if present) are of the correct type.
		const narrowed = data as {
			operatorId: number;
			title: string;
			dayOfWeek: number;
			startTime: string;
			durationMinutes: number;
			minSize?: number;
			maxSize: number;
			studentId?: number;
			color?: string | null;
		};

		const operator = await this.operators.findById(narrowed.operatorId);
		if (!operator) {
			throw new ValidationError([{ field: 'operatorId', message: 'Operator not found' }]);
		}

		// assigned-type operators (padel instructors, personal trainers) create a recurring 1:1 slot in one atomic
		// step: studentId is required and maxSize must be exactly 1, since assigned-type classes can't use
		// assign-students/unassign-students afterward (see ClassesServer.assignStudents/unassignStudents' guard).
		// schedule-type operators use the separate assign-students endpoint instead, so studentId is forbidden here.
		let student = null;
		if (operator.type === 'assigned') {
			if (narrowed.studentId == null) {
				throw new ValidationError([{ field: 'studentId', message: 'studentId is required for assigned-type operators' }]);
			}
			if (narrowed.maxSize !== 1) {
				throw new ValidationError([{ field: 'maxSize', message: 'Must be 1 for assigned-type operators' }]);
			}
			student = await this.students.findById(narrowed.studentId);
			if (!student) {
				throw new ValidationError([{ field: 'studentId', message: 'Student not found' }]);
			}
		} else if (narrowed.studentId != null) {
			throw new ValidationError([{ field: 'studentId', message: 'studentId is only accepted for assigned-type operators — use assign-students instead' }]);
		}

		const details = this.validate(narrowed);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		const created = await this.classes.create({
			operatorId: narrowed.operatorId,
			title: narrowed.title,
			dayOfWeek: narrowed.dayOfWeek,
			startTime: narrowed.startTime,
			durationMinutes: narrowed.durationMinutes,
			minSize: narrowed.minSize ?? null,
			maxSize: narrowed.maxSize,
			color: narrowed.color ?? null,
		});

		if (student) {
			await this.classEnrollments.create(created.id, student.id);
		}

		return created;
	}

	public async update(
		id: number,
		data: {
			title?: unknown;
			dayOfWeek?: unknown;
			startTime?: unknown;
			durationMinutes?: unknown;
			minSize?: unknown;
			maxSize?: unknown;
			color?: unknown;
		},
	): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}

		const typeDetails = this.validateUpdateTypes(data);
		if (typeDetails.length > 0) {
			throw new ValidationError(typeDetails);
		}
		const narrowed = data as Partial<{
			title: string;
			dayOfWeek: number;
			startTime: string;
			durationMinutes: number;
			minSize: number | null;
			maxSize: number;
			color: string | null;
		}>;

		const merged = {
			dayOfWeek: narrowed.dayOfWeek ?? existing.dayOfWeek,
			durationMinutes: narrowed.durationMinutes ?? existing.durationMinutes,
			minSize: narrowed.minSize === undefined ? existing.minSize : narrowed.minSize,
			maxSize: narrowed.maxSize ?? existing.maxSize,
		};
		const details = this.validate(merged);
		if (details.length > 0) {
			throw new ValidationError(details);
		}
		return this.classes.update(id, narrowed);
	}

	// findById first — same reasoning as OperatorsServer.pause(): the repository's UPDATE has no is_deleted guard,
	// so without this check a soft-deleted class would still match and get silently stopped/unstopped instead of
	// 404ing like every other endpoint. Reversible: unstop fully restores an active class, matching the spec's
	// explicit "allow reverting stoppedAt in case of mistake."
	public async stop(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.stop(id);
	}

	public async unstop(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.unstop(id);
	}

	public async delete(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		const operator = await this.operators.findById(existing.operatorId);
		// assigned-type: the single class_enrollments row is intrinsic to the slot, not a separate precondition —
		// deletes directly. schedule-type: refuse while any active enrollments exist (the guard this method exists for).
		if (operator?.type === 'schedule' && (await this.classEnrollments.countActiveByClassId(id)) > 0) {
			throw new ClassHasActiveEnrollmentsError();
		}
		await this.classes.archive(id);
		return existing;
	}

	// Each studentId is evaluated independently and in array order — partial success across the batch, matching
	// the spec's bulk semantics (one bad item doesn't roll back the others). max_size is checked against the
	// current active count as of each item's turn, so submitting more students than remaining capacity fills the
	// slots in submission order and 409s the rest.
	public async assignStudents(classId: number, studentIds: unknown): Promise<AssignStudentResult[]> {
		if (!isNumberArray(studentIds)) {
			throw new ValidationError([{ field: 'studentIds', message: 'studentIds must be an array of numbers' }]);
		}

		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}

		const operator = await this.operators.findById(foundClass.operatorId);
		if (operator?.type === 'assigned') {
			throw new ValidationError([{ field: 'operatorType', message: 'Cannot assign students to an assigned-type class. Students are assigned at class creation.' }]);
		}

		const results: AssignStudentResult[] = [];
		for (const studentId of studentIds) {
			// Intentionally sequential (not Promise.all): each iteration's capacity check depends on the previous iteration's insert.
			const result = await this.assignOneStudent(foundClass, studentId);
			results.push(result);
		}
		return results;
	}

	private async assignOneStudent(foundClass: Class, studentId: number): Promise<AssignStudentResult> {
		if (foundClass.status === 'stopped') {
			return { studentId, success: false, error: 'Class is stopped' };
		}

		const student = await this.students.findById(studentId);
		if (!student) {
			return { studentId, success: false, error: 'Student not found' };
		}

		const existing = await this.classEnrollments.findByClassIdAndStudentId(foundClass.id, studentId);
		if (existing && existing.status === 'active') {
			return { studentId, success: false, error: 'Student already assigned to this class' };
		}

		const activeCount = await this.classEnrollments.countActiveByClassId(foundClass.id);
		if (activeCount >= foundClass.maxSize) {
			return { studentId, success: false, error: 'Class is at maxSize' };
		}

		const enrollment = existing ? await this.classEnrollments.setStatus(existing.id, 'active') : await this.classEnrollments.create(foundClass.id, studentId);
		return { studentId, success: true, enrollment };
	}

	public async unassignStudents(classId: number, studentIds: unknown): Promise<void> {
		if (!isNumberArray(studentIds)) {
			throw new ValidationError([{ field: 'studentIds', message: 'studentIds must be an array of numbers' }]);
		}

		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}

		const operator = await this.operators.findById(foundClass.operatorId);
		if (operator?.type === 'assigned') {
			throw new ValidationError([{ field: 'operatorType', message: 'Cannot unassign students from an assigned-type class. Remove the class itself to remove its assignment.' }]);
		}

		// Small bulk operation, sequential is simplest and matches assignStudents' style.
		for (const studentId of studentIds) {
			const existing = await this.classEnrollments.findByClassIdAndStudentId(classId, studentId);
			if (existing && existing.status === 'active') {
				await this.classEnrollments.setStatus(existing.id, 'removed');
			}
		}
	}

	// Runtime-required check for create(): TypeScript's required fields on the create() signature only guard
	// call sites within this codebase — a request body is untyped JSON, so a caller omitting e.g. dayOfWeek
	// arrives here as `undefined`. Without this check, `undefined` sails through validate()'s numeric bounds
	// (`undefined < 0` and `undefined > 6` are both false) and camelToSnake silently drops undefined keys before
	// the INSERT, producing a raw NOT NULL constraint violation (500) instead of a clean 400 — the same gotcha
	// OperatorsServer.validateCreate works around for `type`.
	private validateRequired(data: {
		operatorId?: unknown;
		title?: unknown;
		dayOfWeek?: unknown;
		startTime?: unknown;
		durationMinutes?: unknown;
		maxSize?: unknown;
	}): ValidationErrorDetail[] {
		const details: ValidationErrorDetail[] = [];
		if (typeof data.operatorId !== 'number') {
			details.push({ field: 'operatorId', message: 'operatorId is required' });
		}
		if (typeof data.title !== 'string' || data.title.length === 0) {
			details.push({ field: 'title', message: 'title is required' });
		}
		if (typeof data.dayOfWeek !== 'number') {
			details.push({ field: 'dayOfWeek', message: 'dayOfWeek is required' });
		}
		if (typeof data.startTime !== 'string' || data.startTime.length === 0) {
			details.push({ field: 'startTime', message: 'startTime is required' });
		} else if (!START_TIME_FORMAT.test(data.startTime)) {
			details.push({ field: 'startTime', message: 'startTime must be a valid 24-hour time in HH:MM or HH:MM:SS format' });
		}
		if (typeof data.durationMinutes !== 'number') {
			details.push({ field: 'durationMinutes', message: 'durationMinutes is required' });
		}
		if (typeof data.maxSize !== 'number') {
			details.push({ field: 'maxSize', message: 'maxSize is required' });
		}
		return details;
	}

	// Runtime type-guard for update()'s partial-update fields: unlike create(), update() merges each present field
	// into `merged` and only bounds-checks the result via validate() — a wrong-TYPE value (e.g. maxSize: "abc")
	// passes those bounds checks (`"abc" < 1` is false in JS) and would otherwise reach the database update,
	// likely as a raw 500 instead of a clean 400. Only fields that are actually present (not undefined) are
	// checked — omitted fields fall back to the existing class's value in update()'s `merged` object.
	private validateUpdateTypes(data: {
		title?: unknown;
		dayOfWeek?: unknown;
		startTime?: unknown;
		durationMinutes?: unknown;
		minSize?: unknown;
		maxSize?: unknown;
		color?: unknown;
	}): ValidationErrorDetail[] {
		const details: ValidationErrorDetail[] = [];
		if (data.title !== undefined && typeof data.title !== 'string') {
			details.push({ field: 'title', message: 'title must be a string' });
		}
		if (data.dayOfWeek !== undefined && typeof data.dayOfWeek !== 'number') {
			details.push({ field: 'dayOfWeek', message: 'dayOfWeek must be a number' });
		}
		if (data.startTime !== undefined) {
			if (typeof data.startTime !== 'string' || !START_TIME_FORMAT.test(data.startTime)) {
				details.push({ field: 'startTime', message: 'startTime must be a valid 24-hour time in HH:MM or HH:MM:SS format' });
			}
		}
		if (data.durationMinutes !== undefined && typeof data.durationMinutes !== 'number') {
			details.push({ field: 'durationMinutes', message: 'durationMinutes must be a number' });
		}
		if (data.minSize !== undefined && data.minSize !== null && typeof data.minSize !== 'number') {
			details.push({ field: 'minSize', message: 'minSize must be a number or null' });
		}
		if (data.maxSize !== undefined && typeof data.maxSize !== 'number') {
			details.push({ field: 'maxSize', message: 'maxSize must be a number' });
		}
		if (data.color !== undefined && data.color !== null && typeof data.color !== 'string') {
			details.push({ field: 'color', message: 'color must be a string or null' });
		}
		return details;
	}

	private validate(data: { dayOfWeek: number; durationMinutes: number; minSize?: number | null; maxSize: number }): ValidationErrorDetail[] {
		const details: ValidationErrorDetail[] = [];
		if (data.dayOfWeek < 0 || data.dayOfWeek > MAX_DAY_OF_WEEK) {
			details.push({ field: 'dayOfWeek', message: 'Must be between 0 (Sunday) and 6 (Saturday)' });
		}
		if (data.durationMinutes <= 0) {
			details.push({ field: 'durationMinutes', message: 'Must be greater than 0' });
		}
		if (data.maxSize < 1) {
			details.push({ field: 'maxSize', message: 'Must be at least 1' });
		}
		if (data.minSize != null && data.minSize > data.maxSize) {
			details.push({ field: 'minSize', message: 'Must not be greater than maxSize' });
		}
		return details;
	}
}
