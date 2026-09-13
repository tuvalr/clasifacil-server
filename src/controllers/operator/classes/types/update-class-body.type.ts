export interface UpdateClassBody {
	title?: string;
	dayOfWeek?: number;
	startTime?: string;
	durationMinutes?: number;
	minSize?: number | null;
	maxSize?: number;
}
