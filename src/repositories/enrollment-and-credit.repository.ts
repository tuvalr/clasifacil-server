import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../services/postgres-handler';
import { EnrollmentAndCredit, EnrollmentAndCreditEntity } from '../entities/enrollment-and-credit.entity';

@injectable()
export class EnrollmentAndCreditRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByHouseholdId(householdId: number): Promise<EnrollmentAndCredit[]> {
		return this.db.queryActive(EnrollmentAndCreditEntity, 'household_id = $1', [householdId]);
	}

	public async findBySessionId(sessionId: number): Promise<EnrollmentAndCredit[]> {
		return this.db.queryActive(EnrollmentAndCreditEntity, 'session_id = $1', [sessionId]);
	}

	public async findById(id: number): Promise<EnrollmentAndCredit | null> {
		return this.db.findById(EnrollmentAndCreditEntity, id);
	}

	public async create(data: { studentId: number; sessionId: number | null; householdId: number; status: string }): Promise<EnrollmentAndCredit> {
		return this.db.insert(EnrollmentAndCreditEntity, { ...data, isDeleted: false });
	}

	public async updateStatus(id: number, status: string, creditTokenExpiry: Date | null): Promise<EnrollmentAndCredit | null> {
		return this.db.update(EnrollmentAndCreditEntity, id, { status, creditTokenExpiry });
	}
}
