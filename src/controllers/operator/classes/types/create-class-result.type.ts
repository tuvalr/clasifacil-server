import { Class } from '../../../../entities/class.entity';
import { PublicEntity } from '../../../../entities/base.entity';
import { ClassValidationErrorDetail } from './class-validation-error-response.type';

export interface CreateClassSuccessResult {
	success: true;
	class: PublicEntity<Class>;
}

export interface CreateClassFailureResult {
	success: false;
	error: string;
	details?: ClassValidationErrorDetail[];
}

export type CreateClassResult = CreateClassSuccessResult | CreateClassFailureResult;
