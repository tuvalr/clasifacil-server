# Simplified Controller Handler Signatures via Result<T> Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every controller method's `(req, res) => Promise<void>` signature with `(...pathParams, body, query) => Promise<Result<ResBody>>`, so each method's real inputs and full set of possible HTTP outcomes are visible in its type, without reading its body.

**Architecture:** A new `Result<T>` discriminated union (by HTTP status code) plus `Results` factory helpers replace direct `res.status().json()`/`res.status().end()` calls. A new `RouteHandlers.wrapResult(paramKeys, handler)` adapts a `Result`-returning handler into an Express `RequestHandler`, spreading `req.params`'s values (by name, in path order) ahead of `body`/`query`. Domain errors are still caught with `try/catch` inside each method and translated to the matching `Results.*` call; only genuinely unexpected errors still propagate to the existing 500 handler. Two multipart file-upload methods are a documented exception and keep the old `(req, res)` signature.

**Tech Stack:** TypeScript, Express 5, Inversify DI — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-20-controller-result-signatures-design.md`

## Global Constraints

- Every migrated controller method's signature is `(<one positional arg per path param, in path order>, body: ReqBody, query: ReqQuery) => Promise<Result<ResBody>>`. Every parameter is always declared, even when unused (prefixed `_`, e.g. `_body: unknown`).
- The `Result<T>` type (verbatim, from the spec): `type Result<T> = { status: 200 | 201; body: T } | { status: 204 } | { status: 400; error?: string; details?: ValidationErrorDetail[] } | { status: 404 } | ({ status: 409; error: string } & Record<string, unknown>);`
- Only 4 confirmed, deliberate HTTP-contract deviations are allowed anywhere in this migration (see spec Non-goals); every other status code, response body shape, and error message text must stay byte-for-byte identical to what it is today.
- `npx tsc --noEmit` and `npx eslint src/` must both be clean after every single task.
- The 2 multipart file-upload methods (`household/settings/settings.controller.ts:updateAvatar`, `operator/settings/settings.controller.ts:updateAvatar`) are never migrated — they keep `(req, res)` via the existing `RouteHandlers.wrap`.
- Do not touch: `RouteHandlers.errorHandler`, `RouteHandlers.notImplemented`, the existing `RouteHandlers.wrap` (raw `req`/`res` — kept, not replaced), any stub `notImplemented`-only route, or the 3 pure aggregator controllers (`household.controller.ts`, `admin.controller.ts`, `operator.controller.ts`).
- Swagger/JSDoc comment blocks above each route registration are never touched.
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` (per this session's standing instruction — check the current session's attribution convention if it differs).

---

### Task 1: ESLint config — allow underscore-prefixed unused parameters everywhere

**Files:**
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: every later task's `_body`/`_query`/`_id`-style unused parameters lint cleanly. No later task can pass its verification step without this one merged first.

- [ ] **Step 1: Make the change**

Find this line in `eslint.config.js`:

```js
'@typescript-eslint/no-unused-vars': ['error'],
```

Replace it with:

```js
'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
```

- [ ] **Step 2: Verify no regressions against the current (pre-migration) codebase**

Run: `npx eslint src/`
Expected: no output, exit code 0 (identical to before the change — this option only *adds* an exemption, it cannot newly flag anything).

- [ ] **Step 3: Verify the exemption actually works**

Create a throwaway file to confirm, then delete it:

```bash
cat > src/__verify_scratch.ts << 'EOF'
async function example(id: string, _body: unknown, _query: unknown): Promise<string> {
	return id;
}
void example;
EOF
npx eslint src/__verify_scratch.ts
rm src/__verify_scratch.ts
```

Expected: no output (both `_body` and `_query`, though both unused and both trailing, are exempted).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (this is a lint-only config change; it cannot affect `tsc`).

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js
git commit -m "$(cat <<'EOF'
build: allow underscore-prefixed unused function parameters in eslint

The upcoming controller signature migration gives every handler a fixed
(pathParams, body, query) shape, so some methods end up with both body
and query unused and trailing - a case the default no-unused-vars
"after-used" behavior doesn't exempt even with an underscore prefix.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Shared infrastructure — Result<T>, Results, RouteHandlers.wrapResult

**Files:**
- Create: `src/controllers/shared/types/result.type.ts`
- Create: `src/controllers/shared/results.ts`
- Modify: `src/controllers/shared/route-handlers.ts`

**Interfaces:**
- Consumes: `ValidationErrorDetail` from `src/servers/types/validation-error.ts` (already exists).
- Produces: `Result<T>` type, `Results` class with static methods `ok<T>(body: T)`, `created<T>(body: T)`, `noContent()`, `notFound()`, `validationError(details: ValidationErrorDetail[])`, `badRequest(error: string)`, `badRequestEmpty()`, `conflict(error: string, extra?: Record<string, unknown>)` — all returning `Result<T>`/`Result<never>`. `RouteHandlers.wrapResult<PK extends readonly string[], ResBody, ReqBody, ReqQuery>(paramKeys: readonly [...PK], handler: (...args: [...ParamValues<PK>, ReqBody, ReqQuery]) => Promise<Result<ResBody>>): RequestHandler<...>`. Every later task's controller migrations call `Results.*` and register routes via `RouteHandlers.wrapResult([...paramNames], this.method.bind(this))`.

Nothing calls any of this yet — this task only adds the infrastructure and must compile/lint clean on its own with zero consumers.

- [ ] **Step 1: Create the `Result<T>` type**

Create `src/controllers/shared/types/result.type.ts`:

```ts
import { ValidationErrorDetail } from '../../../servers/types/validation-error';

export type Result<T> =
	| { status: 200 | 201; body: T }
	| { status: 204 }
	| { status: 400; error?: string; details?: ValidationErrorDetail[] }
	| { status: 404 }
	| ({ status: 409; error: string } & Record<string, unknown>);
```

- [ ] **Step 2: Create the `Results` factory**

Create `src/controllers/shared/results.ts`:

```ts
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
```

- [ ] **Step 3: Add `RouteHandlers.wrapResult`**

Read `src/controllers/shared/route-handlers.ts` first to see its current imports and the existing `wrap` method you're adding alongside.

Add this import at the top (alongside the existing ones):

```ts
import { Result } from './types/result.type';
```

Add this type alias and method to the `RouteHandlers` class, after the existing `wrap` method:

```ts
type ParamValues<PK extends readonly string[]> = { [I in keyof PK]: string };
```

(Place the `ParamValues` type alias at module scope, next to the existing `AsyncRequestHandler` type alias at the top of the file — not inside the class.)

```ts
	// Adapts a Result-returning handler into an Express RequestHandler. Each path param becomes its own named
	// positional argument on the handler (see docs/superpowers/specs/2026-09-20-controller-result-signatures-design.md)
	// rather than a single params object, so paramKeys carries the route's param names in path order and this
	// spreads req.params's values (looked up by those names) ahead of body/query when calling the handler.
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
							// Copy-then-delete (not destructuring) - a `const { status: _status, ...body } = result`
							// compiles fine but trips this project's no-unused-vars on the unused `_status` binding.
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

**Important:** the `switch` on `result.status` is required — an equivalent `if (result.status === 204 || result.status === 404) {...}` chain does not narrow the remaining branches correctly in this generic context and fails to compile. Do not refactor this to `if`/`else`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/shared/types/result.type.ts src/controllers/shared/results.ts src/controllers/shared/route-handlers.ts
git commit -m "$(cat <<'EOF'
feat: add Result<T>, Results factory, and RouteHandlers.wrapResult

Shared infrastructure for migrating controller methods off the raw
(req, res) => Promise<void> signature onto (...params, body, query) =>
Promise<Result<ResBody>>, so each method's real inputs and full set of
possible HTTP outcomes are visible in its type. Not yet consumed by any
controller - that starts in the following tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `BookingConflictError` — server-layer outlier fix for `book()`

**Files:**
- Modify: `src/servers/types/sessions.server.types.ts`
- Modify: `src/servers/sessions.server.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BookingConflictError` class (extends `Error`, `public readonly waitlisted: boolean`, message `'Session at capacity'`), exported from `src/servers/types/sessions.server.types.ts`. `SessionsServer.book`'s return type narrows to `Promise<EnrollmentAndCredit | null>` (was `Promise<EnrollmentAndCredit | BookingConflict | null>`). Task 13 (`household/booking/booking.controller.ts`) is the sole consumer.

This task changes `SessionsServer.book`'s behavior for the capacity-conflict case from "return a special value" to "throw" — done here, ahead of the controller migration, so this server-layer change can be verified in isolation first.

- [ ] **Step 1: Read the current state**

Read `src/servers/types/sessions.server.types.ts` and the `book` method in `src/servers/sessions.server.ts` (search for `public async book(`) before editing, to confirm nothing has drifted since this plan was written.

- [ ] **Step 2: Replace `BookingConflict` with `BookingConflictError`**

In `src/servers/types/sessions.server.types.ts`, replace:

```ts
export interface BookingConflict {
	conflict: true;
	waitlisted: false;
}
```

with:

```ts
export class BookingConflictError extends Error {
	public constructor(public readonly waitlisted: boolean = false) {
		super('Session at capacity'); // preserves the exact current message text, not a rewording
		this.name = 'BookingConflictError';
	}
}
```

- [ ] **Step 3: Update `SessionsServer.book`**

In `src/servers/sessions.server.ts`:

Change the import line from:

```ts
import { BookingConflict, PlainSessionNotAllowedError } from './types/sessions.server.types';
```

to:

```ts
import { BookingConflictError, PlainSessionNotAllowedError } from './types/sessions.server.types';
```

Change the method's return type and its conflict branch from:

```ts
	public async book(sessionId: number, studentId: number, householdId: number): Promise<EnrollmentAndCredit | BookingConflict | null> {
```
```ts
		if ((session.currentRosterCount ?? 0) >= session.capacityLimit) {
			// PRD: route to waitlist instead of rejecting outright - not
			// implemented (see waitlist TODOs), so this only reports the
			// capacity conflict for now.
			return { conflict: true, waitlisted: false };
		}
```

to:

```ts
	public async book(sessionId: number, studentId: number, householdId: number): Promise<EnrollmentAndCredit | null> {
```
```ts
		if ((session.currentRosterCount ?? 0) >= session.capacityLimit) {
			// PRD: route to waitlist instead of rejecting outright - not
			// implemented (see waitlist TODOs), so this only reports the
			// capacity conflict for now.
			throw new BookingConflictError();
		}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors in `src/controllers/household/booking/booking.controller.ts` (its current `'conflict' in result` check no longer type-checks against the narrowed return type) — this is expected and fixed in Task 13. No other errors should appear.

- [ ] **Step 5: Confirm the only errors are in `booking.controller.ts`**

Run: `npx tsc --noEmit 2>&1 | grep -v "booking.controller.ts"`
Expected: no output (confirms the only fallout is the one file fixed in Task 13).

- [ ] **Step 6: Commit**

```bash
git add src/servers/types/sessions.server.types.ts src/servers/sessions.server.ts
git commit -m "$(cat <<'EOF'
refactor: SessionsServer.book throws BookingConflictError instead of returning a conflict value

Part of the controller Result<T> migration - every other business-rule
conflict in this codebase is a thrown Error subclass caught by the
controller, this was the only one signaled via a return-value shape.
BookingController.book (Task 13) is updated to catch this in the same
pass that migrates it to the new Result<T> signature; until then,
booking.controller.ts fails to typecheck as an expected, temporary state.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `admin/households/households.controller.ts`

**Files:**
- Modify: `src/controllers/admin/households/households.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2). `HouseholdHasActiveBookingError` (existing, from `../../../servers/types/households.server.types`).
- Produces: nothing consumed elsewhere.

Methods to migrate: `listHouseholds`, `getHouseholdById`, `createHousehold`, `deleteHousehold`, `pauseHousehold`, `resumeHousehold`.

- [ ] **Step 1: Read the current file**

Read `src/controllers/admin/households/households.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

Add alongside the existing imports:

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `listHouseholds`**

Change:

```ts
	private async listHouseholds(_req: Request, res: Response<ListHouseholdsResponse>): Promise<void> {
		const households = await this.householdsServer.listAll();
		res.json(households.map(toPublic));
	}
```

to:

```ts
	private async listHouseholds(_body: unknown, _query: unknown): Promise<Result<ListHouseholdsResponse>> {
		const households = await this.householdsServer.listAll();
		return Results.ok(households.map(toPublic));
	}
```

- [ ] **Step 4: Migrate `getHouseholdById`**

Change:

```ts
	private async getHouseholdById(req: Request<{ id: string }>, res: Response<GetHouseholdDetailsResponse>): Promise<void> {
		const details = await this.householdsServer.getByIdWithDetails(Number(req.params.id));
		if (!details) {
			res.status(404).end();
			return;
		}
		res.json({
			...toPublic(details.household),
			students: details.students.map((student: Student & { enrollments: EnrollmentAndCredit[] }) => ({
				...toPublic(student),
				enrollments: student.enrollments.map(toPublic),
			})),
		});
	}
```

to:

```ts
	private async getHouseholdById(id: string, _body: unknown, _query: unknown): Promise<Result<GetHouseholdDetailsResponse>> {
		const details = await this.householdsServer.getByIdWithDetails(Number(id));
		if (!details) {
			return Results.notFound();
		}
		return Results.ok({
			...toPublic(details.household),
			students: details.students.map((student: Student & { enrollments: EnrollmentAndCredit[] }) => ({
				...toPublic(student),
				enrollments: student.enrollments.map(toPublic),
			})),
		});
	}
```

- [ ] **Step 5: Migrate `createHousehold`**

Change:

```ts
	private async createHousehold(req: Request<unknown, CreateHouseholdResponse | CreateHouseholdValidationErrorResponse, CreateHouseholdBody>, res: Response<CreateHouseholdResponse | CreateHouseholdValidationErrorResponse>): Promise<void> {
		const { name, email } = req.body;
		try {
			const result = await this.householdsServer.create({ name, email });
			res.status(201).json({ household: toPublic(result.household), user: toPublic(result.user) });
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}
```

to:

```ts
	private async createHousehold(body: CreateHouseholdBody, _query: unknown): Promise<Result<CreateHouseholdResponse>> {
		const { name, email } = body;
		try {
			const result = await this.householdsServer.create({ name, email });
			return Results.created({ household: toPublic(result.household), user: toPublic(result.user) });
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

This route has zero path params, so the handler's parameter list is `(body, query)`, not `(_body, body, _query)` — there is no leading `_body` placeholder for a nonexistent path param. (There is also no separate `CreateHouseholdValidationErrorResponse` return type distinction to preserve — `Result<CreateHouseholdResponse>`'s 400 branch already carries `{error, details?}` uniformly.)

- [ ] **Step 6: Migrate `deleteHousehold`**

Change:

```ts
	private async deleteHousehold(req: Request<{ id: string }>, res: Response): Promise<void> {
		try {
			const household = await this.householdsServer.delete(Number(req.params.id));
			if (!household) {
				res.status(404).end();
				return;
			}
			res.status(204).end();
		} catch (error) {
			if (error instanceof HouseholdHasActiveBookingError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}
```

to:

```ts
	private async deleteHousehold(id: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		try {
			const household = await this.householdsServer.delete(Number(id));
			if (!household) {
				return Results.notFound();
			}
			return Results.noContent();
		} catch (error) {
			if (error instanceof HouseholdHasActiveBookingError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}
```

- [ ] **Step 7: Migrate `pauseHousehold`**

Change:

```ts
	private async pauseHousehold(req: Request<{ id: string }, GetHouseholdResponse, PauseHouseholdBody>, res: Response<GetHouseholdResponse>): Promise<void> {
		const pausedUntil = req.body?.pausedUntil ? new Date(req.body.pausedUntil) : null;
		const household = await this.householdsServer.pause(Number(req.params.id), pausedUntil);
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}
```

to:

```ts
	private async pauseHousehold(id: string, body: PauseHouseholdBody, _query: unknown): Promise<Result<GetHouseholdResponse>> {
		const pausedUntil = body?.pausedUntil ? new Date(body.pausedUntil) : null;
		const household = await this.householdsServer.pause(Number(id), pausedUntil);
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
```

- [ ] **Step 8: Migrate `resumeHousehold`**

Change:

```ts
	private async resumeHousehold(req: Request<{ id: string }>, res: Response<GetHouseholdResponse>): Promise<void> {
		const household = await this.householdsServer.resume(Number(req.params.id));
		if (!household) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(household));
	}
```

to:

```ts
	private async resumeHousehold(id: string, _body: unknown, _query: unknown): Promise<Result<GetHouseholdResponse>> {
		const household = await this.householdsServer.resume(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
```

- [ ] **Step 9: Update route registrations**

In the constructor, change each of the 6 routes' `RouteHandlers.wrap(...)` call to `RouteHandlers.wrapResult([...], ...)`:

```ts
this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listHouseholds.bind(this)));
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getHouseholdById.bind(this)));
this.internalRouter.post('/', RouteHandlers.wrapResult([], this.createHousehold.bind(this)));
this.internalRouter.delete('/:id', RouteHandlers.wrapResult(['id'], this.deleteHousehold.bind(this)));
this.internalRouter.post('/:id/pause', RouteHandlers.wrapResult(['id'], this.pauseHousehold.bind(this)));
this.internalRouter.post('/:id/resume', RouteHandlers.wrapResult(['id'], this.resumeHousehold.bind(this)));
```

Keep each call on the same line/position it currently occupies relative to its JSDoc block — only the right-hand side of each `RouteHandlers.wrap(...)` → `RouteHandlers.wrapResult([...], ...)` changes.

- [ ] **Step 10: Remove now-unused `Request`/`Response` import members if applicable**

Check whether `Request`/`Response` from `express` are still used anywhere else in the file (they are not, once all 6 methods are migrated) — if `import { Request, Response } from 'express';` is now fully unused, remove the whole import line. If either is still referenced (it shouldn't be after this migration), keep it.

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 12: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 13: Manually verify against a running dev server**

Start the dev server (`npm run dev` or the project's equivalent — check `package.json` scripts if unsure), then:
- `GET /api/admin/households` → 200 with an array (or empty array), unchanged from before.
- `GET /api/admin/households/999999` (a non-existent id) → 404, empty body.
- `POST /api/admin/households/:id/pause` on a valid id → 200 with the household JSON, unchanged shape.

Stop the dev server when done.

- [ ] **Step 14: Commit**

```bash
git add src/controllers/admin/households/households.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate admin/households controller to Result<T> signatures

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `operator/households/households.controller.ts`

**Files:**
- Modify: `src/controllers/operator/households/households.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2).
- Produces: nothing consumed elsewhere.

Methods to migrate: `listHouseholds`, `getHouseholdById`, `listStudents`, `archiveHousehold`, `restoreHousehold`. The file's 6th route (`/:id/invite-co-household-owner`, `RouteHandlers.notImplemented`) is untouched.

- [ ] **Step 1: Read the current file**

Read `src/controllers/operator/households/households.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `listHouseholds`**

```ts
	private async listHouseholds(_body: unknown, _query: unknown): Promise<Result<ListHouseholdsResponse>> {
		const households = await this.householdsServer.listAll();
		return Results.ok(households.map(toPublic));
	}
```

- [ ] **Step 4: Migrate `getHouseholdById`**

```ts
	private async getHouseholdById(id: string, _body: unknown, _query: unknown): Promise<Result<GetHouseholdResponse>> {
		const household = await this.householdsServer.getById(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
```

- [ ] **Step 5: Migrate `listStudents`**

```ts
	private async listStudents(id: string, _body: unknown, _query: unknown): Promise<Result<ListHouseholdStudentsResponse>> {
		const students = await this.householdsServer.listStudents(Number(id));
		if (!students) {
			return Results.notFound();
		}
		return Results.ok(students.map(toPublic));
	}
```

- [ ] **Step 6: Migrate `archiveHousehold`**

```ts
	private async archiveHousehold(id: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		const household = await this.householdsServer.archive(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.noContent();
	}
```

- [ ] **Step 7: Migrate `restoreHousehold`**

```ts
	private async restoreHousehold(id: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		const household = await this.householdsServer.restore(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.noContent();
	}
```

- [ ] **Step 8: Update route registrations**

```ts
this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listHouseholds.bind(this)));
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getHouseholdById.bind(this)));
this.internalRouter.get('/:id/students', RouteHandlers.wrapResult(['id'], this.listStudents.bind(this)));
this.internalRouter.post('/:id/archive', RouteHandlers.wrapResult(['id'], this.archiveHousehold.bind(this)));
this.internalRouter.post('/:id/restore', RouteHandlers.wrapResult(['id'], this.restoreHousehold.bind(this)));
```

Leave the 6th route (`/:id/invite-co-household-owner`, `RouteHandlers.notImplemented`) exactly as-is.

- [ ] **Step 9: Remove now-unused imports if applicable**

Check whether `Request`/`Response` are still used; remove the import if not.

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 11: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 12: Manually verify**

`GET /api/operator/households` → 200. `POST /api/operator/households/:id/archive` on a valid id → 204, empty body. `POST /api/operator/households/999999/archive` → 404.

- [ ] **Step 13: Commit**

```bash
git add src/controllers/operator/households/households.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate operator/households controller to Result<T> signatures

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `household/households/households.controller.ts`

**Files:**
- Modify: `src/controllers/household/households/households.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2).
- Produces: nothing consumed elsewhere.

Methods to migrate: `getHouseholdById`, `updateHousehold`, `listStudents`, `createStudent`, `updateStudent` (two-param route), `archiveStudent` (two-param route). The file's 2 `notImplemented` routes are untouched.

- [ ] **Step 1: Read the current file**

Read `src/controllers/household/households/households.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `getHouseholdById`**

```ts
	private async getHouseholdById(id: string, _body: unknown, _query: unknown): Promise<Result<GetOwnHouseholdResponse>> {
		const household = await this.householdsServer.getById(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
```

- [ ] **Step 4: Migrate `updateHousehold`**

```ts
	private async updateHousehold(id: string, body: UpdateHouseholdBody, _query: unknown): Promise<Result<UpdateHouseholdResponse>> {
		const { name, email } = body;
		const household = await this.householdsServer.update(Number(id), { name, email });
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
```

- [ ] **Step 5: Migrate `listStudents`**

```ts
	private async listStudents(id: string, _body: unknown, _query: unknown): Promise<Result<ListOwnStudentsResponse>> {
		const students = await this.householdsServer.listStudents(Number(id));
		if (!students) {
			return Results.notFound();
		}
		return Results.ok(students.map(toPublic));
	}
```

- [ ] **Step 6: Migrate `createStudent`**

```ts
	private async createStudent(id: string, body: CreateStudentBody, _query: unknown): Promise<Result<CreateStudentResponse>> {
		const { fullName, dateOfBirth, notes } = body;
		const student = await this.householdsServer.createStudent({
			householdId: Number(id),
			fullName,
			dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
			notes,
		});
		if (!student) {
			return Results.notFound();
		}
		return Results.created(toPublic(student));
	}
```

- [ ] **Step 7: Migrate `updateStudent` (two-param route)**

```ts
	private async updateStudent(_id: string, studentId: string, body: UpdateStudentBody, _query: unknown): Promise<Result<UpdateStudentResponse>> {
		const { fullName, notes } = body;
		const student = await this.householdsServer.updateStudent(Number(studentId), { fullName, notes });
		if (!student) {
			return Results.notFound();
		}
		return Results.ok(toPublic(student));
	}
```

Note: `id` is genuinely unused in the current body (only `studentId` is read) — name it `_id` per the underscore convention, matching the survey's finding that this is already true in the pre-migration code.

- [ ] **Step 8: Migrate `archiveStudent` (two-param route)**

```ts
	private async archiveStudent(_id: string, studentId: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		const student = await this.householdsServer.archiveStudent(Number(studentId));
		if (!student) {
			return Results.notFound();
		}
		return Results.noContent();
	}
```

- [ ] **Step 9: Update route registrations**

```ts
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getHouseholdById.bind(this)));
this.internalRouter.put('/:id', RouteHandlers.wrapResult(['id'], this.updateHousehold.bind(this)));
this.internalRouter.get('/:id/students', RouteHandlers.wrapResult(['id'], this.listStudents.bind(this)));
this.internalRouter.post('/:id/students', RouteHandlers.wrapResult(['id'], this.createStudent.bind(this)));
this.internalRouter.put('/:id/students/:studentId', RouteHandlers.wrapResult(['id', 'studentId'], this.updateStudent.bind(this)));
this.internalRouter.post('/:id/students/:studentId/archive', RouteHandlers.wrapResult(['id', 'studentId'], this.archiveStudent.bind(this)));
```

Leave the 2 `notImplemented` routes exactly as-is.

- [ ] **Step 10: Remove now-unused imports if applicable**

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 12: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 13: Manually verify**

`GET /api/household/households/:id` → 200. `PUT /api/household/households/:id/students/:studentId` with a valid pair → 200 with updated student JSON.

- [ ] **Step 14: Commit**

```bash
git add src/controllers/household/households/households.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate household/households controller to Result<T> signatures

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `household/settings/settings.controller.ts`

**Files:**
- Modify: `src/controllers/household/settings/settings.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2).
- Produces: nothing consumed elsewhere.

Methods to migrate: `getSettings`, `updateSettings`. `updateAvatar` is the file-upload exception — **do not migrate it**; leave its `(req, res)` signature and `RouteHandlers.wrap(...)` registration exactly as they are.

- [ ] **Step 1: Read the current file**

Read `src/controllers/household/settings/settings.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `getSettings`**

```ts
	private async getSettings(id: string, _body: unknown, _query: unknown): Promise<Result<GetHouseholdSettingsResponse>> {
		const household = await this.householdsServer.getById(Number(id));
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
```

- [ ] **Step 4: Migrate `updateSettings`**

```ts
	private async updateSettings(id: string, body: UpdateHouseholdSettingsBody, _query: unknown): Promise<Result<UpdateHouseholdSettingsResponse>> {
		const { name, email } = body;
		const household = await this.householdsServer.update(Number(id), { name, email });
		if (!household) {
			return Results.notFound();
		}
		return Results.ok(toPublic(household));
	}
```

- [ ] **Step 5: Update route registrations for the 2 migrated routes only**

```ts
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getSettings.bind(this)));
this.internalRouter.put('/:id', RouteHandlers.wrapResult(['id'], this.updateSettings.bind(this)));
```

Leave `this.internalRouter.put('/:id/avatar', avatarUpload, RouteHandlers.wrap(this.updateAvatar.bind(this)));` completely untouched.

- [ ] **Step 6: Confirm `Request`/`Response` imports are still needed**

`updateAvatar` still uses `Request`/`Response` directly — do not remove that import.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 8: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 9: Manually verify**

`GET /api/household/settings/:id` → 200. `PUT /api/household/settings/:id/avatar` (multipart) still works unchanged — confirms the file-upload exception wasn't broken by the other edits in this file.

- [ ] **Step 10: Commit**

```bash
git add src/controllers/household/settings/settings.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate household/settings controller to Result<T> signatures

updateAvatar is left on the old (req, res) signature per the design's
documented multipart file-upload exception.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `operator/settings/settings.controller.ts`

**Files:**
- Modify: `src/controllers/operator/settings/settings.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2). `OperatorTimezoneLockedError` (existing, from `../../../servers/types/operators.server.types`).
- Produces: nothing consumed elsewhere.

Methods to migrate: `getSettings`, `updateSettings`. `updateAvatar` is the file-upload exception — **do not migrate it**.

- [ ] **Step 1: Read the current file**

Read `src/controllers/operator/settings/settings.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `getSettings`**

```ts
	private async getSettings(id: string, _body: unknown, _query: unknown): Promise<Result<GetOperatorSettingsResponse>> {
		const operator = await this.operatorsServer.findById(Number(id));
		if (!operator) {
			return Results.notFound();
		}
		return Results.ok(toPublic(operator));
	}
```

- [ ] **Step 4: Migrate `updateSettings`**

```ts
	private async updateSettings(id: string, body: UpdateOperatorSettingsBody, _query: unknown): Promise<Result<UpdateOperatorSettingsResponse>> {
		const { name, email, phone, countryCode, timezone } = body;
		try {
			const operator = await this.operatorsServer.update(Number(id), { name, email, phone, countryCode, timezone }, (operatorId: number) => this.classRepository.existsAnyForOperator(operatorId));
			if (!operator) {
				return Results.notFound();
			}
			return Results.ok(toPublic(operator));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			if (error instanceof OperatorTimezoneLockedError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}
```

(The old signature's response-type union `UpdateOperatorSettingsResponse | UpdateOperatorSettingsValidationErrorResponse | { error: string }` collapses into `Result<UpdateOperatorSettingsResponse>` — `Result`'s own 400/409 branches already carry the validation/conflict error shapes, so those extra type names are no longer needed on the signature. If `UpdateOperatorSettingsValidationErrorResponse` is unused elsewhere after this change, leave its type file alone — deleting unused response type files is out of scope for this plan.)

- [ ] **Step 5: Update route registrations for the 2 migrated routes only**

```ts
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getSettings.bind(this)));
this.internalRouter.put('/:id', RouteHandlers.wrapResult(['id'], this.updateSettings.bind(this)));
```

Leave `this.internalRouter.put('/:id/avatar', avatarUpload, RouteHandlers.wrap(this.updateAvatar.bind(this)));` untouched.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 7: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 8: Manually verify**

`PUT /api/operator/settings/:id` with a `timezone` change on an operator that already has a class → 409 with `{error: "Cannot change timezone once the operator has any class - contact an admin for manual correction"}`, unchanged from before.

- [ ] **Step 9: Commit**

```bash
git add src/controllers/operator/settings/settings.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate operator/settings controller to Result<T> signatures

updateAvatar is left on the old (req, res) signature per the design's
documented multipart file-upload exception.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `admin/operators/operators.controller.ts`

**Files:**
- Modify: `src/controllers/admin/operators/operators.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2). `OperatorHasActiveClassesError`, `OperatorTimezoneLockedError` (existing).
- Produces: nothing consumed elsewhere.

Methods to migrate: `listOperators`, `getOperatorById`, `createOperator`, `updateOperator`, `deleteOperator`, `pauseOperator`, `resumeOperator`, `changeOperatorType`.

- [ ] **Step 1: Read the current file**

Read `src/controllers/admin/operators/operators.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `listOperators`**

```ts
	private async listOperators(_body: unknown, _query: unknown): Promise<Result<ListOperatorsResponse>> {
		const operators = await this.operatorsServer.listAll();
		return Results.ok(operators.map(toPublic));
	}
```

- [ ] **Step 4: Migrate `getOperatorById`**

```ts
	private async getOperatorById(id: string, _body: unknown, _query: unknown): Promise<Result<GetOperatorDetailsResponse>> {
		const details = await this.operatorsServer.getByIdWithDetails(Number(id));
		if (!details) {
			return Results.notFound();
		}
		return Results.ok({
			...toPublic(details.operator),
			sessions: details.sessions.map((session: Session & { enrollments: (EnrollmentAndCredit & { student: Student | null; household: Household | null })[] }) => ({
				...toPublic(session),
				enrollments: session.enrollments.map((enrollment: EnrollmentAndCredit & { student: Student | null; household: Household | null }) => ({
					...toPublic(enrollment),
					student: enrollment.student ? toPublic(enrollment.student) : null,
					household: enrollment.household ? toPublic(enrollment.household) : null,
				})),
			})),
		});
	}
```

- [ ] **Step 5: Migrate `createOperator`**

```ts
	private async createOperator(body: CreateOperatorBody, _query: unknown): Promise<Result<CreateOperatorResponse>> {
		const { name, email, phone, countryCode, type, timezone } = body;
		try {
			const result = await this.operatorsServer.create({ name, email, phone, countryCode, type, timezone });
			return Results.created({ operator: toPublic(result.operator), user: toPublic(result.user) });
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 6: Migrate `updateOperator`**

```ts
	private async updateOperator(id: string, body: UpdateOperatorBody, _query: unknown): Promise<Result<GetOperatorResponse>> {
		const { name, email, phone, countryCode, timezone } = body;
		try {
			const operator = await this.operatorsServer.update(Number(id), { name, email, phone, countryCode, timezone }, (operatorId: number) => this.classRepository.existsAnyForOperator(operatorId));
			if (!operator) {
				return Results.notFound();
			}
			return Results.ok(toPublic(operator));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			if (error instanceof OperatorTimezoneLockedError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}
```

- [ ] **Step 7: Migrate `deleteOperator`**

```ts
	private async deleteOperator(id: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		const operator = await this.operatorsServer.delete(Number(id));
		if (!operator) {
			return Results.notFound();
		}
		return Results.noContent();
	}
```

- [ ] **Step 8: Migrate `pauseOperator`**

```ts
	private async pauseOperator(id: string, body: PauseOperatorBody, _query: unknown): Promise<Result<GetOperatorResponse>> {
		const pausedUntil = body?.pausedUntil ? new Date(body.pausedUntil) : null;
		const operator = await this.operatorsServer.pause(Number(id), pausedUntil);
		if (!operator) {
			return Results.notFound();
		}
		return Results.ok(toPublic(operator));
	}
```

- [ ] **Step 9: Migrate `resumeOperator`**

```ts
	private async resumeOperator(id: string, _body: unknown, _query: unknown): Promise<Result<GetOperatorResponse>> {
		const operator = await this.operatorsServer.resume(Number(id));
		if (!operator) {
			return Results.notFound();
		}
		return Results.ok(toPublic(operator));
	}
```

- [ ] **Step 10: Migrate `changeOperatorType`**

```ts
	private async changeOperatorType(id: string, body: ChangeOperatorTypeBody, _query: unknown): Promise<Result<GetOperatorResponse>> {
		try {
			const operator = await this.operatorsServer.changeType(Number(id), body.type, (operatorId: number) => this.classRepository.existsActiveForOperator(operatorId));
			if (!operator) {
				return Results.notFound();
			}
			return Results.ok(toPublic(operator));
		} catch (error) {
			if (error instanceof OperatorHasActiveClassesError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}
```

- [ ] **Step 11: Update route registrations**

```ts
this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listOperators.bind(this)));
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getOperatorById.bind(this)));
this.internalRouter.post('/', RouteHandlers.wrapResult([], this.createOperator.bind(this)));
this.internalRouter.put('/:id', RouteHandlers.wrapResult(['id'], this.updateOperator.bind(this)));
this.internalRouter.delete('/:id', RouteHandlers.wrapResult(['id'], this.deleteOperator.bind(this)));
this.internalRouter.post('/:id/pause', RouteHandlers.wrapResult(['id'], this.pauseOperator.bind(this)));
this.internalRouter.post('/:id/resume', RouteHandlers.wrapResult(['id'], this.resumeOperator.bind(this)));
this.internalRouter.post('/:id/change-type', RouteHandlers.wrapResult(['id'], this.changeOperatorType.bind(this)));
```

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 13: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 14: Manually verify**

`POST /api/admin/operators/:id/change-type` on an operator with active classes → 409 with `{error: "Cannot change operator type while active classes exist"}`, unchanged from before.

- [ ] **Step 15: Commit**

```bash
git add src/controllers/admin/operators/operators.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate admin/operators controller to Result<T> signatures

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `admin/session-attendance/session-attendance.controller.ts`

**Files:**
- Modify: `src/controllers/admin/session-attendance/session-attendance.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2).
- Produces: nothing consumed elsewhere.

Methods to migrate: `archive` (the file's only real route).

- [ ] **Step 1: Read the current file**

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `archive`**

```ts
	private async archive(_body: unknown, _query: unknown): Promise<Result<ArchiveAttendanceResponse>> {
		const archivedCount = await this.sessionAttendanceServer.archive();
		return Results.ok({ archivedCount });
	}
```

- [ ] **Step 4: Update route registration**

```ts
this.internalRouter.post('/archive', RouteHandlers.wrapResult([], this.archive.bind(this)));
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 7: Manually verify**

`POST /api/admin/session-attendance/archive` → 200 with `{archivedCount: <number>}`.

- [ ] **Step 8: Commit**

```bash
git add src/controllers/admin/session-attendance/session-attendance.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate admin/session-attendance controller to Result<T> signatures

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `household/attendance-credits/attendance-credits.controller.ts` and `operator/attendance-credits/attendance-credits.controller.ts`

**Files:**
- Modify: `src/controllers/household/attendance-credits/attendance-credits.controller.ts`
- Modify: `src/controllers/operator/attendance-credits/attendance-credits.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2).
- Produces: nothing consumed elsewhere.

Two small, closely related files bundled into one task. `operator/attendance-credits`'s 2 `notImplemented` routes are untouched.

- [ ] **Step 1: Read both files**

Read `src/controllers/household/attendance-credits/attendance-credits.controller.ts` and `src/controllers/operator/attendance-credits/attendance-credits.controller.ts` in full before editing either.

- [ ] **Step 2: Migrate `household/attendance-credits/attendance-credits.controller.ts`**

Add imports:

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

Migrate `listCredits`:

```ts
	private async listCredits(householdId: string, _body: unknown, _query: unknown): Promise<Result<ListOwnCreditsResponse>> {
		const credits = await this.attendanceCreditsServer.listCredits(Number(householdId));
		if (!credits) {
			return Results.notFound();
		}
		return Results.ok(credits.map(toPublic));
	}
```

Migrate `cancelEnrollment`:

```ts
	private async cancelEnrollment(enrollmentId: string, _body: unknown, _query: unknown): Promise<Result<CancelEnrollmentResponse>> {
		const updated = await this.attendanceCreditsServer.cancel(Number(enrollmentId));
		if (!updated) {
			return Results.notFound();
		}
		return Results.ok(toPublic(updated));
	}
```

Update route registrations (keep their current order — `cancelEnrollment`'s route is registered first in the constructor):

```ts
this.internalRouter.post('/:enrollmentId/cancel', RouteHandlers.wrapResult(['enrollmentId'], this.cancelEnrollment.bind(this)));
this.internalRouter.get('/households/:householdId/credits', RouteHandlers.wrapResult(['householdId'], this.listCredits.bind(this)));
```

- [ ] **Step 3: Migrate `operator/attendance-credits/attendance-credits.controller.ts`**

Add imports:

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

Migrate `listCreditsBySession`:

```ts
	private async listCreditsBySession(sessionId: string, _body: unknown, _query: unknown): Promise<Result<ListSessionCreditsResponse>> {
		const enrollments = await this.attendanceCreditsServer.listBySession(Number(sessionId));
		if (!enrollments) {
			return Results.notFound();
		}
		return Results.ok(enrollments.map(toPublic));
	}
```

Update its route registration:

```ts
this.internalRouter.get('/session/:sessionId', RouteHandlers.wrapResult(['sessionId'], this.listCreditsBySession.bind(this)));
```

Leave the file's 2 `notImplemented` routes untouched.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 6: Manually verify**

`GET /api/household/attendance-credits/households/:householdId/credits` → 200. `GET /api/operator/attendance-credits/session/:sessionId` → 200.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/household/attendance-credits/attendance-credits.controller.ts src/controllers/operator/attendance-credits/attendance-credits.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate attendance-credits controllers to Result<T> signatures

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `household/billing/billing.controller.ts` and `operator/billing/billing.controller.ts`

**Files:**
- Modify: `src/controllers/household/billing/billing.controller.ts`
- Modify: `src/controllers/operator/billing/billing.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2).
- Produces: nothing consumed elsewhere.

Two files bundled into one task. `operator/billing`'s `listInvoices` is one of the 3 confirmed bare-400-to-message-400 API-improvement endpoints (see Global Constraints / spec Non-goals item 3). Both files' `notImplemented` routes are untouched.

- [ ] **Step 1: Read both files**

Read `src/controllers/household/billing/billing.controller.ts` and `src/controllers/operator/billing/billing.controller.ts` in full before editing either.

- [ ] **Step 2: Migrate `household/billing/billing.controller.ts`**

Add imports:

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

Migrate `listInvoices`:

```ts
	private async listInvoices(householdId: string, _body: unknown, _query: unknown): Promise<Result<ListOwnInvoicesResponse>> {
		const invoices = await this.billingServer.findByHouseholdId(Number(householdId));
		if (!invoices) {
			return Results.notFound();
		}
		return Results.ok(invoices.map(toPublic));
	}
```

Update its route registration:

```ts
this.internalRouter.get('/households/:householdId/invoices', RouteHandlers.wrapResult(['householdId'], this.listInvoices.bind(this)));
```

Leave the file's 3 `notImplemented` routes untouched.

- [ ] **Step 3: Migrate `operator/billing/billing.controller.ts`**

Add imports:

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

Migrate `listInvoices` — **this is one of the 3 confirmed API-improvement endpoints**: the bare `res.status(400).end()` becomes `Results.badRequest('operatorId is required')`:

```ts
	private async listInvoices(_body: unknown, query: ListOperatorInvoicesQuery): Promise<Result<ListOperatorInvoicesResponse>> {
		const operatorId = Number(query.operatorId);
		if (!query.operatorId || Number.isNaN(operatorId)) {
			return Results.badRequest('operatorId is required');
		}

		const invoices = await this.billingServer.findByOperatorId(operatorId);
		if (!invoices) {
			return Results.notFound();
		}
		return Results.ok(invoices.map(toPublic));
	}
```

Migrate `getInvoiceById`:

```ts
	private async getInvoiceById(id: string, _body: unknown, _query: unknown): Promise<Result<GetInvoiceResponse>> {
		const invoice = await this.billingServer.findById(Number(id));
		if (!invoice) {
			return Results.notFound();
		}
		return Results.ok(toPublic(invoice));
	}
```

Migrate `recordOfflinePayment`:

```ts
	private async recordOfflinePayment(id: string, _body: unknown, _query: unknown): Promise<Result<RecordOfflinePaymentResponse>> {
		const invoice = await this.billingServer.recordOfflinePayment(Number(id));
		if (!invoice) {
			return Results.notFound();
		}
		return Results.ok(toPublic(invoice));
	}
```

Update route registrations:

```ts
this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listInvoices.bind(this)));
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getInvoiceById.bind(this)));
this.internalRouter.post('/:id/record-offline-payment', RouteHandlers.wrapResult(['id'], this.recordOfflinePayment.bind(this)));
```

Leave the file's 2 `notImplemented` routes untouched.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 6: Manually verify**

`GET /api/operator/billing` with no `operatorId` query param → 400 with `{error: "operatorId is required"}` (this is the deliberate API-improvement deviation — confirm the body is now present, not empty). `GET /api/operator/billing?operatorId=<valid>` → 200 unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/controllers/household/billing/billing.controller.ts src/controllers/operator/billing/billing.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate billing controllers to Result<T> signatures

operator/billing's listInvoices now returns {error: "operatorId is
required"} instead of an empty 400 body for a missing/invalid operatorId
query param - a confirmed, deliberate small API improvement (see spec
Non-goals item 3), not an oversight.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `household/booking/booking.controller.ts`

**Files:**
- Modify: `src/controllers/household/booking/booking.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2). `BookingConflictError` (Task 3, from `../../../servers/types/sessions.server.types`).
- Produces: nothing consumed elsewhere.

Methods to migrate: `listEnrollments`, `book`. `book` is the confirmed Outlier Fix #1 — its 409 body must remain byte-for-byte `{error: 'Session at capacity', waitlisted: false}`. The file's 3 `notImplemented` routes are untouched.

- [ ] **Step 1: Read the current file**

Read `src/controllers/household/booking/booking.controller.ts` in full before editing. Confirm Task 3 (`BookingConflictError`) is already merged — this task's `book` migration depends on it.

- [ ] **Step 2: Update imports**

Add:

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
import { BookingConflictError } from '../../../servers/types/sessions.server.types';
```

- [ ] **Step 3: Migrate `listEnrollments`**

```ts
	private async listEnrollments(householdId: string, _body: unknown, _query: unknown): Promise<Result<ListOwnEnrollmentsResponse>> {
		const enrollments = await this.sessionsServer.listEnrollments(Number(householdId));
		if (!enrollments) {
			return Results.notFound();
		}
		return Results.ok(enrollments.map(toPublic));
	}
```

- [ ] **Step 4: Migrate `book`**

Change:

```ts
	private async book(req: Request<{ sessionId: string }, BookSessionResponse, BookSessionBody>, res: Response<BookSessionResponse>): Promise<void> {
		const sessionId = Number(req.params.sessionId);
		const { studentId, householdId } = req.body;

		const result = await this.sessionsServer.book(sessionId, studentId, householdId);
		if (!result) {
			res.status(404).end();
			return;
		}
		if ('conflict' in result) {
			res.status(409).json({ error: 'Session at capacity', waitlisted: result.waitlisted });
			return;
		}
		res.status(201).json(toPublic(result));
	}
```

to:

```ts
	private async book(sessionIdParam: string, body: BookSessionBody, _query: unknown): Promise<Result<BookSessionResponse>> {
		const sessionId = Number(sessionIdParam);
		const { studentId, householdId } = body;

		try {
			const result = await this.sessionsServer.book(sessionId, studentId, householdId);
			if (!result) {
				return Results.notFound();
			}
			return Results.created(toPublic(result));
		} catch (error) {
			if (error instanceof BookingConflictError) {
				return Results.conflict(error.message, { waitlisted: error.waitlisted });
			}
			throw error;
		}
	}
```

(The path param is named `sessionIdParam`, not `sessionId`, because the method already needs a local `const sessionId = Number(...)` for the numeric value — this avoids shadowing.)

- [ ] **Step 5: Update route registrations for the 2 migrated routes**

```ts
this.internalRouter.post('/sessions/:sessionId/book', RouteHandlers.wrapResult(['sessionId'], this.book.bind(this)));
this.internalRouter.get('/households/:householdId/enrollments', RouteHandlers.wrapResult(['householdId'], this.listEnrollments.bind(this)));
```

Leave the file's 3 `notImplemented` routes untouched.

- [ ] **Step 6: Remove now-unused imports if applicable**

`Request`/`Response` from `express` should now be fully unused in this file — remove that import line if so.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 8: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 9: Manually verify — this is the critical byte-for-byte check for Outlier Fix #1**

Book a session that's already at capacity (or lower a test session's `capacityLimit` to its current roster count first), then `POST /api/household/booking/sessions/:sessionId/book`:
- Expected status: 409.
- Expected body, exactly: `{"error":"Session at capacity","waitlisted":false}` — confirm there is no `status` field in the body, confirm the message text is exactly `"Session at capacity"` (not `"Session is at capacity"`), and confirm `waitlisted` is present and `false`.

Also verify a normal successful booking still returns 201 with the enrollment JSON, and a booking against a non-existent session/student/household still returns 404.

- [ ] **Step 10: Commit**

```bash
git add src/controllers/household/booking/booking.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate household/booking controller to Result<T> signatures

book() now catches BookingConflictError (introduced in the prior
SessionsServer.book commit) instead of checking a returned conflict
value. Manually verified the 409 response body is byte-for-byte
unchanged: {"error":"Session at capacity","waitlisted":false}.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `operator/sessions/sessions.controller.ts`

**Files:**
- Modify: `src/controllers/operator/sessions/sessions.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2). `PlainSessionNotAllowedError`, `ValidationError` (existing).
- Produces: nothing consumed elsewhere.

Methods to migrate: `listSessions` (one of the 3 confirmed bare-400-to-message API-improvement endpoints), `getSessionById`, `getRoster`, `createSession`, `cancelSession`, `rescheduleSession`, `getAttendance` (multi-step), `recordAttendance` (multi-step).

- [ ] **Step 1: Read the current file**

Read `src/controllers/operator/sessions/sessions.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `listSessions`**

```ts
	private async listSessions(_body: unknown, query: ListSessionsQuery): Promise<Result<ListSessionsResponse>> {
		const operatorId = Number(query.operatorId);
		if (!query.operatorId || Number.isNaN(operatorId)) {
			return Results.badRequest('operatorId is required');
		}

		const sessions = await this.sessionsServer.findByOperatorId(operatorId);
		if (!sessions) {
			return Results.notFound();
		}
		return Results.ok(sessions.map(toPublic));
	}
```

- [ ] **Step 4: Migrate `getSessionById`**

```ts
	private async getSessionById(id: string, _body: unknown, _query: unknown): Promise<Result<GetSessionResponse>> {
		const session = await this.sessionsServer.findById(Number(id));
		if (!session) {
			return Results.notFound();
		}
		return Results.ok(toPublic(session));
	}
```

- [ ] **Step 5: Migrate `getRoster`**

```ts
	private async getRoster(id: string, _body: unknown, _query: unknown): Promise<Result<GetSessionRosterResponse>> {
		const roster = await this.sessionsServer.getRoster(Number(id));
		if (!roster) {
			return Results.notFound();
		}
		return Results.ok({ enrollments: roster.enrollments.map(toPublic), classMemberStudentIds: roster.classMemberStudentIds });
	}
```

- [ ] **Step 6: Migrate `createSession`**

```ts
	private async createSession(body: CreateSessionBody, _query: unknown): Promise<Result<CreateSessionResponse>> {
		const { operatorId, title, startTime, capacityLimit } = body;
		try {
			const session = await this.sessionsServer.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
			if (!session) {
				return Results.notFound();
			}
			return Results.created(toPublic(session));
		} catch (error) {
			if (error instanceof PlainSessionNotAllowedError) {
				return Results.badRequest(error.message);
			}
			throw error;
		}
	}
```

- [ ] **Step 7: Migrate `cancelSession`**

```ts
	private async cancelSession(id: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		const session = await this.sessionsServer.cancel(Number(id));
		if (!session) {
			return Results.notFound();
		}
		return Results.noContent();
	}
```

- [ ] **Step 8: Migrate `rescheduleSession`**

```ts
	private async rescheduleSession(id: string, body: RescheduleSessionBody, _query: unknown): Promise<Result<GetSessionResponse>> {
		try {
			const rescheduled = await this.sessionsServer.reschedule(Number(id), body.startTime);
			if (!rescheduled) {
				return Results.notFound();
			}
			return Results.ok(toPublic(rescheduled));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 9: Migrate `getAttendance` (multi-step orchestration)**

```ts
	// Returns recorded attendance for a true one-off session; 404 if the session itself doesn't exist.
	private async getAttendance(id: string, _body: unknown, _query: unknown): Promise<Result<SessionAttendanceResponse>> {
		const sessionId = Number(id);
		const session = await this.sessionsServer.findById(sessionId);
		if (!session) {
			return Results.notFound();
		}
		const rows = await this.sessionAttendanceServer.findBySessionId(sessionId);
		return Results.ok(rows.map((row: SessionAttendance): SessionAttendanceResponseItem => ({ studentId: row.studentId, status: row.status })));
	}
```

- [ ] **Step 10: Migrate `recordAttendance` (multi-step orchestration)**

```ts
	private async recordAttendance(id: string, body: SessionAttendanceBody, _query: unknown): Promise<Result<SessionAttendanceResponse>> {
		try {
			const result = await this.sessionAttendanceServer.recordForSessionId(Number(id), null, body?.attendance);
			if (!result) {
				return Results.notFound();
			}
			return Results.ok(result.map((row: SessionAttendance): SessionAttendanceResponseItem => ({ studentId: row.studentId, status: row.status })));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 11: Update route registrations**

```ts
this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listSessions.bind(this)));
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getSessionById.bind(this)));
this.internalRouter.get('/:id/roster', RouteHandlers.wrapResult(['id'], this.getRoster.bind(this)));
this.internalRouter.post('/', RouteHandlers.wrapResult([], this.createSession.bind(this)));
this.internalRouter.post('/:id/cancel', RouteHandlers.wrapResult(['id'], this.cancelSession.bind(this)));
this.internalRouter.patch('/:id/reschedule', RouteHandlers.wrapResult(['id'], this.rescheduleSession.bind(this)));
this.internalRouter.get('/:id/attendance', RouteHandlers.wrapResult(['id'], this.getAttendance.bind(this)));
this.internalRouter.put('/:id/attendance', RouteHandlers.wrapResult(['id'], this.recordAttendance.bind(this)));
```

- [ ] **Step 12: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 13: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 14: Manually verify**

`GET /api/operator/sessions` with no `operatorId` → 400 with `{error: "operatorId is required"}` (deliberate deviation, confirm body is now present). `POST /api/operator/sessions` on a schedule-type operator (should be rejected) → 400 with `{error: "Schedule-type operators cannot create plain one-off sessions - use a class instead"}`, unchanged. `PUT /api/operator/sessions/:id/attendance` with a valid body → 200, unchanged.

- [ ] **Step 15: Commit**

```bash
git add src/controllers/operator/sessions/sessions.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate operator/sessions controller to Result<T> signatures

listSessions now returns {error: "operatorId is required"} instead of an
empty 400 body for a missing/invalid operatorId query param - a
confirmed, deliberate small API improvement (see spec Non-goals item 3).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `operator/classes/classes.controller.ts`

**Files:**
- Modify: `src/controllers/operator/classes/classes.controller.ts`
- Delete: `src/controllers/operator/classes/types/create-class-result.type.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2). `ClassHasActiveEnrollmentsError`, `ValidationError`, `ValidationErrorDetail` (existing).
- Produces: a private `isClassIdError(error: ValidationError): boolean` helper method on `ClassesController` (new — this file doesn't have one today). Nothing consumed by other files.

Methods to migrate: `listClasses` (one of the 3 confirmed bare-400 API-improvement endpoints), `getClassById`, `createClass` (Outlier Fix #3 — catch-all AND response-shape change), `updateClass`, `deleteClass`, `stopClass`, `unstopClass`, `assignStudents` (Outlier Fix #2 — extract shared helper), `unassignStudents` (same).

- [ ] **Step 1: Read the current file and confirm `create-class-result.type.ts` has no other importers**

Read `src/controllers/operator/classes/classes.controller.ts` in full before editing.

Run: `grep -rn "create-class-result\|CreateClassResult\|CreateClassSuccessResult\|CreateClassFailureResult" src/`
Expected: only `classes.controller.ts` and `create-class-result.type.ts` itself — confirming it's safe to delete both. If any other file appears, stop and re-scope this task before proceeding (do not delete the type file if something else depends on it).

- [ ] **Step 2: Add the new imports and the `isClassIdError` helper**

Add:

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

Add this private method to the `ClassesController` class (near the other private methods, e.g. just before `listClasses`):

```ts
	// Internal helper, not an exposed route. "Class not found" is the only ValidationError raised once a
	// method's other inputs are well-formed, so a details field of "classId" means 404; anything else is a
	// genuine 400.
	private isClassIdError(error: ValidationError): boolean {
		return error.details.some((detail: ValidationErrorDetail): boolean => detail.field === 'classId');
	}
```

- [ ] **Step 3: Migrate `listClasses`**

```ts
	private async listClasses(_body: unknown, query: { operatorId?: string }): Promise<Result<ListClassesResponse>> {
		const operatorId = Number(query.operatorId);
		if (!query.operatorId || Number.isNaN(operatorId)) {
			return Results.badRequest('operatorId is required');
		}
		const classes = await this.classesServer.listByOperatorId(operatorId);
		if (!classes) {
			return Results.notFound();
		}
		return Results.ok(classes.map(toPublic));
	}
```

- [ ] **Step 4: Migrate `getClassById`**

```ts
	private async getClassById(id: string, _body: unknown, _query: unknown): Promise<Result<GetClassResponse>> {
		const foundClass = await this.classesServer.findById(Number(id));
		if (!foundClass) {
			return Results.notFound();
		}
		return Results.ok(toPublic(foundClass));
	}
```

- [ ] **Step 5: Migrate `createClass` — Outlier Fix #3 (catch-all AND response shape)**

Change:

```ts
	// Creates a new recurring class definition, including atomic student assignment for assigned-type operators.
	private async createClass(req: Request<unknown, CreateClassResult, CreateClassBody>, res: Response<CreateClassResult>): Promise<void> {
		try {
			const created = await this.classesServer.create(req.body);
			res.status(201).json({ success: true, class: toPublic(created) });
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ success: false, error: 'Validation failed', details: error.details });
				return;
			}
			// Any other thrown error (e.g. a raw Postgres error that slipped past application-level validation) is
			// reported as a failed result with a generic message, rather than propagating into the generic 500 handler,
			// so internal error details aren't leaked to the caller.
			res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
		}
	}
```

to:

```ts
	// Creates a new recurring class definition, including atomic student assignment for assigned-type operators.
	private async createClass(body: CreateClassBody, _query: unknown): Promise<Result<ClassMutationResponse>> {
		try {
			const created = await this.classesServer.create(body);
			return Results.created(toPublic(created));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

This is Outlier Fix #3's confirmed, deliberate double change: (a) the catch-all now only handles `ValidationError`, rethrowing anything else to the standard 500 handler instead of masking it as 400; (b) the response body changes from the custom `{success, class}`/`{success, error, details?}` shape to the plain shape every other create endpoint uses.

- [ ] **Step 6: Delete the now-unused `CreateClassResult` type file and its import**

Delete `src/controllers/operator/classes/types/create-class-result.type.ts`.

Remove its import line from `classes.controller.ts` (it currently imports `CreateClassResult` from this file — find and remove that import; do not remove `ClassMutationResponse`'s import, which is a different, already-existing type used by `updateClass`/`stopClass`/`unstopClass`).

- [ ] **Step 7: Migrate `updateClass`**

```ts
	// Updates a class's stored recurring pattern (title, day/time, capacity) - never touches existing sessions.
	private async updateClass(id: string, body: UpdateClassBody, _query: unknown): Promise<Result<ClassMutationResponse>> {
		try {
			const updated = await this.classesServer.update(Number(id), body);
			if (!updated) {
				return Results.notFound();
			}
			return Results.ok(toPublic(updated));
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 8: Migrate `deleteClass`**

```ts
	// Soft-deletes a class; rejected with 409 if it still has active student enrollments.
	private async deleteClass(id: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		try {
			const deleted = await this.classesServer.delete(Number(id));
			if (!deleted) {
				return Results.notFound();
			}
			return Results.noContent();
		} catch (error) {
			if (error instanceof ClassHasActiveEnrollmentsError) {
				return Results.conflict(error.message);
			}
			throw error;
		}
	}
```

- [ ] **Step 9: Migrate `stopClass`**

```ts
	// Stops a class, blocking new derived occurrences past this point; reversible via unstop.
	private async stopClass(id: string, _body: unknown, _query: unknown): Promise<Result<ClassMutationResponse>> {
		const stopped = await this.classesServer.stop(Number(id));
		if (!stopped) {
			return Results.notFound();
		}
		return Results.ok(toPublic(stopped));
	}
```

- [ ] **Step 10: Migrate `unstopClass`**

```ts
	// Reverses a previous stop, resuming derived occurrences.
	private async unstopClass(id: string, _body: unknown, _query: unknown): Promise<Result<ClassMutationResponse>> {
		const unstopped = await this.classesServer.unstop(Number(id));
		if (!unstopped) {
			return Results.notFound();
		}
		return Results.ok(toPublic(unstopped));
	}
```

- [ ] **Step 11: Migrate `assignStudents` — Outlier Fix #2**

```ts
	// Bulk-assigns students to a class's standing roster; each studentId succeeds or fails independently.
	private async assignStudents(id: string, body: AssignStudentsBody, _query: unknown): Promise<Result<AssignStudentsResponse>> {
		try {
			const results = await this.classesServer.assignStudents(Number(id), body.studentIds);
			return Results.ok(
				results.map((result: AssignStudentResult): AssignStudentsResponseItem => (result.success ? { studentId: result.studentId, success: true, enrollment: result.enrollment } : { studentId: result.studentId, success: false, error: result.error })),
			);
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					return Results.notFound();
				}
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 12: Migrate `unassignStudents` — same outlier fix**

```ts
	// Bulk-removes students from a class's standing roster.
	private async unassignStudents(id: string, body: AssignStudentsBody, _query: unknown): Promise<Result<never>> {
		try {
			await this.classesServer.unassignStudents(Number(id), body.studentIds);
			return Results.noContent();
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					return Results.notFound();
				}
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 13: Update route registrations**

```ts
this.internalRouter.get('/', RouteHandlers.wrapResult([], this.listClasses.bind(this)));
this.internalRouter.get('/:id', RouteHandlers.wrapResult(['id'], this.getClassById.bind(this)));
this.internalRouter.post('/', RouteHandlers.wrapResult([], this.createClass.bind(this)));
this.internalRouter.put('/:id', RouteHandlers.wrapResult(['id'], this.updateClass.bind(this)));
this.internalRouter.delete('/:id', RouteHandlers.wrapResult(['id'], this.deleteClass.bind(this)));
this.internalRouter.post('/:id/stop', RouteHandlers.wrapResult(['id'], this.stopClass.bind(this)));
this.internalRouter.post('/:id/unstop', RouteHandlers.wrapResult(['id'], this.unstopClass.bind(this)));
this.internalRouter.post('/:id/assign-students', RouteHandlers.wrapResult(['id'], this.assignStudents.bind(this)));
this.internalRouter.post('/:id/unassign-students', RouteHandlers.wrapResult(['id'], this.unassignStudents.bind(this)));
```

- [ ] **Step 14: Update the route's JSDoc/openapi 201/400 response schema comments for `createClass` if they reference the old shape**

Read the `@openapi` block above `this.internalRouter.post('/', ...)`'s registration (in the constructor) — if its documented 201/400 response schemas reference `CreateClassResult`/`success`/`class` fields, update them to describe the new plain shape (`ClassMutationResponse` on 201, `{error, details?}` on 400), matching how every other create endpoint's JSDoc block already reads. This is the one exception to "swagger/JSDoc comments are never touched" — it applies only here, because the response shape genuinely changed (Outlier Fix #3), and the doc must not describe a shape the endpoint no longer returns.

- [ ] **Step 15: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 16: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 17: Manually verify**

`GET /api/operator/classes` with no `operatorId` → 400 with `{error: "operatorId is required"}`. `POST /api/operator/classes` with valid data → 201 with a plain class object (no `success`/`class` wrapper — confirm this is the new shape). `POST /api/operator/classes` with invalid data → 400 with `{error: "Validation failed", details: [...]}`(no `success` field). `POST /api/operator/classes/:id/assign-students` on a non-existent class id → 404 (confirming the `isClassIdError` remap still works through the new shared helper).

- [ ] **Step 18: Commit**

```bash
git add src/controllers/operator/classes/classes.controller.ts
git rm src/controllers/operator/classes/types/create-class-result.type.ts
git commit -m "$(cat <<'EOF'
refactor: migrate operator/classes controller to Result<T> signatures

createClass's catch-all now only handles ValidationError (anything else
correctly 500s instead of being masked as 400), and its response shape
changes from the custom {success, class} wrapper to the same plain shape
every other create endpoint uses - both confirmed, deliberate changes
(see spec Non-goals). create-class-result.type.ts is deleted as it has
no other importers. assignStudents/unassignStudents gain a shared
isClassIdError helper, replacing their previously-duplicated inline check.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: `operator/classes/class-occurrences.controller.ts`

**Files:**
- Modify: `src/controllers/operator/classes/class-occurrences.controller.ts`

**Interfaces:**
- Consumes: `Result`, `Results`, `RouteHandlers.wrapResult` (Task 2). `ValidationError`, `ValidationErrorDetail`, the existing `isClassIdError` private helper method (unchanged), `Occurrence`, `toOccurrenceResponseItem` module-level helper (unchanged).
- Produces: nothing consumed elsewhere.

Methods to migrate: `listFuture`, `listPast`, `rescheduleOccurrence` (Outlier Fix #2, two-param route), `cancelOccurrence` (two-param route), `recordOccurrenceAttendance` (Outlier Fix #2, multi-step, two-param route), `createMakeupSession` (Outlier Fix #2). This file's existing `isClassIdError` helper and `toOccurrenceResponseItem` module-level function are unchanged — do not modify them, only the methods that call them.

- [ ] **Step 1: Read the current file**

Read `src/controllers/operator/classes/class-occurrences.controller.ts` in full before editing.

- [ ] **Step 2: Add the new imports**

```ts
import { Results } from '../../shared/results';
import { Result } from '../../shared/types/result.type';
```

- [ ] **Step 3: Migrate `listFuture`**

```ts
	// Lists a class's future occurrences (virtual and materialized) in a date range.
	private async listFuture(id: string, _body: unknown, query: ListOccurrencesQuery): Promise<Result<ListOccurrencesResponse>> {
		try {
			const result = await this.classOccurrencesServer.listFuture(Number(id), query.from, query.to);
			if (!result) {
				return Results.notFound();
			}
			return Results.ok({ occurrences: result.occurrences.map(toOccurrenceResponseItem), classMemberStudentIds: result.classMemberStudentIds });
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

(No `isClassIdError` remap here — matches the current behavior exactly, per the survey.)

- [ ] **Step 4: Migrate `listPast`**

```ts
	// Lists a class's past occurrences in a date range, including synthesized not_recorded attendance.
	private async listPast(id: string, _body: unknown, query: ListOccurrencesQuery): Promise<Result<ListOccurrencesResponse>> {
		try {
			const result = await this.classOccurrencesServer.listPast(Number(id), query.from, query.to);
			if (!result) {
				return Results.notFound();
			}
			return Results.ok({ occurrences: result.occurrences.map(toOccurrenceResponseItem), classMemberStudentIds: result.classMemberStudentIds });
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 5: Migrate `rescheduleOccurrence` (two-param route, Outlier Fix #2)**

```ts
	// Reschedules one occurrence to a new startTime, materializing it first if it was still virtual.
	private async rescheduleOccurrence(id: string, date: string, body: RescheduleOccurrenceBody, _query: unknown): Promise<Result<GetSessionResponse>> {
		try {
			const rescheduled = await this.classOccurrencesServer.rescheduleOccurrence(Number(id), date, body?.startTime);
			if (!rescheduled) {
				return Results.notFound();
			}
			return Results.ok(toPublic(rescheduled));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					return Results.notFound();
				}
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 6: Migrate `cancelOccurrence` (two-param route, no remap)**

```ts
	// Cancels one occurrence (materializing it first if needed); re-cancelling an already-cancelled date is an idempotent no-op.
	private async cancelOccurrence(id: string, date: string, _body: unknown, _query: unknown): Promise<Result<never>> {
		try {
			const cancelled = await this.classOccurrencesServer.cancelOccurrence(Number(id), date);
			if (!cancelled) {
				return Results.notFound();
			}
			return Results.noContent();
		} catch (error) {
			if (error instanceof ValidationError) {
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 7: Migrate `recordOccurrenceAttendance` (two-param route, multi-step, Outlier Fix #2)**

```ts
	// Records or corrects attendance for one occurrence (materializing it first if needed); accepts any studentId, including trial students.
	private async recordOccurrenceAttendance(id: string, date: string, body: SessionAttendanceBody, _query: unknown): Promise<Result<SessionAttendanceResponse>> {
		try {
			const classId = Number(id);
			const session = await this.classOccurrencesServer.materializeOccurrence(classId, new Date(`${date}T00:00:00.000Z`));
			// A cancelled date reports as not-found, same reasoning as ClassOccurrencesServer.rescheduleOccurrence:
			// recording attendance against an already-cancelled occurrence would silently succeed on a row that's
			// invisible to every listing (queryActive excludes it), rather than the caller's intent (marking
			// attendance for a real, upcoming/past occurrence) ever taking visible effect.
			if (session.isDeleted) {
				return Results.notFound();
			}
			const result = await this.sessionAttendanceServer.recordForSessionId(session.id, classId, body?.attendance);
			if (!result) {
				return Results.notFound();
			}
			return Results.ok(result.map((row: SessionAttendance): SessionAttendanceResponseItem => ({ studentId: row.studentId, status: row.status })));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					return Results.notFound();
				}
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 8: Migrate `createMakeupSession` (Outlier Fix #2)**

```ts
	// Creates a make-up session tied to this class, with roster auto-filled from its current standing members.
	private async createMakeupSession(id: string, body: MakeupSessionBody, _query: unknown): Promise<Result<GetSessionResponse>> {
		try {
			const session = await this.classOccurrencesServer.createMakeupSession(Number(id), body?.startTime);
			return Results.created(toPublic(session));
		} catch (error) {
			if (error instanceof ValidationError) {
				if (this.isClassIdError(error)) {
					return Results.notFound();
				}
				return Results.validationError(error.details);
			}
			throw error;
		}
	}
```

- [ ] **Step 9: Update route registrations**

```ts
this.internalRouter.get('/:id/occurrences/future', RouteHandlers.wrapResult(['id'], this.listFuture.bind(this)));
this.internalRouter.get('/:id/occurrences/past', RouteHandlers.wrapResult(['id'], this.listPast.bind(this)));
this.internalRouter.patch('/:id/occurrences/:date/reschedule', RouteHandlers.wrapResult(['id', 'date'], this.rescheduleOccurrence.bind(this)));
this.internalRouter.post('/:id/occurrences/:date/cancel', RouteHandlers.wrapResult(['id', 'date'], this.cancelOccurrence.bind(this)));
this.internalRouter.put('/:id/occurrences/:date/attendance', RouteHandlers.wrapResult(['id', 'date'], this.recordOccurrenceAttendance.bind(this)));
this.internalRouter.post('/:id/makeup-session', RouteHandlers.wrapResult(['id'], this.createMakeupSession.bind(this)));
```

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 11: Lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 12: Manually verify**

`GET /api/operator/classes/:id/occurrences/future?from=...&to=...` → 200, unchanged shape. `PATCH /api/operator/classes/999999/occurrences/2026-01-01/reschedule` (non-existent class) → 404 (confirming the `isClassIdError` remap still works). `PUT /api/operator/classes/:id/occurrences/:date/attendance` against an already-cancelled date → 404.

- [ ] **Step 13: Commit**

```bash
git add src/controllers/operator/classes/class-occurrences.controller.ts
git commit -m "$(cat <<'EOF'
refactor: migrate operator/classes/class-occurrences controller to Result<T> signatures

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Final full-repo verification

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: the entire migration (Tasks 1-16).
- Produces: nothing — this is the closing checkpoint confirming the whole migration is internally consistent.

- [ ] **Step 1: Confirm no controller still uses the old signature (except the 2 file-upload exceptions)**

Run: `grep -rln "res: Response" src/controllers/**/*.controller.ts`
Expected: exactly 2 files — `src/controllers/household/settings/settings.controller.ts` and `src/controllers/operator/settings/settings.controller.ts` (each still has exactly one `(req, res)` method, `updateAvatar`). If any other file appears, find and migrate its remaining method(s) before proceeding.

- [ ] **Step 2: Confirm every `RouteHandlers.wrap(` call left in controllers is one of the 2 file-upload routes**

Run: `grep -rn "RouteHandlers.wrap(" src/controllers/**/*.controller.ts`
Expected: exactly 2 matches, both `this.internalRouter.put('/:id/avatar', avatarUpload, RouteHandlers.wrap(this.updateAvatar.bind(this)));` (one per settings controller).

- [ ] **Step 3: Full typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Full lint**

Run: `npx eslint src/`
Expected: no output.

- [ ] **Step 5: Confirm `create-class-result.type.ts` is gone**

Run: `test -f src/controllers/operator/classes/types/create-class-result.type.ts && echo "STILL EXISTS" || echo "deleted"`
Expected: `deleted`.

- [ ] **Step 6: Start the dev server and smoke-test one endpoint per controller file**

Start the dev server, then hit at least one endpoint from each of the 15 migrated controller files (reuse the manual-verification steps already done per-task — this is a final combined pass, not new test cases) to confirm nothing regressed from later tasks' edits interacting with earlier ones. Stop the dev server when done.

- [ ] **Step 7: Review the full diff one more time for the 4 confirmed deviations, and nothing else**

Run: `git log --oneline 5dd03c7..HEAD` (or the equivalent range covering this plan's commits) and re-read the diffs for Tasks 12, 14, 15 (the 3 bare-400 upgrades) and Task 13/3 (`book()`'s preserved body) and Task 15 (`createClass`'s shape change) to confirm exactly these 4 deviations exist and nothing else changed behaviorally.

No commit for this task — it's a verification-only closing checkpoint. If everything above passes, the migration is complete.
