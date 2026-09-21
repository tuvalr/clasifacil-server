import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';
import { StudentRepository } from '../repositories/student.repository';
import { Class } from '../entities/class.entity';
import { ValidationError, ValidationErrorDetail } from './types/validation-error';
import { ClassHasActiveEnrollmentsError, ClassMaxSizeBelowEnrolledCountError, AssignStudentResult, ClassWithEnrolledCount, MAX_DAY_OF_WEEK, START_TIME_FORMAT, isNumberArray } from './types/classes.server.types';

// UC-Scheduling: recurring weekly classes (schedule-type operators) and recurring 1:1 slots (assigned-type
// operators) share this same table - see docs/superpowers/specs/2026-09-12-operator-scheduling-design.md.
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

	// Counts active class_enrollments per class - applies uniformly to schedule-type (many students) and
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

	public async create(data: { operatorId?: unknown; title?: unknown; dayOfWeek?: unknown; startTime?: unknown; durationMinutes?: unknown; minSize?: unknown; maxSize?: unknown; studentId?: unknown; color?: unknown }): Promise<Class> {
		const requiredDetails = this.validateRequired(data);
		if (requiredDetails.length > 0) {
			throw new ValidationError(requiredDetails);
		}
		// studentId is optional at the type level (only required for assigned-type operators, checked below), but if
		// it's present it must actually be a number - same "don't let untyped JSON garbage sail through" reasoning as
		// validateRequired's other fields; a non-number studentId would otherwise reach classEnrollments.create and
		// fail as a raw 500 instead of a clean 400.
		if (data.studentId !== undefined && typeof data.studentId !== 'number') {
			throw new ValidationError([{ field: 'studentId', message: 'Student must be a valid selection' }]);
		}
		// color is optional and unenforced in format - but if present it must be a string or null, same reasoning as
		// studentId above.
		if (data.color !== undefined && data.color !== null && typeof data.color !== 'string') {
			throw new ValidationError([{ field: 'color', message: 'Color must be valid text or left empty' }]);
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
				throw new ValidationError([{ field: 'studentId', message: 'A student is required for assigned-type operators' }]);
			}
			if (narrowed.maxSize !== 1) {
				throw new ValidationError([{ field: 'maxSize', message: 'Must be 1 for assigned-type operators' }]);
			}
			student = await this.students.findById(narrowed.studentId);
			if (!student) {
				throw new ValidationError([{ field: 'studentId', message: 'Student not found' }]);
			}
		} else if (narrowed.studentId != null) {
			throw new ValidationError([{ field: 'studentId', message: 'A student can only be provided for assigned-type operators - use assign-students instead' }]);
		}

		const details = this.validate(narrowed);
		details.push(...(await this.validateTitle(narrowed.operatorId, narrowed.title, null)));
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
		if (narrowed.title !== undefined) {
			details.push(...(await this.validateTitle(existing.operatorId, narrowed.title, id)));
		}
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		// Shrinking maxSize below the number of students already assigned would silently strand the excess roster
		// (still enrolled, but over the new cap) - reject the whole update instead, matching delete's
		// ClassHasActiveEnrollmentsError precedent of refusing rather than leaving inconsistent enrollment state.
		if (narrowed.maxSize !== undefined && narrowed.maxSize < existing.maxSize) {
			const activeCount = await this.classEnrollments.countActiveByClassId(id);
			if (narrowed.maxSize < activeCount) {
				throw new ClassMaxSizeBelowEnrolledCountError();
			}
		}

		return this.classes.update(id, narrowed);
	}

	// findById first - same reasoning as OperatorsServer.pause(): the repository's UPDATE has no is_deleted guard,
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
		// assigned-type: the single class_enrollments row is intrinsic to the slot, not a separate precondition -
		// deletes directly. schedule-type: refuse while any active enrollments exist (the guard this method exists for).
		if (operator?.type === 'schedule' && (await this.classEnrollments.countActiveByClassId(id)) > 0) {
			throw new ClassHasActiveEnrollmentsError();
		}
		await this.classes.archive(id);
		return existing;
	}

	// Each studentId is evaluated independently and in array order - partial success across the batch, matching
	// the spec's bulk semantics (one bad item doesn't roll back the others). max_size is checked against the
	// current active count as of each item's turn, so submitting more students than remaining capacity fills the
	// slots in submission order and 409s the rest.
	public async assignStudents(classId: number, studentIds: unknown): Promise<AssignStudentResult[]> {
		if (!isNumberArray(studentIds)) {
			throw new ValidationError([{ field: 'studentIds', message: 'Please provide a valid list of students' }]);
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
			return { studentId, success: false, error: `Class is at its maximum size of ${foundClass.maxSize} students` };
		}

		const enrollment = existing ? await this.classEnrollments.setStatus(existing.id, 'active') : await this.classEnrollments.create(foundClass.id, studentId);
		return { studentId, success: true, enrollment };
	}

	public async unassignStudents(classId: number, studentIds: unknown): Promise<void> {
		if (!isNumberArray(studentIds)) {
			throw new ValidationError([{ field: 'studentIds', message: 'Please provide a valid list of students' }]);
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
	// call sites within this codebase - a request body is untyped JSON, so a caller omitting e.g. dayOfWeek
	// arrives here as `undefined`. Without this check, `undefined` sails through validate()'s numeric bounds
	// (`undefined < 0` and `undefined > 6` are both false) and camelToSnake silently drops undefined keys before
	// the INSERT, producing a raw NOT NULL constraint violation (500) instead of a clean 400 - the same gotcha
	// OperatorsServer.validateCreate works around for `type`.
	private validateRequired(data: { operatorId?: unknown; title?: unknown; dayOfWeek?: unknown; startTime?: unknown; durationMinutes?: unknown; maxSize?: unknown }): ValidationErrorDetail[] {
		const details: ValidationErrorDetail[] = [];
		if (typeof data.operatorId !== 'number') {
			details.push({ field: 'operatorId', message: 'Operator is required' });
		}
		if (typeof data.title !== 'string' || data.title.length === 0) {
			details.push({ field: 'title', message: 'Title is required' });
		}
		if (typeof data.dayOfWeek !== 'number') {
			details.push({ field: 'dayOfWeek', message: 'Day of week is required' });
		}
		if (typeof data.startTime !== 'string' || data.startTime.length === 0) {
			details.push({ field: 'startTime', message: 'Start time is required' });
		} else if (!START_TIME_FORMAT.test(data.startTime)) {
			details.push({ field: 'startTime', message: 'Start time must be a valid 24-hour time in HH:MM or HH:MM:SS format' });
		}
		if (typeof data.durationMinutes !== 'number') {
			details.push({ field: 'durationMinutes', message: 'Duration is required' });
		}
		if (typeof data.maxSize !== 'number') {
			details.push({ field: 'maxSize', message: 'Maximum class size is required' });
		}
		return details;
	}

	// Runtime type-guard for update()'s partial-update fields: unlike create(), update() merges each present field
	// into `merged` and only bounds-checks the result via validate() - a wrong-TYPE value (e.g. maxSize: "abc")
	// passes those bounds checks (`"abc" < 1` is false in JS) and would otherwise reach the database update,
	// likely as a raw 500 instead of a clean 400. Only fields that are actually present (not undefined) are
	// checked - omitted fields fall back to the existing class's value in update()'s `merged` object.
	private validateUpdateTypes(data: { title?: unknown; dayOfWeek?: unknown; startTime?: unknown; durationMinutes?: unknown; minSize?: unknown; maxSize?: unknown; color?: unknown }): ValidationErrorDetail[] {
		const details: ValidationErrorDetail[] = [];
		if (data.title !== undefined && typeof data.title !== 'string') {
			details.push({ field: 'title', message: 'Title must be text' });
		}
		if (data.dayOfWeek !== undefined && typeof data.dayOfWeek !== 'number') {
			details.push({ field: 'dayOfWeek', message: 'Day of week must be a valid number' });
		}
		if (data.startTime !== undefined) {
			if (typeof data.startTime !== 'string' || !START_TIME_FORMAT.test(data.startTime)) {
				details.push({ field: 'startTime', message: 'Start time must be a valid 24-hour time in HH:MM or HH:MM:SS format' });
			}
		}
		if (data.durationMinutes !== undefined && typeof data.durationMinutes !== 'number') {
			details.push({ field: 'durationMinutes', message: 'Duration must be a valid number' });
		}
		if (data.minSize !== undefined && data.minSize !== null && typeof data.minSize !== 'number') {
			details.push({ field: 'minSize', message: 'Minimum class size must be a valid number or left empty' });
		}
		if (data.maxSize !== undefined && typeof data.maxSize !== 'number') {
			details.push({ field: 'maxSize', message: 'Maximum class size must be a valid number' });
		}
		if (data.color !== undefined && data.color !== null && typeof data.color !== 'string') {
			details.push({ field: 'color', message: 'Color must be valid text or left empty' });
		}
		return details;
	}

	// excludeId: a re-fetched match is this class's own current row (title unchanged) rather than a genuine
	// collision - pass the class's own id on update so it doesn't flag against itself; null on create, where no
	// such row can exist yet. Same excludeId pattern as OperatorsServer.validateName/validateEmail.
	private async validateTitle(operatorId: number, title: string, excludeId: number | null): Promise<ValidationErrorDetail[]> {
		const existing = await this.classes.findByOperatorIdAndTitle(operatorId, title);
		if (existing && existing.id !== excludeId) {
			return [{ field: 'title', message: 'This operator already has a class with this title' }];
		}
		return [];
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
			details.push({ field: 'minSize', message: 'The minimum class size must not be greater than the maximum class size' });
		}
		return details;
	}
}
