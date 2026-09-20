# Simplified Controller Handler Signatures via a `Result<T>` Return Type

## Context

Every controller method currently has the shape `(req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>): Promise<void>`, reading `req.params`/`req.body`/`req.query` and calling `res.status(code).json(...)` / `res.status(code).end()` directly, in as many branches as the endpoint needs. This makes every method's true inputs and outputs invisible from its signature — you have to read the body to find out what it reads from the request and what it can return.

A survey of all 15 controllers with real logic (`src/controllers/**/*.controller.ts`, excluding pure aggregator/router controllers and stub `notImplemented` controllers) found roughly 35 methods that fit a handful of clean, repeated patterns (404-from-null, 201-create, 204-delete, 409-from-thrown-error, 400-from-`ValidationError`), plus 2 methods needing `req.file` (multipart avatar upload, which doesn't fit a JSON body/query model) and a handful of genuine outliers:

- `SessionsController.book` (via `SessionsServer.book`) signals a booking conflict via a returned `BookingConflict` value, not a thrown error — the only place a business-rule conflict isn't an exception.
- `ClassOccurrencesController`/`ClassesController` inspect a caught `ValidationError`'s `.details` for a `field === 'classId'` sentinel to remap what would otherwise be a 400 into a 404 ("class not found" via an error that was actually meant to signal a different missing class-scoped resource).
- `ClassesController.createClass` catches *any* thrown error (not just `ValidationError`) and reports it as 400 — inconsistent with every other create/update method, and capable of masking a real bug as a client error instead of a 500.

## Goals

- Every migrated controller method's signature becomes `(params: P, body: ReqBody, query: ReqQuery) => Promise<Result<ResBody>>` — its real inputs and its full set of possible outcomes (status codes and bodies) are visible directly in the type, without reading the method body.
- A single explicit `Result<T>` union (discriminated by HTTP status code) is used everywhere: `{ status: 200 | 201; body: T } | { status: 204 } | { status: 400; error: string; details?: ValidationErrorDetail[] } | { status: 404 } | { status: 409; error: string }`.
- A `Results` factory namespace (`Results.ok`, `Results.created`, `Results.noContent`, `Results.notFound`, `Results.validationError`, `Results.conflict`, `Results.badRequest`) replaces hand-built `Result` object literals at call sites.
- A new `RouteHandlers.wrapResult` adapts a `Result`-returning handler into an Express `RequestHandler`, translating the returned `Result` into the actual `res.status(...).json(...)`/`res.status(...).end()` call. The existing `RouteHandlers.wrap` (raw `req`/`res`) is kept for the file-upload exception.
- Domain errors thrown by the server layer (`ValidationError`, `OperatorTimezoneLockedError`, `OperatorHasActiveClassesError`, `ClassHasActiveEnrollmentsError`, `HouseholdHasActiveBookingError`, `PlainSessionNotAllowedError`, and the new `BookingConflictError`) are still caught with `try/catch` *inside* each controller method, which translates the caught error into the matching `Results.*` call and returns it. Only genuinely unexpected errors propagate out of the handler to `.catch(next)` and the existing 500 handler — this preserves current error-handling behavior exactly, it just moves where the response gets built.
- The three outliers above are fixed as part of this change (see Design), not preserved as-is or worked around.

## Non-goals

- No change to the server layer's public API/return types or throwing behavior, **except** `SessionsServer.book`, which changes from returning a `BookingConflict` value to throwing a new `BookingConflictError` (see Design). Every other server method keeps returning `null`/`undefined` for not-found and throwing its existing `Error` subclasses for validation/conflict cases — controllers translate these into `Result`s at the boundary; servers do not know about `Result` at all.
- No change to the actual HTTP contract: status codes, response body shapes, and error message text stay exactly as they are today for every endpoint. This is an internal refactor of how controllers are written, not an API change. (The one behavioral change is `createClass`'s catch-all narrowing to `ValidationError` only — see Design — which only affects behavior for a case that was already a masked bug: an unexpected error there will now correctly 500 instead of incorrectly 400.)
- No change to the 2 multipart file-upload methods' signature (`household/settings.controller.ts:updateAvatar`, `operator/settings.controller.ts:updateAvatar`) — they keep `(req, res)` via the existing `RouteHandlers.wrap`, since `req.file` and multipart bodies don't fit a JSON `body`/`query` model. This is a deliberate, documented exception, not a gap to close later.
- No change to the 4 stub `notImplemented` controllers or the pure aggregator/router controllers (`household.controller.ts`, `admin.controller.ts`, `operator.controller.ts`) — they have no methods of their own to migrate.
- No change to `RouteHandlers.errorHandler` or `RouteHandlers.notImplemented`.

## Design

### `Result<T>` type

New file `src/controllers/shared/types/result.type.ts`:

```ts
import { ValidationErrorDetail } from '../../../servers/types/validation-error';

export type Result<T> =
	| { status: 200 | 201; body: T }
	| { status: 204 }
	| { status: 400; error: string; details?: ValidationErrorDetail[] }
	| { status: 404 }
	| { status: 409; error: string };
```

The status code is always visible at the return site (`return Results.notFound();`), not inferred from a separate "kind" indirection.

### `Results` factory helpers

New file `src/controllers/shared/results.ts`:

```ts
export class Results {
	public static ok<T>(body: T): Result<T> { return { status: 200, body }; }
	public static created<T>(body: T): Result<T> { return { status: 201, body }; }
	public static noContent(): Result<never> { return { status: 204 }; }
	public static notFound(): Result<never> { return { status: 404 }; }
	public static validationError(details: ValidationErrorDetail[]): Result<never> { return { status: 400, error: 'Validation failed', details }; }
	public static badRequest(error: string): Result<never> { return { status: 400, error }; }
	public static conflict(error: string): Result<never> { return { status: 409, error }; }
}
```

(`Result<never>` for the bodyless variants is intentional — since `wrapResult` is generic per-route over the response body type from `Response<ResBody>`, `never` unifies with any `T`.)

### `RouteHandlers.wrapResult`

Added to the existing `RouteHandlers` class in `src/controllers/shared/route-handlers.ts`, alongside (not replacing) the current `wrap`:

```ts
type ResultRequestHandler<P, ResBody, ReqBody, ReqQuery> =
	(params: P, body: ReqBody, query: ReqQuery) => Promise<Result<ResBody>>;

public static wrapResult<P = ParamsDictionary, ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
	handler: ResultRequestHandler<P, ResBody, ReqBody, ReqQuery>,
): RequestHandler<P, ResBody, ReqBody, ReqQuery> {
	return (req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction): void => {
		handler(req.params, req.body, req.query)
			.then((result: Result<ResBody>): void => {
				if (result.status === 204 || result.status === 404) {
					res.status(result.status).end();
					return;
				}
				if (result.status === 200 || result.status === 201) {
					res.status(result.status).json(result.body);
					return;
				}
				res.status(result.status).json(result.status === 400 && result.details ? { error: result.error, details: result.details } : { error: result.error });
			})
			.catch(next);
	};
}
```

Route registration in each controller's constructor changes only which `wrap*` call it uses, e.g. `this.internalRouter.put('/:id', RouteHandlers.wrapResult(this.updateSettings.bind(this)));` — the swagger/JSDoc comments above each route are untouched.

### Per-method migration shape

A typical 404-or-200 method:

```ts
// Before
private async getSettings(req: Request<{ id: string }>, res: Response<GetOperatorSettingsResponse>): Promise<void> {
	const operator = await this.operatorsServer.findById(Number(req.params.id));
	if (!operator) { res.status(404).end(); return; }
	res.json(toPublic(operator));
}

// After
private async getSettings(params: { id: string }): Promise<Result<GetOperatorSettingsResponse>> {
	const operator = await this.operatorsServer.findById(Number(params.id));
	if (!operator) { return Results.notFound(); }
	return Results.ok(toPublic(operator));
}
```

A validation+conflict update method keeps its `try/catch`, translating each caught type:

```ts
private async updateSettings(params: { id: string }, body: UpdateOperatorSettingsBody): Promise<Result<UpdateOperatorSettingsResponse>> {
	try {
		const operator = await this.operatorsServer.update(Number(params.id), body, (operatorId) => this.classRepository.existsAnyForOperator(operatorId));
		if (!operator) { return Results.notFound(); }
		return Results.ok(toPublic(operator));
	} catch (error) {
		if (error instanceof ValidationError) { return Results.validationError(error.details); }
		if (error instanceof OperatorTimezoneLockedError) { return Results.conflict(error.message); }
		throw error;
	}
}
```

Methods with no request body/params beyond what's used (list endpoints, etc.) simply omit the unused parameter(s) — TypeScript allows calling a `(params, body, query) => ...`-typed handler with a function of fewer parameters, so a list method can be declared as `private async listClasses(_params: unknown, _body: unknown, query: ListClassesQuery)`.

Multi-step orchestration methods (`recordOccurrenceAttendance`, `getAttendance`) keep their existing sequential-call/branching logic in the method body — they just end by `return`ing a `Result` instead of calling `res.json`/`res.status`.

### Outlier fixes

**1. `book()`'s conflict.** `SessionsServer.book`'s return type changes from `Promise<EnrollmentAndCredit | BookingConflict | null>` to throwing a new `BookingConflictError` instead of returning the `BookingConflict` shape:

```ts
// src/servers/types/sessions.server.types.ts
export class BookingConflictError extends Error {
	public constructor() {
		super('Session is at capacity');
		this.name = 'BookingConflictError';
	}
}
```

`BookingConflict` (the interface) is deleted from `sessions.server.types.ts`. `SessionsServer.book` throws `BookingConflictError` where it previously returned the conflict shape; its return type narrows to `Promise<EnrollmentAndCredit | null>`. `BookingController.book` catches it alongside its existing error handling and returns `Results.conflict(error.message)`.

**2. `classId` 404 remap.** Stays as a special-cased check inside the affected controller methods (`ClassOccurrencesController`'s `isClassIdError`-style helper, `ClassesController.assignStudents`/`unassignStudents`'s inline equivalent) — the caught `ValidationError`'s `.details` is inspected, and when it matches the classId sentinel, the method returns `Results.notFound()` instead of `Results.validationError(error.details)`. No server-layer change; this is a controller-side response-shaping decision, same as today, just expressed as a return instead of a direct `res` call.

**3. `createClass`'s catch-all.** Narrows to `catch (error) { if (error instanceof ValidationError) { return Results.validationError(error.details); } throw error; }` — matching every other create/update method. Anything that isn't a `ValidationError` now propagates to `.catch(next)` and the standard 500 handler, instead of being reported as a 400.

## Testing

No automated test suite exists in this project (`npm test` is a placeholder). Verification is: `npx tsc --noEmit` and `npx eslint src/` clean after each file's migration, plus manually exercising a representative sample of migrated endpoints (a 200, a 404, a 400-validation, a 409-conflict, and the 201-create/204-delete cases, and the newly-thrown `BookingConflictError` path for `book()`) against a running dev server to confirm response status/body are byte-for-byte identical to before the change.

## Rollout

Migrate file-by-file (15 controller files), verifying `tsc`/`eslint` pass after each file, rather than one large diff. Suggested order: start with the simplest single-pattern files (e.g. `admin/households`, `operator/households`) to validate the `Result`/`Results`/`wrapResult` plumbing works end-to-end, then proceed through the rest, saving the 3 outlier-containing files (`operator/sessions` + `household/booking` for `book()`, `operator/classes` + `operator/classes/class-occurrences` for the `classId` remap and `createClass`) for when the pattern is well-exercised.
