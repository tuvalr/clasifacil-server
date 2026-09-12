export interface SessionValidationErrorDetail {
	field: string;
	message: string;
}

export interface SessionValidationErrorResponse {
	error: string;
	details: SessionValidationErrorDetail[];
}
