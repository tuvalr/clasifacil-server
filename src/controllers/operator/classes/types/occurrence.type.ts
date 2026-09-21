export interface OccurrenceAttendanceEntry {
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent' | 'not_recorded';
}

export interface OccurrenceResponseItem {
	isVirtual: boolean;
	classId?: number;
	sessionId?: number;
	startTime: string;
	endTime: string;
	isMakeupSession?: boolean;
	title: string | null;
	attendance?: OccurrenceAttendanceEntry[];
}

export interface ListOccurrencesResponse {
	occurrences: OccurrenceResponseItem[];
	classMemberStudentIds: number[];
}
