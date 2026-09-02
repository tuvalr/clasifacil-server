export interface CreateOperatorValidationErrorDetail {
	field: string;
	message: string;
}

export interface CreateOperatorValidationErrorResponse {
	error: string;
	details: CreateOperatorValidationErrorDetail[];
}
