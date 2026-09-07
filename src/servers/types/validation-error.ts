export interface ValidationErrorDetail {
	field: string;
	message: string;
}

export class ValidationError extends Error {
	public constructor(public readonly details: ValidationErrorDetail[]) {
		super('Validation failed');
		this.name = 'ValidationError';
	}
}
