export interface SessionAttendanceEntry {
	studentId: number;
	status: 'present' | 'absent' | 'approved_absent';
}

export interface SessionAttendanceBody {
	attendance: SessionAttendanceEntry[];
}
