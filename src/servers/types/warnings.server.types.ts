// General-purpose operator warnings feed: each warning has a `type` discriminator and its own payload, so a new
// warning kind is added by extending this union and pushing to it from WarningsServer.listByOperatorId, without
// changing the endpoint's shape or route.
export interface ClassBelowMinSizeWarning {
	type: 'class_below_min_size';
	classId: number;
	title: string;
	enrolledCount: number;
	minSize: number;
	shortfall: number;
}

export type Warning = ClassBelowMinSizeWarning;
