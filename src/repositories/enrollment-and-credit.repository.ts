import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { EnrollmentAndCredit, EnrollmentAndCreditEntity } from '../entities/enrollment-and-credit.entity';

@injectable()
export class EnrollmentAndCreditRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByHouseholdId(householdId: number): Promise<EnrollmentAndCredit[]> {
		return this.db.queryActive(EnrollmentAndCreditEntity, 'household_id = $1', [householdId]);
	}

	// 'booked' is the only status that means the household is currently connected to an operator via a session —
	// cancelled_with_credit/forfeited enrollments no longer hold a live booking.
	public async existsActiveBookingForHousehold(householdId: number): Promise<boolean> {
		const rows = await this.db.queryActive(EnrollmentAndCreditEntity, "household_id = $1 AND status = 'booked'", [householdId]);
		return rows.length > 0;
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
