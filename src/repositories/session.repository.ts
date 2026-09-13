import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { Session, SessionEntity } from '../entities/session.entity';

@injectable()
export class SessionRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByOperatorId(operatorId: number): Promise<Session[]> {
		return this.db.queryActive(SessionEntity, 'operator_id = $1', [operatorId]);
	}

	// Future, non-makeup occurrences only — used by ClassesServer.update's optional rename-related-sessions flag,
	// which is meant to propagate a class's new title to its still-upcoming generated occurrences, not to rewrite
	// history (past sessions) or one-off makeup sessions (whose title was set independently at creation).
	public async findFutureNonMakeupByClassId(classId: number): Promise<Session[]> {
		return this.db.queryActive(SessionEntity, 'class_id = $1 AND is_makeup_session = FALSE AND start_time >= NOW()', [classId]);
	}

	public async findById(id: number): Promise<Session | null> {
		return this.db.findById(SessionEntity, id);
	}

	public async create(data: { operatorId: number; title: string | null; startTime: Date; capacityLimit: number; classId?: number | null; isMakeupSession?: boolean }): Promise<Session> {
		return this.db.insert(SessionEntity, { ...data, classId: data.classId ?? null, isMakeupSession: data.isMakeupSession ?? false, currentRosterCount: 0, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ title: string; startTime: Date; capacityLimit: number }>): Promise<Session | null> {
		return this.db.update(SessionEntity, id, data);
	}

	public async cancel(id: number): Promise<void> {
		return this.db.delete(SessionEntity, id);
	}

	// Uses a raw query rather than PostgresHandler.update(): the PRD (UC2)
	// requires this increment to be part of an atomic, row-locked
	// transaction (SELECT ... FOR UPDATE) to prevent two simultaneous
	// bookings from both reading a stale roster count. That transaction
	// support doesn't exist on PostgresHandler yet — see the booking
	// controller's TODO for the real atomic implementation.
	public async incrementRosterCount(id: number): Promise<void> {
		await this.db.query('UPDATE "sessions" SET current_roster_count = current_roster_count + 1, updated_at = NOW() WHERE id = $1', [id]);
	}

	public async decrementRosterCount(id: number): Promise<void> {
		await this.db.query('UPDATE "sessions" SET current_roster_count = current_roster_count - 1, updated_at = NOW() WHERE id = $1', [id]);
	}
}
