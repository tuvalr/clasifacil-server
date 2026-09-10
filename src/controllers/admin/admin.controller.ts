import { inject, injectable } from 'inversify';
import { TYPES } from '../../container/types';
import { BaseController } from '../shared/base.controller';
import { AdminOperatorsController } from './operators/operators.controller';
import { AdminHouseholdsController } from './households/households.controller';

@injectable()
export class AdminController extends BaseController {
	public constructor(
		@inject(TYPES.AdminOperatorsController) operatorsController: AdminOperatorsController,
		@inject(TYPES.AdminHouseholdsController) householdsController: AdminHouseholdsController,
	) {
		super();
		this.internalRouter.use('/operators', operatorsController.router);
		this.internalRouter.use('/households', householdsController.router);
	}
}
