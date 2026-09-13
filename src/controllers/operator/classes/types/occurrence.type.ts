export interface OccurrenceResponseItem {
	isVirtual: boolean;
	classId?: number;
	sessionId?: number;
	startTime: string;
	isMakeupSession?: boolean;
	title: string | null;
}

export interface ListOccurrencesResponse {
	occurrences: OccurrenceResponseItem[];
	classMemberStudentIds: number[];
}
