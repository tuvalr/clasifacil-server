import { EnrollmentAndCredit } from '../../../../entities/enrollment-and-credit.entity';
import { PublicEntity } from '../../../../entities/base.entity';
import { BookSessionConflictResponse } from './book-session-conflict-response.type';

// The controller returns Result<BookSessionResponse>; RouteHandlers.wrapResult
// maps success to EnrollmentAndCredit (201) and conflict to
// BookSessionConflictResponse (409), so the type is their union.
export type BookSessionResponse = PublicEntity<EnrollmentAndCredit> | BookSessionConflictResponse;
