export interface BookingConflict {
	conflict: true;
	waitlisted: false;
}

export class PlainSessionNotAllowedError extends Error {
	public constructor() {
		super('Schedule-type operators cannot create plain one-off sessions - use a class instead');
		this.name = 'PlainSessionNotAllowedError';
	}
}
