import { EnrollmentAndCredit } from '../../../entities/enrollment-and-credit.entity';
import { BookSessionConflictResponse } from './book-session-conflict-response.type';

// The handler's actual res.json() calls: 201 sends EnrollmentAndCredit,
// 409 sends BookSessionConflictResponse — both are valid bodies for
// this route, so Response<> is typed as their union rather than just
// the success case.
export type BookSessionResponse = EnrollmentAndCredit | BookSessionConflictResponse;
