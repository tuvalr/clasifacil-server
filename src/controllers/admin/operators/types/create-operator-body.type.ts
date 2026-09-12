export interface CreateOperatorBody {
	name: string;
	email: string;
	phone: string;
	countryCode: string;
	type: 'schedule' | 'assigned';
}
