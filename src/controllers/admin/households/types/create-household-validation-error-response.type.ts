export interface CreateHouseholdValidationErrorDetail {
	field: string;
	message: string;
}

export interface CreateHouseholdValidationErrorResponse {
	error: string;
	details: CreateHouseholdValidationErrorDetail[];
}
