export interface UpdateOperatorSettingsValidationErrorDetail {
	field: string;
	message: string;
}

export interface UpdateOperatorSettingsValidationErrorResponse {
	error: string;
	details: UpdateOperatorSettingsValidationErrorDetail[];
}
