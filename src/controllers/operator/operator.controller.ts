import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { OperatorsServer } from '../../servers/operators.server';
import { Student } from '../../entities/student.entity';
import { EnrollmentAndCredit } from '../../entities/enrollment-and-credit.entity';
import { Session } from '../../entities/session.entity';
import { Household } from '../../entities/household.entity';
import { RouteHandlers } from '../shared/route-handlers';
import { BaseController } from '../shared/base.controller';
import { Results } from '../shared/results';
import { Result } from '../shared/types/result.type';
import { toPublic } from '../../utils/to-public';
import { HouseholdsController } from './households/households.controller';
import { SessionsController } from './sessions/sessions.controller';
import { ClassesController } from './classes/classes.controller';
import { ClassOccurrencesController } from './classes/class-occurrences.controller';
import { AttendanceCreditsController } from './attendance-credits/attendance-credits.controller';
import { BillingController } from './billing/billing.controller';
import { RemindersController } from './reminders/reminders.controller';
import { AutopayController } from './autopay/autopay.controller';
import { OperatorSettingsController } from './settings/settings.controller';
import { GetOperatorDetailsResponse } from './types/get-operator-details-response.type';

@injectable()
export class OperatorController extends BaseController {
	public constructor(
		@inject(TYPES.OperatorsServer) private readonly operatorsServer: OperatorsServer,
		@inject(TYPES.HouseholdsController) householdsController: HouseholdsController,
		@inject(TYPES.SessionsController) sessionsController: SessionsController,
		@inject(TYPES.ClassesController) classesController: ClassesController,
		@inject(TYPES.ClassOccurrencesController) classOccurrencesController: ClassOccurrencesController,
		@inject(TYPES.AttendanceCreditsController) attendanceCreditsController: AttendanceCreditsController,
		@inject(TYPES.BillingController) billingController: BillingController,
		@inject(TYPES.RemindersController) remindersController: RemindersController,
		@inject(TYPES.AutopayController) autopayController: AutopayController,
		@inject(TYPES.OperatorSettingsController) settingsController: OperatorSettingsController,
	) {
		super();

		/**
		 * @openapi
		 * /api/operator/{id}:
		 *   get:
		 *     summary: Get operator by ID, with its sessions, their enrollments, and each enrollment's student/household
		 *     tags: [Operator]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/OperatorDetails' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id', RouteHandlers.wrapOneParam('id', this.getOperatorById.bind(this)));

		this.internalRouter.use('/sessions', sessionsController.router);
		this.internalRouter.use('/classes', classesController.router);
		this.internalRouter.use('/classes', classOccurrencesController.router);

		this.internalRouter.use('/households', householdsController.router);
		this.internalRouter.use('/attendance-credits', attendanceCreditsController.router);
		this.internalRouter.use('/billing', billingController.router);
		this.internalRouter.use('/reminders', remindersController.router);
		this.internalRouter.use('/autopay', autopayController.router);
		this.internalRouter.use('/settings', settingsController.router);
	}

	private async getOperatorById(id: string): Promise<Result<GetOperatorDetailsResponse>> {
		const details = await this.operatorsServer.getByIdWithDetails(Number(id));
		if (!details) {
			return Results.notFound();
		}
		return Results.ok({
			...toPublic(details.operator),
			sessions: details.sessions.map((session: Session & { enrollments: (EnrollmentAndCredit & { student: Student | null; household: Household | null })[] }) => ({
				...toPublic(session),
				enrollments: session.enrollments.map((enrollment: EnrollmentAndCredit & { student: Student | null; household: Household | null }) => ({
					...toPublic(enrollment),
					student: enrollment.student ? toPublic(enrollment.student) : null,
					household: enrollment.household ? toPublic(enrollment.household) : null,
				})),
			})),
		});
	}
}
