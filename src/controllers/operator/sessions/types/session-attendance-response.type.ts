export interface SessionAttendanceResponseItem {
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent';
}

export type SessionAttendanceResponse = SessionAttendanceResponseItem[];
