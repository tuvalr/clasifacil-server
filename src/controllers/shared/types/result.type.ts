import { ValidationErrorDetail } from '../../../servers/types/validation-error';

export type Result<T> = { status: 200 | 201; body: T } | { status: 204 } | { status: 400; error?: string; details?: ValidationErrorDetail[] } | { status: 404 } | ({ status: 409; error: string } & Record<string, unknown>);
