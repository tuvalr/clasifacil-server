import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { ClassEnrollment } from '../entities/class-enrollment.entity';
import { snakeToCamel } from '../utils/case-mapper';

@injectable()
export class ClassEnrollmentRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findActiveByClassId(classId: number): Promise<ClassEnrollment[]> {
		const rows = await this.db.query<Record<string, unknown>>("SELECT * FROM class_enrollments WHERE class_id = $1 AND status = 'active'", [classId]);
		return rows.map((row: Record<string, unknown>) => snakeToCamel<ClassEnrollment>(row));
	}

	public async countActiveByClassId(classId: number): Promise<number> {
		const rows = await this.db.query<{ count: string }>("SELECT COUNT(*) AS count FROM class_enrollments WHERE class_id = $1 AND status = 'active'", [classId]);
		return Number(rows[0]?.count ?? 0);
	}

	public async findByClassIdAndStudentId(classId: number, studentId: number): Promise<ClassEnrollment | null> {
		const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM class_enrollments WHERE class_id = $1 AND student_id = $2', [classId, studentId]);
		return rows[0] ? snakeToCamel<ClassEnrollment>(rows[0]) : null;
	}

	public async create(classId: number, studentId: number): Promise<ClassEnrollment> {
		const rows = await this.db.query<Record<string, unknown>>("INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'active') RETURNING *", [classId, studentId]);
		return snakeToCamel<ClassEnrollment>(rows[0]);
	}

	public async setStatus(id: number, status: 'active' | 'removed'): Promise<ClassEnrollment> {
		const rows = await this.db.query<Record<string, unknown>>('UPDATE class_enrollments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, id]);
		return snakeToCamel<ClassEnrollment>(rows[0]);
	}
}
