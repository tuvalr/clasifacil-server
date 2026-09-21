import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { Warning } from './types/warnings.server.types';

// General-purpose operator warnings feed - see warnings.server.types.ts. Each check below is independent and
// appends its own Warning entries; a future warning kind is added as its own private method called from
// listByOperatorId, not by changing the ones already here.
@injectable()
export class WarningsServer {
	public constructor(
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,
	) {}

	public async listByOperatorId(operatorId: number): Promise<Warning[] | null> {
		const operator = await this.operators.findById(operatorId);
		if (!operator) {
			return null;
		}
		return this.classesBelowMinSize(operatorId);
	}

	// Soft signal, never a block: a class starts at 0 students and can only reach minSize by staying open for
	// enrollment, so this must never prevent operations on an under-enrolled class - only surface it for the
	// operator to act on (chase down sign-ups, lower minSize, or stop the class themselves). Stopped classes are
	// excluded - a class the operator already stopped isn't "running short," it's simply not running.
	private async classesBelowMinSize(operatorId: number): Promise<Warning[]> {
		const found = await this.classes.findByOperatorId(operatorId);
		const warnings: Warning[] = [];
		for (const foundClass of found) {
			if (foundClass.minSize == null || foundClass.status !== 'active') {
				continue;
			}
			const enrolledCount = await this.classEnrollments.countActiveByClassId(foundClass.id);
			if (enrolledCount < foundClass.minSize) {
				warnings.push({
					type: 'class_below_min_size',
					classId: foundClass.id,
					title: foundClass.title,
					enrolledCount,
					minSize: foundClass.minSize,
					shortfall: foundClass.minSize - enrolledCount,
				});
			}
		}
		return warnings;
	}
}
