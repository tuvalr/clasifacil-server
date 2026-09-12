import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { Class } from '../entities/class.entity';
import { ValidationError, ValidationErrorDetail } from './types/validation-error';

const MAX_DAY_OF_WEEK = 6;

export class ClassHasActiveEnrollmentsError extends Error {
	public constructor() {
		super('Cannot delete a class with active student enrollments');
		this.name = 'ClassHasActiveEnrollmentsError';
	}
}

// UC-Scheduling: recurring weekly classes (schedule-type operators) and recurring 1:1 slots (assigned-type
// operators) share this same table — see docs/superpowers/specs/2026-09-12-operator-scheduling-design.md.
@injectable()
export class ClassesServer {
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
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
		if (await this.classes.existsActiveEnrollments(id)) {
			throw new ClassHasActiveEnrollmentsError();
		}
		await this.classes.archive(id);
		return existing;
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
