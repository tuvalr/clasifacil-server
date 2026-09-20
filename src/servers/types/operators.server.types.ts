import { getCountries, CountryCode } from 'libphonenumber-js';
import { EnrollmentAndCredit } from '../../entities/enrollment-and-credit.entity';
import { Session } from '../../entities/session.entity';
import { Student } from '../../entities/student.entity';
import { Household } from '../../entities/household.entity';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const VALID_COUNTRY_CODES: ReadonlySet<string> = new Set(getCountries());
export const VALID_TIMEZONES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('timeZone'));

export function isKnownCountryCode(value: string): value is CountryCode {
	return VALID_COUNTRY_CODES.has(value);
}

export class OperatorHasActiveClassesError extends Error {
	public constructor() {
		super('Cannot change operator type while active classes exist');
		this.name = 'OperatorHasActiveClassesError';
	}
}

export class OperatorTimezoneLockedError extends Error {
	public constructor() {
		super('Cannot change timezone once the operator has any class - contact an admin for manual correction');
		this.name = 'OperatorTimezoneLockedError';
	}
}

export type EnrollmentWithHouseholdDetails = EnrollmentAndCredit & { student: Student | null; household: Household | null };
export type SessionWithEnrollmentDetails = Session & { enrollments: EnrollmentWithHouseholdDetails[] };
