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

	public async listByOperatorId(operatorId: number): Promise<Class[] | null> {
		const operator = await this.operators.findById(operatorId);
		if (!operator) {
			return null;
		}
		return this.classes.findByOperatorId(operatorId);
	}

	public async findById(id: number): Promise<Class | null> {
		return this.classes.findById(id);
	}

	public async create(data: {
		operatorId?: unknown;
		title?: unknown;
		dayOfWeek?: unknown;
		startTime?: unknown;
		durationMinutes?: unknown;
		minSize?: unknown;
		maxSize?: unknown;
	}): Promise<Class> {
		const requiredDetails = this.validateRequired(data);
		if (requiredDetails.length > 0) {
			throw new ValidationError(requiredDetails);
		}
		// Narrowed by validateRequired above: every required field is confirmed present and of the correct type.
		const narrowed = data as { operatorId: number; title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize?: number; maxSize: number };

		const details = this.validate(narrowed);
		if (details.length > 0) {
			throw new ValidationError(details);
		}
		return this.classes.create({
			operatorId: narrowed.operatorId,
			title: narrowed.title,
			dayOfWeek: narrowed.dayOfWeek,
			startTime: narrowed.startTime,
			durationMinutes: narrowed.durationMinutes,
			minSize: narrowed.minSize ?? null,
			maxSize: narrowed.maxSize,
		});
	}

	public async update(
		id: number,
		data: Partial<{ title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number }>,
	): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		const merged = {
			dayOfWeek: data.dayOfWeek ?? existing.dayOfWeek,
			durationMinutes: data.durationMinutes ?? existing.durationMinutes,
			minSize: data.minSize === undefined ? existing.minSize : data.minSize,
			maxSize: data.maxSize ?? existing.maxSize,
		};
		const details = this.validate(merged);
		if (details.length > 0) {
			throw new ValidationError(details);
		}
		return this.classes.update(id, data);
	}

	// findById first — same reasoning as OperatorsServer.pause(): the repository's UPDATE has no is_deleted guard,
	// so without this check a soft-deleted class would still match and get silently paused/resumed instead of
	// 404ing like every other endpoint.
	public async pause(id: number, pausedUntil: Date | null): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.pause(id, pausedUntil);
	}

	public async resume(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.resume(id);
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
		if (foundClass.status === 'paused') {
			return { studentId, success: false, error: 'Class is paused' };
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
		}
		if (typeof data.durationMinutes !== 'number') {
			details.push({ field: 'durationMinutes', message: 'durationMinutes is required' });
		}
		if (typeof data.maxSize !== 'number') {
			details.push({ field: 'maxSize', message: 'maxSize is required' });
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
