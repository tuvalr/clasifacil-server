import { ValidationErrorDetail } from '../../../servers/types/validation-error';

export type Result<T> =
	| { status: 200 | 201; body: T } // ok / created, with a response body
	| { status: 204 } // no content
	| { status: 400; error?: string; details?: ValidationErrorDetail[] } // bad request; error is optional only for the couple of endpoints that historically sent an empty 400 body
	| { status: 404 } // not found, no body
	| ({ status: 409; error: string } & Record<string, unknown>); // conflict; extra fields (e.g. book()'s waitlisted) merge into the JSON body alongside error
