export interface CreateClassBody {
	operatorId: number;
	title: string;
	dayOfWeek: number;
	startTime: string;
	durationMinutes: number;
	minSize?: number;
	maxSize: number;
	studentId?: number;
	color?: string | null;
}
