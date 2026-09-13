export interface UpdateClassBody {
	title?: string;
	dayOfWeek?: number;
	startTime?: string;
	durationMinutes?: number;
	minSize?: number | null;
	maxSize?: number;
	// Only takes effect when `title` is also present in the same request — ignored otherwise. When true, propagates
	// the new title to the class's future, non-makeup generated sessions; when false/omitted, only the class
	// definition itself is renamed (matching this endpoint's existing non-retroactive behavior for every other field).
	renameRelatedSessions?: boolean;
}
