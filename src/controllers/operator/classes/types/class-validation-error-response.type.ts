export interface ClassValidationErrorDetail {
	field: string;
	message: string;
}

export interface ClassValidationErrorResponse {
	error: string;
	details: ClassValidationErrorDetail[];
}
