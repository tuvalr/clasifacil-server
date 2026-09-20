import { ValidationErrorDetail } from '../../servers/types/validation-error';
import { Result } from './types/result.type';

export class Results {
	public static ok<T>(body: T): Result<T> {
		return { status: 200, body };
	}

	public static created<T>(body: T): Result<T> {
		return { status: 201, body };
	}

	public static noContent(): Result<never> {
		return { status: 204 };
	}

	public static notFound(): Result<never> {
		return { status: 404 };
	}

	public static validationError(details: ValidationErrorDetail[]): Result<never> {
		return { status: 400, error: 'Validation failed', details };
	}

	public static badRequest(error: string): Result<never> {
		return { status: 400, error };
	}

	public static badRequestEmpty(): Result<never> {
		return { status: 400 };
	}

	// extra spreads before error (not after) so error always wins if extra ever accidentally included an `error`
	// key - the reverse order triggers TS2783 ("specified more than once") since error: string is always
	// redundant with a wider Record<string, unknown> spread placed after it.
	public static conflict(error: string, extra?: Record<string, unknown>): Result<never> {
		return { status: 409, ...extra, error };
	}
}
