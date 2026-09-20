export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Household is "connected to an operator" once any of its students holds a live ('booked') enrollment in one of
// that operator's sessions - deleting the household out from under an active booking would orphan it.
export class HouseholdHasActiveBookingError extends Error {
	public constructor() {
		super('Cannot delete a household with an active booking');
		this.name = 'HouseholdHasActiveBookingError';
	}
}
