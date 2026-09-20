export class BookingConflictError extends Error {
	public constructor(public readonly waitlisted: boolean = false) {
		super('Session at capacity'); // preserves the exact current message text, not a rewording
		this.name = 'BookingConflictError';
	}
}

export class PlainSessionNotAllowedError extends Error {
	public constructor() {
		super('Schedule-type operators cannot create plain one-off sessions - use a class instead');
		this.name = 'PlainSessionNotAllowedError';
	}
}
