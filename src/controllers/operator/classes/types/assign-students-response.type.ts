export interface AssignStudentsResponseItem {
	studentId: number;
	success: boolean;
	error?: string;
	enrollment?: { id: number; classId: number; studentId: number; status: 'active' | 'removed' };
}

export type AssignStudentsResponse = AssignStudentsResponseItem[];
