# Simplified Controller Handler Signatures via a `Result<T>` Return Type

## Context

Every controller method currently has the shape `(req: Request<P, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>): Promise<void>`, reading `req.params`/`req.body`/`req.query` and calling `res.status(code).json(...)` / `res.status(code).end()` directly, in as many branches as the endpoint needs. This makes every method's true inputs and outputs invisible from its signature — you have to read the body to find out what it reads from the request and what it can return.

A survey of all 15 controllers with real logic (`src/controllers/**/*.controller.ts`, excluding pure aggregator/router controllers and stub `notImplemented` controllers) found roughly 35 methods that fit a handful of clean, repeated patterns (404-from-null, 201-create, 204-delete, 409-from-thrown-error, 400-from-`ValidationError`), plus 2 methods needing `req.file` (multipart avatar upload, which doesn't fit a JSON body/query model) and a handful of genuine outliers:

- `SessionsController.book` (via `SessionsServer.book`) signals a booking conflict via a returned `BookingConflict` value, not a thrown error — the only place a business-rule conflict isn't an exception.
- `ClassOccurrencesController`/`ClassesController` inspect a caught `ValidationError`'s `.details` for a `field === 'classId'` sentinel to remap what would otherwise be a 400 into a 404 ("class not found" via an error that was actually meant to signal a different missing class-scoped resource).
- `ClassesController.createClass` catches *any* thrown error (not just `ValidationError`) and reports it as 400 — inconsistent with every other create/update method, and capable of masking a real bug as a client error instead of a 500.

## Goals

- Every migrated controller method's signature becomes `(<one arg per path param>, body: ReqBody, query: ReqQuery) => Promise<Result<ResBody>>` — each path param gets its own named positional argument (e.g. `(id: string, studentId: string, body: ..., query: ...)` for a two-param route), rather than a single `params` object, and `body`/`query` are always both present (unused ones named `_body`/`_query`). Its real inputs and its full set of possible outcomes (status codes and bodies) are visible directly in the type, without reading the method body.
- A single explicit `Result<T>` union (discriminated by HTTP status code) is used everywhere: `{ status: 200 | 201; body: T } | { status: 204 } | { status: 400; error?: string; details?: ValidationErrorDetail[] } | { status: 404 } | ({ status: 409; error: string } & Record<string, unknown>)` (see Design for why `error` is optional on 400 and why 409 allows extra fields).
- A `Results` factory namespace (`Results.ok`, `Results.created`, `Results.noContent`, `Results.notFound`, `Results.validationError`, `Results.conflict`, `Results.badRequest`) replaces hand-built `Result` object literals at call sites.
- A new `RouteHandlers.wrapResult` adapts a `Result`-returning handler into an Express `RequestHandler`, translating the returned `Result` into the actual `res.status(...).json(...)`/`res.status(...).end()` call. The existing `RouteHandlers.wrap` (raw `req`/`res`) is kept for the file-upload exception.
- Domain errors thrown by the server layer (`ValidationError`, `OperatorTimezoneLockedError`, `OperatorHasActiveClassesError`, `ClassHasActiveEnrollmentsError`, `HouseholdHasActiveBookingError`, `PlainSessionNotAllowedError`, and the new `BookingConflictError`) are still caught with `try/catch` *inside* each controller method, which translates the caught error into the matching `Results.*` call and returns it. Only genuinely unexpected errors propagate out of the handler to `.catch(next)` and the existing 500 handler — this preserves current error-handling behavior exactly, it just moves where the response gets built.
- The three outliers above are fixed as part of this change (see Design), not preserved as-is or worked around.

## Non-goals

- No change to the server layer's public API/return types or throwing behavior, **except** `SessionsServer.book`, which changes from returning a `BookingConflict` value to throwing a new `BookingConflictError` (see Design). Every other server method keeps returning `null`/`undefined` for not-found and throwing its existing `Error` subclasses for validation/conflict cases — controllers translate these into `Result`s at the boundary; servers do not know about `Result` at all.
- No change to the actual HTTP contract, **except the following four confirmed, deliberate deviations** (everything else stays byte-for-byte identical):
  1. `createClass`'s catch-all narrows to `ValidationError` only (see Design) — an unexpected error there now correctly 500s instead of being masked as a 400.
  2. `createClass`'s response shape changes from the custom `CreateClassResult` (`{success: true, class} | {success: false, error, details?}`) to the same plain shape every other create endpoint uses (`ClassMutationResponse` on 201, `{error, details?}` on 400) — a confirmed, deliberate breaking API change for `POST /api/operator/classes` clients, not an oversight.
  3. Three endpoints that currently 400 with an empty body on a missing/invalid `operatorId` query param (`operator/billing.controller.ts:listInvoices`, `operator/sessions.controller.ts:listSessions`, `operator/classes.controller.ts:listClasses`) start returning `{ error: 'operatorId is required' }` instead of an empty body — a confirmed, deliberate small API improvement, not an oversight.
  4. None otherwise — every other status code, response body shape, and error message text is preserved exactly (see `book()`'s 409 body handling below, which is explicitly preserved rather than changed).
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
	| { status: 400; error?: string; details?: ValidationErrorDetail[] }
	| { status: 404 }
	| ({ status: 409; error: string } & Record<string, unknown>);
```

The status code is always visible at the return site (`return Results.notFound();`), not inferred from a separate "kind" indirection.

`400`'s `error` is optional (not present, in the design's default) because 3 call sites (see per-method migration notes) originally sent an empty body and are being upgraded to carry an error message as part of this change — `wrapResult` sends no body when `error` is `undefined`, and `{ error, details? }` otherwise. The `409` variant's `& Record<string, unknown>` allows attaching endpoint-specific extra fields (used by exactly one call site, `book()`'s `waitlisted` field — see Outlier Fix #1) without widening every other 409 case's shape. Verified directly (compiled in isolation): this shape narrows correctly in a `switch` and is unambiguous for the `Results` factories below.

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
	public static badRequestEmpty(): Result<never> { return { status: 400 }; }
	public static conflict(error: string, extra?: Record<string, unknown>): Result<never> { return { status: 409, ...extra, error }; }
}
```

`badRequestEmpty()` is used only by the 3 call sites being upgraded from an empty 400 body to `Results.badRequest('operatorId is required')` — see per-method migration notes; it exists in case a genuinely bodyless 400 is needed elsewhere, but no call site in this migration ends up using it (all 3 candidates get an actual message per the confirmed API-improvement deviation above). `conflict`'s `extra` parameter spreads before `error` (not after) so `error` always wins if `extra` ever accidentally included an `error` key — verified directly: the reverse order (`{ error, ...extra }`) triggers TypeScript's `error TS2783` ("specified more than once, so this usage will be overwritten"), since `error: string` is always redundant with a wider `Record<string, unknown>` spread placed after it.
```

(`Result<never>` for the bodyless variants is intentional — since `wrapResult` is generic per-route over the response body type from `Response<ResBody>`, `never` unifies with any `T`.)

### `RouteHandlers.wrapResult`

Added to the existing `RouteHandlers` class in `src/controllers/shared/route-handlers.ts`, alongside (not replacing) the current `wrap`. Because each path param becomes its own positional argument, `wrapResult` takes the ordered list of param names as its first argument, and spreads `req.params`'s values (looked up by those names, in that order) ahead of `body`/`query` when calling the handler:

```ts
type ParamValues<PK extends readonly string[]> = { [I in keyof PK]: string };

public static wrapResult<PK extends readonly string[], ResBody = unknown, ReqBody = unknown, ReqQuery = unknown>(
	paramKeys: readonly [...PK],
	handler: (...args: [...ParamValues<PK>, ReqBody, ReqQuery]) => Promise<Result<ResBody>>,
): RequestHandler<ParamsDictionary, ResBody, ReqBody, ReqQuery> {
	return (req: Request<ParamsDictionary, ResBody, ReqBody, ReqQuery>, res: Response<ResBody>, next: NextFunction): void => {
		const paramValues = paramKeys.map((key: string) => req.params[key]) as ParamValues<PK>;
		(handler as (...args: unknown[]) => Promise<Result<ResBody>>)(...paramValues, req.body, req.query)
			.then((result: Result<ResBody>): void => {
				switch (result.status) {
					case 204:
					case 404:
						res.status(result.status).end();
						return;
					case 200:
					case 201:
						res.status(result.status).json(result.body);
						return;
					case 400:
						if (result.error === undefined) {
							res.status(400).end();
							return;
						}
						res.status(400).json((result.details ? { error: result.error, details: result.details } : { error: result.error }) as ResBody);
						return;
					case 409: {
						const body: Record<string, unknown> = { ...result };
						delete body.status;
						res.status(409).json(body as ResBody);
						return;
					}
				}
			})
			.catch(next);
	};
}
```

Verified directly (compiled in isolation against this project's `tsconfig.json`): the `switch` on `result.status` is required for TypeScript to narrow each case correctly — an equivalent `if (result.status === 204 || result.status === 404) {...}` chain does **not** narrow the remaining branches in this generic context (a known TypeScript limitation with control-flow narrowing through a type parameter), and fails to compile. The `409` branch copies `result` and deletes `status`, sending the remainder (`error` plus any extra fields attached via `Results.conflict(error, extra)`, e.g. `book()`'s `waitlisted`) — verified directly that this correctly excludes `status` from the JSON body, so the existing 409 endpoints that only ever sent `{ error }` keep sending exactly `{ error }`, byte-for-byte. (A `const { status: _status, ...body } = result` destructure was tried first and rejected: it compiles but this project's `@typescript-eslint/no-unused-vars` has no `varsIgnorePattern` configured, so the unused `_status` binding is a lint error — unlike unused function *parameters*, which this project's config does tolerate.) The casts inside the wrapper (`as ResBody`, `as unknown[]`) are necessary and confined entirely to this one function — call sites never see them.

Route registration in each controller's constructor now passes the route's param names explicitly, in path order, e.g.:
- Zero params: `this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listClasses.bind(this)));`
- One param: `this.internalRouter.put('/:id', RouteHandlers.wrapResult(['id'], this.updateSettings.bind(this)));`
- Two params: `this.internalRouter.get('/:id/students/:studentId', RouteHandlers.wrapResult(['id', 'studentId'], this.getStudent.bind(this)));`

The swagger/JSDoc comments above each route are untouched.

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
private async getSettings(id: string): Promise<Result<GetOperatorSettingsResponse>> {
	const operator = await this.operatorsServer.findById(Number(id));
	if (!operator) { return Results.notFound(); }
	return Results.ok(toPublic(operator));
}
```

A validation+conflict update method keeps its `try/catch`, translating each caught type:

```ts
private async updateSettings(id: string, body: UpdateOperatorSettingsBody): Promise<Result<UpdateOperatorSettingsResponse>> {
	try {
		const operator = await this.operatorsServer.update(Number(id), body, (operatorId) => this.classRepository.existsAnyForOperator(operatorId));
		if (!operator) { return Results.notFound(); }
		return Results.ok(toPublic(operator));
	} catch (error) {
		if (error instanceof ValidationError) { return Results.validationError(error.details); }
		if (error instanceof OperatorTimezoneLockedError) { return Results.conflict(error.message); }
		throw error;
	}
}
```

A two-param route names both positionally, in path order: `private async getStudent(id: string, studentId: string): Promise<Result<StudentResponse>>` for a route registered as `RouteHandlers.wrapResult(['id', 'studentId'], this.getStudent.bind(this))`.

**Every handler declares all of its parameters, in full, every time** — path params, then `body`, then `query` — even when one or more trailing ones are unused. Verified directly: omitting a trailing unused parameter (e.g. a list method declared as just `listClasses(query: ListClassesQuery)`, skipping `body`) compiles fine on its own, but breaks `wrapResult`'s generic type inference at the call site (TypeScript can't infer the omitted parameter's type from a shorter function in this generic-tuple context), forcing verbose explicit type arguments (`wrapResult<[], Item[], unknown, ListQuery>(...)`) to work around it. Declaring every parameter avoids this entirely, at the cost of an unused parameter needing a name. An unused parameter is prefixed with `_` (e.g. `_body: unknown`).

**ESLint config change required.** A meaningful fraction of methods (e.g. `deleteHousehold`, `archiveHousehold`, `cancelSession`, `getSettings`) have *both* `body` and `query` unused — both now trailing parameters, both unused simultaneously. Verified directly: this project's `eslint.config.js` currently sets `'@typescript-eslint/no-unused-vars': ['error']` with no `argsIgnorePattern`, so `@typescript-eslint/no-unused-vars`'s default `args: "after-used"` behavior only exempts an unused parameter that precedes a *used* one — it does **not** exempt a genuinely-last unused parameter regardless of its name, including an underscore-prefixed one (confirmed: `function f(id: string, _body: unknown, _query: unknown)` with neither `_body` nor `_query` used is flagged on both, today's `_req`-style convention only ever works because an unused `req` is never actually the last parameter). Fix: `eslint.config.js`'s `no-unused-vars` rule changes to `['error', { argsIgnorePattern: '^_' }]` — verified directly that this exempts any `_`-prefixed parameter regardless of position, and that running `npx eslint src/` with this change applied against the current (pre-migration) codebase produces no new errors or warnings. This is a project-wide lint rule change (not scoped to migrated files only), applied once, up front, before any controller migration. Example: a list method with no path params and both `body`/`query` unused is declared as `private async listClasses(_body: unknown, _query: unknown): Promise<Result<ListClassesResponse>>`, registered as `RouteHandlers.wrapResult([], this.listClasses.bind(this))`.

Multi-step orchestration methods (`recordOccurrenceAttendance`, `getAttendance`) keep their existing sequential-call/branching logic in the method body — they just end by `return`ing a `Result` instead of calling `res.json`/`res.status`.

### Outlier fixes

**1. `book()`'s conflict.** `SessionsServer.book`'s return type changes from `Promise<EnrollmentAndCredit | BookingConflict | null>` to throwing a new `BookingConflictError` instead of returning the `BookingConflict` shape. The current response is `res.status(409).json({ error: 'Session at capacity', waitlisted: result.waitlisted })` (`waitlisted` is always `false` today — no waitlist exists yet, see `SessionsServer.book`'s own TODO comments), and per this spec's Non-goals this exact body is preserved, not altered. `BookingConflict` (the interface) is deleted from `sessions.server.types.ts`. Since `waitlisted` is response-shaping information the controller needs to forward, `BookingConflictError` carries it as a public constructor field:

```ts
// src/servers/types/sessions.server.types.ts
export class BookingConflictError extends Error {
	public constructor(public readonly waitlisted: boolean = false) {
		super('Session at capacity'); // preserves the exact current message text (not "Session is at capacity")
		this.name = 'BookingConflictError';
	}
}
```

`SessionsServer.book` throws `new BookingConflictError()` where it previously returned the conflict shape; its return type narrows to `Promise<EnrollmentAndCredit | null>`. `BookingController.book` catches it and returns `Results.conflict(error.message, { waitlisted: error.waitlisted })`, which (per the updated `Results.conflict` signature above) produces exactly `{ status: 409, error: 'Session at capacity', waitlisted: false }` — `wrapResult`'s 409 branch strips `status` before sending, yielding `{ error: 'Session at capacity', waitlisted: false }` on the wire, byte-for-byte identical to today.

**2. `classId` 404 remap.** Stays as a special-cased check inside the affected controller methods. `ClassOccurrencesController` keeps its existing shared `isClassIdError(error: ValidationError): boolean` private helper method, used by `rescheduleOccurrence`, `recordOccurrenceAttendance`, and `createMakeupSession`. `ClassesController` gains an equivalent shared private helper (it does not have one today — `assignStudents`/`unassignStudents` currently duplicate the same `error.details.some((detail) => detail.field === 'classId')` check inline), used by both `assignStudents` and `unassignStudents`. In both files, the caught `ValidationError`'s `.details` is inspected, and when it matches the classId sentinel, the method returns `Results.notFound()` instead of `Results.validationError(error.details)`. No server-layer change; this is a controller-side response-shaping decision, same as today, just expressed as a return instead of a direct `res` call.

**3. `createClass`'s catch-all and response shape.** Two confirmed, deliberate changes bundled into this one method (both listed in Non-goals above):
- The catch-all narrows to `catch (error) { if (error instanceof ValidationError) { return Results.validationError(error.details); } throw error; }` — matching every other create/update method. Anything that isn't a `ValidationError` now propagates to `.catch(next)` and the standard 500 handler, instead of being reported as a 400.
- The response shape changes from the custom `CreateClassResult` (`{success: true, class: PublicEntity<Class>} | {success: false, error: string, details?: ClassValidationErrorDetail[]}`, defined in `src/controllers/operator/classes/types/create-class-result.type.ts`) to the same shape every other create endpoint uses: `Results.created(toPublic(created))` (a bare `ClassMutationResponse` body on 201) and `Results.validationError(error.details)` (a bare `{error, details?}` body on 400). `create-class-result.type.ts` and its `CreateClassSuccessResult`/`CreateClassFailureResult` interfaces are deleted (assuming, per a repo-wide grep during implementation, nothing else imports them — the design doc's earlier survey found no other importer). This is a breaking response-shape change for `POST /api/operator/classes`, confirmed deliberately in scope for this migration, not an oversight.

## Testing

No automated test suite exists in this project (`npm test` is a placeholder). Verification is: `npx tsc --noEmit` and `npx eslint src/` clean after each file's migration, plus manually exercising a representative sample of migrated endpoints against a running dev server to confirm response status/body are byte-for-byte identical to before the change (except the 4 confirmed deviations listed in Non-goals), specifically covering: a plain 200, a 404, a 400-validation, a 409-conflict, a 201-create, a 204-delete, the newly-thrown `BookingConflictError` path for `book()` (confirming the response is still exactly `{error: 'Session at capacity', waitlisted: false}`), one of the 3 upgraded-to-a-message 400 endpoints (confirming it now returns `{error: 'operatorId is required'}` instead of an empty body), `createClass`'s new plain response shape on both 201 and 400, and one `classId`-remap 404 case in each of `ClassesController` and `ClassOccurrencesController`.

## Rollout

1. Apply the `eslint.config.js` `argsIgnorePattern: '^_'` change first (see Per-method migration shape), and confirm `npx eslint src/` is still clean against the pre-migration codebase.
2. Add the shared infrastructure: `Result<T>` (`src/controllers/shared/types/result.type.ts`), `Results` (`src/controllers/shared/results.ts`), and `RouteHandlers.wrapResult` (added to `src/controllers/shared/route-handlers.ts`). Nothing consumes these yet; `tsc`/`eslint` must still pass.
3. Migrate file-by-file (15 controller files), verifying `tsc`/`eslint` pass after each file, rather than one large diff. Suggested order: start with the simplest single-pattern files (e.g. `admin/households`, `operator/households`) to validate the `Result`/`Results`/`wrapResult` plumbing works end-to-end, then proceed through the rest, saving the 3 outlier-containing files (`operator/sessions` + `household/booking` for `book()`, `operator/classes` + `operator/classes/class-occurrences` for the `classId` remap and `createClass`) for when the pattern is well-exercised.
