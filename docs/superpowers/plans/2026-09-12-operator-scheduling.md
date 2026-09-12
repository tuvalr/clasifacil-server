# Operator Scheduling (Classes vs. Assigned Sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators be typed `schedule` (recurring weekly classes with a standing student roster) or `assigned` (1:1 one-off or recurring sessions), with class CRUD, occurrence generation, student assignment, single-occurrence overrides, recup sessions, and class pause — all built on the existing `sessions`/`enrollments_and_credits` tables so existing roster/cancellation code keeps working unchanged.

**Architecture:** Two new tables (`classes`, `class_enrollments`) plus two new columns on `sessions` (`class_id`, `is_recup_session`) and one new column on `operators` (`type`). A new `ClassesServer`/`ClassesController` pair (mirroring the existing `HouseholdsServer`/`AdminHouseholdsController` pattern) owns class CRUD, pause, occurrence generation, and student assignment. `SessionsServer`/`SessionsController` gain a reschedule endpoint and a type-gate on plain session create. `OperatorsServer`/`AdminOperatorsController` gain the required `type` field and a change-type endpoint with a guard.

**Tech Stack:** TypeScript, Express 5, Inversify DI, `pg` (raw Postgres client, no ORM), the existing `PostgresHandler`/`EntityQueryHelper` generic CRUD helpers, `swagger-jsdoc` for API docs. No test framework exists in this repo (`package.json`'s `test` script is a placeholder) — this plan does not introduce one, per the spec's Non-goals. Every task's "test" step is `npx tsc --noEmit`, `npx eslint .`, and a manual verification against the real local Postgres DB (via a throwaway Node+`pg` script, the same pattern already used in this repo's session history for schema/data verification), not an automated unit test.

**Spec:** `docs/superpowers/specs/2026-09-12-operator-scheduling-design.md`

## Global Constraints

- No migration tooling exists — every schema change must be hand-applied to the local dev DB (credentials in `.env.local`) via a throwaway `pg` script, AND `docs/db/schema.sql` must be updated in the same task so it stays the source of truth for provisioning new environments.
- No test framework — verify with `npx tsc --noEmit -p .` (must be clean) and `npx eslint .` (must be clean) after every task, plus a manual DB-backed check where the task touches runtime behavior.
- Follow existing conventions exactly: tabs for indentation, `@injectable()` + constructor `@inject(TYPES.X)` DI, `PublicEntity<T>` + `toPublic()` for every response, `RouteHandlers.wrap(...)` for every route handler, `@openapi` JSDoc blocks on every route matching the existing controllers' style, camelCase in TS / snake_case in SQL (handled automatically by `src/utils/case-mapper.ts` — never write column names by hand except in raw SQL).
- `class_enrollments` and any other table without soft-delete does NOT extend `BaseEntity` — model it like `src/entities/audit-log.entity.ts` (plain interface, no `EntityDescriptor`) and access it via `PostgresHandler.query()` directly, never via `queryActive`/`insert`/`update`/`delete` (those assume `is_deleted`/`deleted_at` exist).
- `git commit` messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` per this repo's session convention.

---

### Task 1: Extend `operators` with `type`, add change-type endpoint

**Files:**
- Modify: `src/entities/operator.entity.ts`
- Modify: `src/repositories/operator.repository.ts`
- Modify: `src/servers/operators.server.ts`
- Modify: `src/controllers/admin/operators/types/create-operator-body.type.ts`
- Create: `src/controllers/admin/operators/types/change-operator-type-body.type.ts`
- Modify: `src/controllers/admin/operators/operators.controller.ts`
- Modify: `src/docs/swagger-spec.ts`
- Modify: `docs/db/schema.sql`

**Interfaces:**
- Produces: `Operator.type: 'schedule' | 'assigned'`; `OperatorRepository.updateType(id: number, type: 'schedule' | 'assigned'): Promise<Operator | null>`; `OperatorsServer.changeType(id: number, type: 'schedule' | 'assigned'): Promise<Operator | null>` (throws `OperatorHasActiveClassesError` — this error class is actually defined in Task 2, since it needs the `classes` table to exist; Task 1 defines the endpoint plumbing and a placeholder check against a `ClassRepository` method that Task 2 will add — see Step 6 note).

- [ ] **Step 1: Add `type` to the `Operator` entity**

Edit `src/entities/operator.entity.ts`:

```typescript
import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Operator extends BaseEntity {
	name: string;
	email: string;
	phone: string;
	countryCode: string;
	stripeAccountId: string | null;
	onboardingStatus: string | null;
	status: 'active' | 'paused';
	pausedUntil: Date | null;
	avatarUrl: string | null;
	type: 'schedule' | 'assigned';
}

export const OperatorEntity: EntityDescriptor<Operator> = {
	tableName: 'operators',
};
```

- [ ] **Step 2: Add `type` to `OperatorRepository.create` and a new `updateType` method**

Edit `src/repositories/operator.repository.ts` — update the `create` signature and add `updateType`:

```typescript
	public async create(data: { name: string; email: string; phone: string; countryCode: string; type: 'schedule' | 'assigned' }, tx?: TransactionHandle): Promise<Operator> {
		const db = tx ?? this.db;
		return db.insert(OperatorEntity, { ...data, isDeleted: false });
	}
```

Add directly below the existing `resume` method:

```typescript
	public async updateType(id: number, type: 'schedule' | 'assigned'): Promise<Operator | null> {
		return this.db.update(OperatorEntity, id, { type });
	}
```

- [ ] **Step 3: Run typecheck to confirm the call site in `OperatorsServer.create` now errors on the missing field**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — `Property 'type' is missing in type '{ name: string; ... }'` at the `this.operators.create(...)` call in `src/servers/operators.server.ts`.

- [ ] **Step 4: Update `OperatorsServer.create` and add `changeType`**

Edit `src/servers/operators.server.ts`. Update the `create` method's parameter type and the `this.operators.create(...)` call:

```typescript
	public async create(data: { name: string; email: string; phone: string; countryCode: string; type: 'schedule' | 'assigned' }): Promise<{ operator: Operator; user: User }> {
		const details = await this.validateCreate(data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		const authUid = randomUUID();

		return this.db.transaction(async (transaction: TransactionHandle) => {
			const operator = await this.operators.create({ name: data.name, email: data.email, phone: data.phone, countryCode: data.countryCode, type: data.type }, transaction);
			const user = await this.users.create({ authUid, email: data.email, role: 'operator', associatedEntityId: operator.id }, transaction);
			return { operator, user };
		});
	}
```

Add a `changeType` method after `resume`:

```typescript
	// Blocked while the operator has any active (non-deleted) classes, regardless of pause status — switching
	// scheduling model out from under a live recurring class would orphan its occurrences/roster semantics.
	// hasActiveClasses is injected as a callback (rather than this server depending on ClassesServer directly) to
	// avoid a circular dependency between operators.server.ts and classes.server.ts — Task 2 wires the real check.
	public async changeType(id: number, type: 'schedule' | 'assigned', hasActiveClasses: (operatorId: number) => Promise<boolean>): Promise<Operator | null> {
		const operator = await this.operators.findById(id);
		if (!operator) {
			return null;
		}
		if (await hasActiveClasses(id)) {
			throw new OperatorHasActiveClassesError();
		}
		return this.operators.updateType(id, type);
	}
```

Add the error class near the top of the file, after the imports:

```typescript
export class OperatorHasActiveClassesError extends Error {
	public constructor() {
		super('Cannot change operator type while active classes exist');
		this.name = 'OperatorHasActiveClassesError';
	}
}
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: FAIL — `create-operator-body.type.ts`'s `CreateOperatorBody` doesn't have `type` yet, so the controller's destructure/pass-through will mismatch once Step 6 is done. (If it currently passes, that's because the controller step hasn't been done yet — proceed to Step 6 regardless.)

- [ ] **Step 6: Add `type` to `CreateOperatorBody`, add `ChangeOperatorTypeBody`, wire the controller**

Edit `src/controllers/admin/operators/types/create-operator-body.type.ts`:

```typescript
export interface CreateOperatorBody {
	name: string;
	email: string;
	phone: string;
	countryCode: string;
	type: 'schedule' | 'assigned';
}
```

Create `src/controllers/admin/operators/types/change-operator-type-body.type.ts`:

```typescript
export interface ChangeOperatorTypeBody {
	type: 'schedule' | 'assigned';
}
```

Edit `src/controllers/admin/operators/operators.controller.ts`:
1. Add import: `import { ChangeOperatorTypeBody } from './types/change-operator-type-body.type';`
2. Add import: `import { OperatorHasActiveClassesError } from '../../../servers/operators.server';` (this named export already exists on that module after Step 4; adjust the existing `import { OperatorsServer } from '../../../servers/operators.server';` line to `import { OperatorsServer, OperatorHasActiveClassesError } from '../../../servers/operators.server';` instead of adding a second import line).
3. In `createOperator`, destructure `type` too: `const { name, email, phone, countryCode, type } = req.body;` and pass it: `await this.operatorsServer.create({ name, email, phone, countryCode, type });`
4. Add a new route registration inside the constructor, directly after the existing `/:id/resume` route registration and before the closing of the router-building block:

```typescript
		/**
		 * @openapi
		 * /api/admin/operators/{id}/change-type:
		 *   post:
		 *     summary: Change an operator's scheduling type
		 *     description: >
		 *       Refused (409) while the operator has any active (non-deleted) classes, regardless of pause status —
		 *       clear all classes first.
		 *     tags: [Admin]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [type]
		 *             properties:
		 *               type: { type: string, enum: [schedule, assigned] }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Operator' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       409: { description: 'Operator has active classes' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/change-type', RouteHandlers.wrap(this.changeOperatorType.bind(this)));
```

5. Add the handler method at the end of the class, before the final closing brace:

```typescript
	private async changeOperatorType(req: Request<{ id: string }, GetOperatorResponse, ChangeOperatorTypeBody>, res: Response<GetOperatorResponse>): Promise<void> {
		try {
			// Task 2 replaces this stub with a real check against ClassRepository.existsActiveForOperator once that
			// table/repository exists — for now, always reports "no active classes" so this endpoint is wireable and
			// testable in isolation.
			const operator = await this.operatorsServer.changeType(Number(req.params.id), req.body.type, async () => false);
			if (!operator) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(operator));
		} catch (error) {
			if (error instanceof OperatorHasActiveClassesError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}
```

- [ ] **Step 7: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS (no output).

Run: `npx eslint .`
Expected: PASS (no output).

- [ ] **Step 8: Add `type` to the `Operator` swagger schema**

Edit `src/docs/swagger-spec.ts` — in both the `Operator` and `OperatorDetails` schema objects, add `type: { type: 'string', enum: ['schedule', 'assigned'] },` directly after the `avatarUrl` line in each.

- [ ] **Step 9: Update `docs/db/schema.sql`**

Edit `docs/db/schema.sql` — in the `operators` table's `CREATE TABLE` block, add a new column line directly after `avatar_url TEXT,`:

```sql
	type               VARCHAR(20)              NOT NULL DEFAULT 'schedule',
```

Add a note comment above the `operators` table block (or extend the existing comment block) stating: `-- type has no CHECK constraint at the DB level (validated in the server layer only), matching the households.status column's existing convention in this file.`

- [ ] **Step 10: Apply the schema change to the local dev DB**

Write a throwaway script (e.g. `alter-operators-type-tmp.js` in the repo root, delete it after running) using the `pg` package and the credentials in `.env.local`, following the exact pattern used earlier in this project's history (see any prior `ALTER TABLE` verification for the households `status`/`paused_until` columns for the script shape). The SQL to run:

```sql
ALTER TABLE operators ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'schedule';
```

Verify by querying `SELECT column_name FROM information_schema.columns WHERE table_name = 'operators' AND column_name = 'type'` and confirming one row comes back. Delete the throwaway script afterward.

- [ ] **Step 11: Manual smoke test against the running server**

This step only confirms the code compiles and the route is reachable — full behavioral testing of `change-type`'s 409 happens in Task 2 once `hasActiveClasses` is real. Start the server locally (`npm run local`), then verify with curl or a throwaway script that:
- `POST /api/admin/operators` without `type` in the body now returns a 400 (TypeScript would have caught this at compile time for any internal caller, but this confirms the route itself doesn't silently accept a malformed body since there's no schema-validation middleware in this repo — the missing field will just be `undefined` and fail wherever it's used; confirm the actual behavior and note it, don't assume).
- `POST /api/admin/operators` with `type: 'schedule'` succeeds and the returned operator has `type: 'schedule'`.
- `POST /api/admin/operators/{id}/change-type` with `{ "type": "assigned" }` against that operator succeeds (200, since the stub always reports no active classes).

- [ ] **Step 12: Commit**

```bash
git add src/entities/operator.entity.ts src/repositories/operator.repository.ts src/servers/operators.server.ts src/controllers/admin/operators/types/create-operator-body.type.ts src/controllers/admin/operators/types/change-operator-type-body.type.ts src/controllers/admin/operators/operators.controller.ts src/docs/swagger-spec.ts docs/db/schema.sql
git commit -m "add operator.type (schedule|assigned) and change-type endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `classes` table — entity, repository, server, controller (CRUD + pause/resume)

**Files:**
- Create: `src/entities/class.entity.ts`
- Create: `src/repositories/class.repository.ts`
- Create: `src/servers/classes.server.ts`
- Create: `src/controllers/operator/classes/classes.controller.ts`
- Create: `src/controllers/operator/classes/types/create-class-body.type.ts`
- Create: `src/controllers/operator/classes/types/create-class-response.type.ts`
- Create: `src/controllers/operator/classes/types/get-class-response.type.ts`
- Create: `src/controllers/operator/classes/types/list-classes-response.type.ts`
- Create: `src/controllers/operator/classes/types/update-class-body.type.ts`
- Create: `src/controllers/operator/classes/types/pause-class-body.type.ts`
- Create: `src/controllers/operator/classes/types/class-validation-error-response.type.ts`
- Modify: `src/container/types.ts`
- Modify: `src/container/inversify.config.ts`
- Modify: `src/controllers/operator/operator.controller.ts`
- Modify: `src/servers/operators.server.ts` (wire the real `hasActiveClasses` check)
- Modify: `src/controllers/admin/operators/operators.controller.ts` (wire the real check into `changeOperatorType`)
- Modify: `src/docs/swagger-spec.ts`
- Modify: `docs/db/schema.sql`

**Interfaces:**
- Consumes: `Operator` from Task 1 (for the `type` field, used to validate `maxSize`/`studentId` combinations).
- Produces: `Class` entity (`id, operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize, status, pausedUntil` + `BaseEntity` fields); `ClassRepository.existsActiveForOperator(operatorId: number): Promise<boolean>`; `ClassesServer.create/findById/findByOperatorId/update/delete/pause/resume`; this task does NOT yet implement `generate-occurrences`, `assign-students`, `unassign-students`, or `recup-session` — those are Task 3 and Task 4. `DELETE` in this task only checks `class_enrollments` count, but `class_enrollments` doesn't exist until Task 3 — so this task's delete guard is a stub returning `false` (never blocks), replaced for real in Task 3, mirroring how Task 1 stubbed `hasActiveClasses`.

- [ ] **Step 1: Define the `Class` entity**

Create `src/entities/class.entity.ts`:

```typescript
import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Class extends BaseEntity {
	operatorId: number;
	title: string;
	dayOfWeek: number;
	startTime: string;
	durationMinutes: number;
	minSize: number | null;
	maxSize: number;
	status: 'active' | 'paused';
	pausedUntil: Date | null;
}

export const ClassEntity: EntityDescriptor<Class> = {
	tableName: 'classes',
};
```

Note: `startTime` is typed `string` (not `Date`) because Postgres `TIME` columns come back from `pg` as `HH:MM:SS` strings, not JS Dates — matching how the driver actually behaves, not how `TIMESTAMPTZ` columns behave elsewhere in this codebase.

- [ ] **Step 2: Write the `ClassRepository`**

Create `src/repositories/class.repository.ts`:

```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler, TransactionHandle } from '../handlers/postgres-handler';
import { Class, ClassEntity } from '../entities/class.entity';

@injectable()
export class ClassRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findByOperatorId(operatorId: number): Promise<Class[]> {
		return this.db.queryActive(ClassEntity, 'operator_id = $1', [operatorId]);
	}

	public async findById(id: number): Promise<Class | null> {
		return this.db.findById(ClassEntity, id);
	}

	public async create(
		data: { operatorId: number; title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number },
		tx?: TransactionHandle,
	): Promise<Class> {
		const db = tx ?? this.db;
		return db.insert(ClassEntity, { ...data, isDeleted: false });
	}

	public async update(id: number, data: Partial<{ title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number }>): Promise<Class | null> {
		return this.db.update(ClassEntity, id, data);
	}

	public async pause(id: number, pausedUntil: Date | null): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'paused', pausedUntil });
	}

	public async resume(id: number): Promise<Class | null> {
		return this.db.update(ClassEntity, id, { status: 'active', pausedUntil: null });
	}

	public async archive(id: number): Promise<void> {
		return this.db.delete(ClassEntity, id);
	}

	// Stubbed until Task 3 adds class_enrollments — always reports no active enrollments, so class delete and
	// operator change-type are never blocked yet. Task 3 replaces the query body with a real count against
	// class_enrollments (status = 'active').
	public async existsActiveEnrollments(_classId: number): Promise<boolean> {
		return false;
	}

	public async existsActiveForOperator(operatorId: number): Promise<boolean> {
		const rows = await this.db.queryActive(ClassEntity, 'operator_id = $1', [operatorId]);
		return rows.length > 0;
	}
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS (this file has no other dependents yet).

- [ ] **Step 4: Write `ClassesServer`**

Create `src/servers/classes.server.ts`:

```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { ClassRepository } from '../repositories/class.repository';
import { OperatorRepository } from '../repositories/operator.repository';
import { Class } from '../entities/class.entity';
import { ValidationError, ValidationErrorDetail } from './types/validation-error';

const MAX_DAY_OF_WEEK = 6;

export class ClassHasActiveEnrollmentsError extends Error {
	public constructor() {
		super('Cannot delete a class with active student enrollments');
		this.name = 'ClassHasActiveEnrollmentsError';
	}
}

// UC-Scheduling: recurring weekly classes (schedule-type operators) and recurring 1:1 slots (assigned-type
// operators) share this same table — see docs/superpowers/specs/2026-09-12-operator-scheduling-design.md.
@injectable()
export class ClassesServer {
	public constructor(
		@inject(TYPES.ClassRepository) private readonly classes: ClassRepository,
		@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,
	) {}

	public async listByOperatorId(operatorId: number): Promise<Class[] | null> {
		const operator = await this.operators.findById(operatorId);
		if (!operator) {
			return null;
		}
		return this.classes.findByOperatorId(operatorId);
	}

	public async findById(id: number): Promise<Class | null> {
		return this.classes.findById(id);
	}

	public async create(data: { operatorId: number; title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize?: number; maxSize: number }): Promise<Class> {
		const details = this.validate(data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}
		return this.classes.create({
			operatorId: data.operatorId,
			title: data.title,
			dayOfWeek: data.dayOfWeek,
			startTime: data.startTime,
			durationMinutes: data.durationMinutes,
			minSize: data.minSize ?? null,
			maxSize: data.maxSize,
		});
	}

	public async update(
		id: number,
		data: Partial<{ title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize: number | null; maxSize: number }>,
	): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		const merged = { dayOfWeek: data.dayOfWeek ?? existing.dayOfWeek, durationMinutes: data.durationMinutes ?? existing.durationMinutes, minSize: data.minSize === undefined ? existing.minSize : data.minSize, maxSize: data.maxSize ?? existing.maxSize };
		const details = this.validate(merged);
		if (details.length > 0) {
			throw new ValidationError(details);
		}
		return this.classes.update(id, data);
	}

	// findById first — same reasoning as OperatorsServer.pause(): the repository's UPDATE has no is_deleted guard,
	// so without this check a soft-deleted class would still match and get silently paused/resumed instead of
	// 404ing like every other endpoint.
	public async pause(id: number, pausedUntil: Date | null): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.pause(id, pausedUntil);
	}

	public async resume(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		return this.classes.resume(id);
	}

	public async delete(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		if (await this.classes.existsActiveEnrollments(id)) {
			throw new ClassHasActiveEnrollmentsError();
		}
		await this.classes.archive(id);
		return existing;
	}

	private validate(data: { dayOfWeek: number; durationMinutes: number; minSize: number | null | undefined; maxSize: number }): ValidationErrorDetail[] {
		const details: ValidationErrorDetail[] = [];
		if (data.dayOfWeek < 0 || data.dayOfWeek > MAX_DAY_OF_WEEK) {
			details.push({ field: 'dayOfWeek', message: 'Must be between 0 (Sunday) and 6 (Saturday)' });
		}
		if (data.durationMinutes <= 0) {
			details.push({ field: 'durationMinutes', message: 'Must be greater than 0' });
		}
		if (data.maxSize < 1) {
			details.push({ field: 'maxSize', message: 'Must be at least 1' });
		}
		if (data.minSize != null && data.minSize > data.maxSize) {
			details.push({ field: 'minSize', message: 'Must not be greater than maxSize' });
		}
		return details;
	}
}
```

- [ ] **Step 5: Register `ClassRepository`/`ClassesServer`/`ClassesController` DI symbols**

Edit `src/container/types.ts` — add after `EnrollmentAndCreditRepository`:

```typescript
	ClassRepository: Symbol.for('ClassRepository'),
```

Add after `OperatorsServer`:

```typescript
	ClassesServer: Symbol.for('ClassesServer'),
```

Add after `SessionsController` (checking the actual current line — insert alongside the other operator-scoped controllers, e.g. after `AutopayController`):

```typescript
	ClassesController: Symbol.for('ClassesController'),
```

- [ ] **Step 6: Write `ClassesController`**

Create `src/controllers/operator/classes/types/create-class-body.type.ts`:

```typescript
export interface CreateClassBody {
	operatorId: number;
	title: string;
	dayOfWeek: number;
	startTime: string;
	durationMinutes: number;
	minSize?: number;
	maxSize: number;
}
```

Create `src/controllers/operator/classes/types/create-class-response.type.ts`:

```typescript
import { Class } from '../../../../entities/class.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type CreateClassResponse = PublicEntity<Class>;
```

Create `src/controllers/operator/classes/types/get-class-response.type.ts`:

```typescript
import { Class } from '../../../../entities/class.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type GetClassResponse = PublicEntity<Class>;
```

Create `src/controllers/operator/classes/types/list-classes-response.type.ts`:

```typescript
import { Class } from '../../../../entities/class.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type ListClassesResponse = PublicEntity<Class>[];
```

Create `src/controllers/operator/classes/types/update-class-body.type.ts`:

```typescript
export interface UpdateClassBody {
	title?: string;
	dayOfWeek?: number;
	startTime?: string;
	durationMinutes?: number;
	minSize?: number | null;
	maxSize?: number;
}
```

Create `src/controllers/operator/classes/types/pause-class-body.type.ts`:

```typescript
export interface PauseClassBody {
	pausedUntil?: string;
}
```

Create `src/controllers/operator/classes/types/class-validation-error-response.type.ts`:

```typescript
export interface ClassValidationErrorDetail {
	field: string;
	message: string;
}

export interface ClassValidationErrorResponse {
	error: string;
	details: ClassValidationErrorDetail[];
}
```

Create `src/controllers/operator/classes/classes.controller.ts`:

```typescript
import { Request, Response } from 'express';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../../container/types';
import { ClassesServer, ClassHasActiveEnrollmentsError } from '../../../servers/classes.server';
import { ValidationError } from '../../../servers/types/validation-error';
import { RouteHandlers } from '../../shared/route-handlers';
import { BaseController } from '../../shared/base.controller';
import { ListClassesResponse } from './types/list-classes-response.type';
import { GetClassResponse } from './types/get-class-response.type';
import { CreateClassBody } from './types/create-class-body.type';
import { CreateClassResponse } from './types/create-class-response.type';
import { ClassValidationErrorResponse } from './types/class-validation-error-response.type';
import { UpdateClassBody } from './types/update-class-body.type';
import { PauseClassBody } from './types/pause-class-body.type';
import { toPublic } from '../../../utils/to-public';

@injectable()
export class ClassesController extends BaseController {
	public constructor(@inject(TYPES.ClassesServer) private readonly classesServer: ClassesServer) {
		super();

		/**
		 * @openapi
		 * /api/operator/classes:
		 *   get:
		 *     summary: List classes for an operator
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: query
		 *         name: operatorId
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Class' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Operator not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/', RouteHandlers.wrap(this.listClasses.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}:
		 *   get:
		 *     summary: Get class by ID
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.get('/:id', RouteHandlers.wrap(this.getClassById.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes:
		 *   post:
		 *     summary: Create a recurring class
		 *     description: >
		 *       This task creates the class definition only — occurrence generation, student assignment, and
		 *       recup sessions are separate endpoints (see Task 3/4 of the implementation plan).
		 *     tags: [Operator - Classes]
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [operatorId, title, dayOfWeek, startTime, durationMinutes, maxSize]
		 *             properties:
		 *               operatorId: { type: integer }
		 *               title: { type: string }
		 *               dayOfWeek: { type: integer, minimum: 0, maximum: 6 }
		 *               startTime: { type: string, description: 'HH:MM:SS' }
		 *               durationMinutes: { type: integer }
		 *               minSize: { type: integer, nullable: true }
		 *               maxSize: { type: integer }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400:
		 *         description: Validation failed
		 *         content:
		 *           application/json:
		 *             schema:
		 *               type: object
		 *               properties:
		 *                 error: { type: string }
		 *                 details:
		 *                   type: array
		 *                   items:
		 *                     type: object
		 *                     properties:
		 *                       field: { type: string }
		 *                       message: { type: string }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/', RouteHandlers.wrap(this.createClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}:
		 *   put:
		 *     summary: Update a class's recurring pattern
		 *     description: Never touches already-generated sessions — only affects future generate-occurrences calls.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.put('/:id', RouteHandlers.wrap(this.updateClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}:
		 *   delete:
		 *     summary: Delete a class
		 *     description: Refused (409) while the class has any active student enrollments.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       204: { description: Deleted }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       409: { description: 'Class has active student enrollments' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.delete('/:id', RouteHandlers.wrap(this.deleteClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/pause:
		 *   post:
		 *     summary: Pause a class
		 *     description: Omit pausedUntil (or send null) for an unlimited pause. Blocks new generation/assignment; existing generated sessions are untouched.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             properties:
		 *               pausedUntil: { type: string, format: date-time, nullable: true }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/pause', RouteHandlers.wrap(this.pauseClass.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/resume:
		 *   post:
		 *     summary: Resume a paused class
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Class' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/resume', RouteHandlers.wrap(this.resumeClass.bind(this)));
	}

	private async listClasses(req: Request<unknown, ListClassesResponse, unknown, { operatorId?: string }>, res: Response<ListClassesResponse>): Promise<void> {
		const operatorId = Number(req.query.operatorId);
		if (!req.query.operatorId || Number.isNaN(operatorId)) {
			res.status(400).end();
			return;
		}
		const classes = await this.classesServer.listByOperatorId(operatorId);
		if (!classes) {
			res.status(404).end();
			return;
		}
		res.json(classes.map(toPublic));
	}

	private async getClassById(req: Request<{ id: string }>, res: Response<GetClassResponse>): Promise<void> {
		const foundClass = await this.classesServer.findById(Number(req.params.id));
		if (!foundClass) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(foundClass));
	}

	private async createClass(req: Request<unknown, CreateClassResponse | ClassValidationErrorResponse, CreateClassBody>, res: Response<CreateClassResponse | ClassValidationErrorResponse>): Promise<void> {
		const { operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize } = req.body;
		try {
			const created = await this.classesServer.create({ operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize });
			res.status(201).json(toPublic(created));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async updateClass(req: Request<{ id: string }, GetClassResponse | ClassValidationErrorResponse, UpdateClassBody>, res: Response<GetClassResponse | ClassValidationErrorResponse>): Promise<void> {
		try {
			const updated = await this.classesServer.update(Number(req.params.id), req.body);
			if (!updated) {
				res.status(404).end();
				return;
			}
			res.json(toPublic(updated));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async deleteClass(req: Request<{ id: string }>, res: Response): Promise<void> {
		try {
			const deleted = await this.classesServer.delete(Number(req.params.id));
			if (!deleted) {
				res.status(404).end();
				return;
			}
			res.status(204).end();
		} catch (error) {
			if (error instanceof ClassHasActiveEnrollmentsError) {
				res.status(409).json({ error: error.message });
				return;
			}
			throw error;
		}
	}

	private async pauseClass(req: Request<{ id: string }, GetClassResponse, PauseClassBody>, res: Response<GetClassResponse>): Promise<void> {
		const pausedUntil = req.body?.pausedUntil ? new Date(req.body.pausedUntil) : null;
		const paused = await this.classesServer.pause(Number(req.params.id), pausedUntil);
		if (!paused) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(paused));
	}

	private async resumeClass(req: Request<{ id: string }>, res: Response<GetClassResponse>): Promise<void> {
		const resumed = await this.classesServer.resume(Number(req.params.id));
		if (!resumed) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(resumed));
	}
}
```

- [ ] **Step 7: Wire DI bindings**

Edit `src/container/inversify.config.ts`:
1. Add import after `EnrollmentAndCreditRepository`'s import: `import { ClassRepository } from '../repositories/class.repository';`
2. Add import after `OperatorsServer`'s import: `import { ClassesServer } from '../servers/classes.server';`
3. Add import near the other operator-scoped controller imports: `import { ClassesController } from '../controllers/operator/classes/classes.controller';`
4. Add binding after the `EnrollmentAndCreditRepository` binding: `container.bind<ClassRepository>(TYPES.ClassRepository).to(ClassRepository).inSingletonScope();`
5. Add binding after the `OperatorsServer` binding: `container.bind<ClassesServer>(TYPES.ClassesServer).to(ClassesServer).inSingletonScope();`
6. Add binding after the `AutopayController` binding: `container.bind<ClassesController>(TYPES.ClassesController).to(ClassesController).inSingletonScope();`

Edit `src/controllers/operator/operator.controller.ts` — add the import, constructor injection, and mount:

```typescript
import { ClassesController } from './classes/classes.controller';
```

Add `@inject(TYPES.ClassesController) classesController: ClassesController,` to the constructor parameter list, and `this.internalRouter.use('/classes', classesController.router);` to the constructor body, placed after the existing `sessions` mount line for consistency with the sessions/classes relationship.

- [ ] **Step 8: Wire the real `hasActiveClasses` check into operator change-type**

Edit `src/controllers/admin/operators/operators.controller.ts`:
1. Add import: `import { ClassRepository } from '../../../repositories/class.repository';`
2. Add `@inject(TYPES.ClassRepository) private readonly classRepository: ClassRepository,` to the constructor parameter list.
3. In `changeOperatorType`, replace `async () => false` with `(operatorId: number) => this.classRepository.existsActiveForOperator(operatorId)`.

- [ ] **Step 9: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 10: Add `Class` swagger schema and tag**

Edit `src/docs/swagger-spec.ts`:
1. Add `{ name: 'Operator - Classes' }` to the `tags` array, in alphabetical position among the `Operator - *` tags.
2. Add a `Class` schema object alongside the other schemas:

```typescript
				Class: {
					type: 'object',
					properties: {
						...swaggerBaseFields,
						operatorId: { type: 'integer' },
						title: { type: 'string' },
						dayOfWeek: { type: 'integer' },
						startTime: { type: 'string' },
						durationMinutes: { type: 'integer' },
						minSize: { type: 'integer', nullable: true },
						maxSize: { type: 'integer' },
						status: { type: 'string', enum: ['active', 'paused'] },
						pausedUntil: { type: 'string', format: 'date-time', nullable: true },
					},
				},
```

- [ ] **Step 11: Update `docs/db/schema.sql`**

Add the `classes` table DDL block (copy verbatim from the spec's Data Model section), placed after the `operators` table block and before `households` (since `classes` references `operators`).

- [ ] **Step 12: Apply the schema change to the local dev DB**

Write and run a throwaway `pg` script (delete afterward) creating the `classes` table exactly as specified. Verify with a query against `information_schema.tables` that `classes` now exists, and `information_schema.columns` that all expected columns are present.

- [ ] **Step 13: Manual smoke test**

Start the server locally. Verify:
- `POST /api/operator/classes` with a valid body creates a class and returns 201.
- `GET /api/operator/classes/{id}` returns it.
- `POST /api/operator/classes/{id}/pause` then `GET` shows `status: 'paused'`.
- `POST /api/operator/classes/{id}/resume` then `GET` shows `status: 'active'`.
- `DELETE /api/operator/classes/{id}` succeeds (204) — since `existsActiveEnrollments` is still stubbed to `false` until Task 3.
- Re-run the Task 1 `change-type` smoke test: create a class for an operator, then confirm `POST /api/admin/operators/{id}/change-type` now correctly 409s while that class exists (undeleted), and succeeds after deleting it.

- [ ] **Step 14: Commit**

```bash
git add src/entities/class.entity.ts src/repositories/class.repository.ts src/servers/classes.server.ts src/controllers/operator/classes/ src/container/types.ts src/container/inversify.config.ts src/controllers/operator/operator.controller.ts src/controllers/admin/operators/operators.controller.ts src/docs/swagger-spec.ts docs/db/schema.sql
git commit -m "add classes table, ClassesServer/ClassesController (CRUD, pause/resume)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `class_enrollments` — assign/unassign students, wire real delete/change-type guards

**Files:**
- Create: `src/entities/class-enrollment.entity.ts`
- Create: `src/repositories/class-enrollment.repository.ts`
- Modify: `src/servers/classes.server.ts`
- Modify: `src/repositories/class.repository.ts` (replace the `existsActiveEnrollments` stub)
- Modify: `src/controllers/operator/classes/classes.controller.ts`
- Create: `src/controllers/operator/classes/types/assign-students-body.type.ts`
- Create: `src/controllers/operator/classes/types/assign-students-response.type.ts`
- Modify: `src/container/types.ts`
- Modify: `src/container/inversify.config.ts`
- Modify: `docs/db/schema.sql`

**Interfaces:**
- Consumes: `Class`, `ClassRepository`, `ClassesServer` from Task 2; `Student`/`StudentRepository` (existing).
- Produces: `ClassEnrollment` (`id, classId, studentId, status, createdAt, updatedAt` — no `BaseEntity`, no soft-delete, see Global Constraints); `ClassEnrollmentRepository.findActiveByClassId/countActiveByClassId/findByClassIdAndStudentId/create/reactivate/remove`; `ClassesServer.assignStudents(classId, studentIds: number[]): Promise<AssignStudentResult[]>` where `AssignStudentResult = { studentId: number; success: true; enrollment: ClassEnrollment } | { studentId: number; success: false; error: string }`; `ClassesServer.unassignStudents(classId, studentIds: number[]): Promise<void>`.

- [ ] **Step 1: Define the `ClassEnrollment` type (no `BaseEntity`)**

Create `src/entities/class-enrollment.entity.ts`:

```typescript
// Does not extend BaseEntity — no soft-delete concept here (status: 'active' | 'removed' covers it instead).
// PostgresHandler's delete/unDelete/queryActive/insert/update require BaseEntity's is_deleted/deleted_at columns,
// so they don't apply here by design; use PostgresHandler.query() directly for this table, same as AuditLog.
export interface ClassEnrollment {
	id: number;
	classId: number;
	studentId: number;
	status: 'active' | 'removed';
	createdAt: Date;
	updatedAt: Date;
}
```

- [ ] **Step 2: Write `ClassEnrollmentRepository` using raw queries**

Create `src/repositories/class-enrollment.repository.ts`:

```typescript
import { inject, injectable } from 'inversify';
import { TYPES } from '../container/types';
import { PostgresHandler } from '../handlers/postgres-handler';
import { ClassEnrollment } from '../entities/class-enrollment.entity';
import { snakeToCamel } from '../utils/case-mapper';

@injectable()
export class ClassEnrollmentRepository {
	public constructor(@inject(TYPES.PostgresHandler) private readonly db: PostgresHandler) {}

	public async findActiveByClassId(classId: number): Promise<ClassEnrollment[]> {
		const rows = await this.db.query<Record<string, unknown>>("SELECT * FROM class_enrollments WHERE class_id = $1 AND status = 'active'", [classId]);
		return rows.map((row: Record<string, unknown>) => snakeToCamel<ClassEnrollment>(row));
	}

	public async countActiveByClassId(classId: number): Promise<number> {
		const rows = await this.db.query<{ count: string }>("SELECT COUNT(*) AS count FROM class_enrollments WHERE class_id = $1 AND status = 'active'", [classId]);
		return Number(rows[0]?.count ?? 0);
	}

	public async findByClassIdAndStudentId(classId: number, studentId: number): Promise<ClassEnrollment | null> {
		const rows = await this.db.query<Record<string, unknown>>('SELECT * FROM class_enrollments WHERE class_id = $1 AND student_id = $2', [classId, studentId]);
		return rows[0] ? snakeToCamel<ClassEnrollment>(rows[0]) : null;
	}

	public async create(classId: number, studentId: number): Promise<ClassEnrollment> {
		const rows = await this.db.query<Record<string, unknown>>(
			"INSERT INTO class_enrollments (class_id, student_id, status) VALUES ($1, $2, 'active') RETURNING *",
			[classId, studentId],
		);
		return snakeToCamel<ClassEnrollment>(rows[0]);
	}

	public async setStatus(id: number, status: 'active' | 'removed'): Promise<ClassEnrollment> {
		const rows = await this.db.query<Record<string, unknown>>('UPDATE class_enrollments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [status, id]);
		return snakeToCamel<ClassEnrollment>(rows[0]);
	}
}
```

Note: only `snakeToCamel` is imported (not `camelToSnake`) — this repository builds narrow, hand-written SQL with 1-2 positional params for this table, unlike the generic `EntityQueryHelper.insert`/`update` used elsewhere, so the generic snake-casing helper for arbitrary field maps isn't needed here.

- [ ] **Step 3: Run typecheck and lint to confirm the file compiles standalone**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 4: Register `ClassEnrollmentRepository` in DI**

Edit `src/container/types.ts` — add `ClassEnrollmentRepository: Symbol.for('ClassEnrollmentRepository'),` after `ClassRepository`.

Edit `src/container/inversify.config.ts` — add the import after `ClassRepository`'s import: `import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';`, and the binding after `ClassRepository`'s binding: `container.bind<ClassEnrollmentRepository>(TYPES.ClassEnrollmentRepository).to(ClassEnrollmentRepository).inSingletonScope();`

- [ ] **Step 5: Replace the `existsActiveEnrollments` stub with a real check**

Edit `src/repositories/class.repository.ts` — this method currently lives on `ClassRepository` but needs `ClassEnrollmentRepository` to do real work. Move the check into `ClassesServer` instead (which already depends on both repositories after Step 6) and delete the stub method entirely from `ClassRepository`:

```typescript
	// DELETE this method from class.repository.ts:
	// public async existsActiveEnrollments(_classId: number): Promise<boolean> { return false; }
```

- [ ] **Step 6: Update `ClassesServer` — add `assignStudents`/`unassignStudents`, wire the real delete guard**

Edit `src/servers/classes.server.ts`:
1. Add imports: `import { ClassEnrollmentRepository } from '../repositories/class-enrollment.repository';`, `import { StudentRepository } from '../repositories/student.repository';`, `import { OperatorRepository } from '../repositories/operator.repository';`, `import { ClassEnrollment } from '../entities/class-enrollment.entity';`
2. Add all three to the constructor: `@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,`, `@inject(TYPES.StudentRepository) private readonly students: StudentRepository,`, and `@inject(TYPES.OperatorRepository) private readonly operators: OperatorRepository,` (this last one is pulled forward from what would otherwise be a Task 5 concern, because the delete guard below needs it now — `assigned`-type classes must delete directly, without the active-enrollments check, since their single student is intrinsic to the row per the spec, not a separate precondition. Task 5 will reuse this same injected `operators` field, not re-add it.)
3. Replace the entire `delete` method body:

```typescript
	public async delete(id: number): Promise<Class | null> {
		const existing = await this.classes.findById(id);
		if (!existing) {
			return null;
		}
		const operator = await this.operators.findById(existing.operatorId);
		// assigned-type: the single class_enrollments row is intrinsic to the slot, not a separate precondition —
		// deletes directly. schedule-type: refuse while any active enrollments exist (the guard this method exists for).
		if (operator?.type === 'schedule' && (await this.classEnrollments.countActiveByClassId(id)) > 0) {
			throw new ClassHasActiveEnrollmentsError();
		}
		await this.classes.archive(id);
		return existing;
	}
```

4. Add these two new methods and the result type, after `delete`:

```typescript
export interface AssignStudentSuccess {
	studentId: number;
	success: true;
	enrollment: ClassEnrollment;
}

export interface AssignStudentFailure {
	studentId: number;
	success: false;
	error: string;
}

export type AssignStudentResult = AssignStudentSuccess | AssignStudentFailure;
```

(Place this above the `ClassesServer` class, alongside `ClassHasActiveEnrollmentsError`.)

```typescript
	// Each studentId is evaluated independently and in array order — partial success across the batch, matching
	// the spec's bulk semantics (one bad item doesn't roll back the others). max_size is checked against the
	// current active count as of each item's turn, so submitting more students than remaining capacity fills the
	// slots in submission order and 409s the rest.
	public async assignStudents(classId: number, studentIds: number[]): Promise<AssignStudentResult[]> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}

		const results: AssignStudentResult[] = [];
		for (const studentId of studentIds) {
			// eslint-disable-next-line no-await-in-loop -- intentionally sequential: each iteration's capacity check depends on the previous iteration's insert
			const result = await this.assignOneStudent(foundClass, studentId);
			results.push(result);
		}
		return results;
	}

	private async assignOneStudent(foundClass: Class, studentId: number): Promise<AssignStudentResult> {
		if (foundClass.status === 'paused') {
			return { studentId, success: false, error: 'Class is paused' };
		}

		const student = await this.students.findById(studentId);
		if (!student) {
			return { studentId, success: false, error: 'Student not found' };
		}

		const existing = await this.classEnrollments.findByClassIdAndStudentId(foundClass.id, studentId);
		if (existing && existing.status === 'active') {
			return { studentId, success: false, error: 'Student already assigned to this class' };
		}

		const activeCount = await this.classEnrollments.countActiveByClassId(foundClass.id);
		if (activeCount >= foundClass.maxSize) {
			return { studentId, success: false, error: 'Class is at maxSize' };
		}

		const enrollment = existing ? await this.classEnrollments.setStatus(existing.id, 'active') : await this.classEnrollments.create(foundClass.id, studentId);
		return { studentId, success: true, enrollment };
	}

	public async unassignStudents(classId: number, studentIds: number[]): Promise<void> {
		for (const studentId of studentIds) {
			// eslint-disable-next-line no-await-in-loop -- small bulk operation, sequential is simplest and matches assignStudents' style
			const existing = await this.classEnrollments.findByClassIdAndStudentId(classId, studentId);
			if (existing && existing.status === 'active') {
				// eslint-disable-next-line no-await-in-loop -- see above
				await this.classEnrollments.setStatus(existing.id, 'removed');
			}
		}
	}
```

5. Add `Class` to the imports if not already present (needed for `assignOneStudent`'s parameter type) — it already is, from Task 2's `import { Class } from '../entities/class.entity';`.

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 8: Add controller endpoints for assign/unassign**

Create `src/controllers/operator/classes/types/assign-students-body.type.ts`:

```typescript
export interface AssignStudentsBody {
	studentIds: number[];
}
```

Create `src/controllers/operator/classes/types/assign-students-response.type.ts`:

```typescript
export interface AssignStudentsResponseItem {
	studentId: number;
	success: boolean;
	error?: string;
	enrollment?: { id: number; classId: number; studentId: number; status: 'active' | 'removed' };
}

export type AssignStudentsResponse = AssignStudentsResponseItem[];
```

Edit `src/controllers/operator/classes/classes.controller.ts`:
1. Add imports: `import { AssignStudentsBody } from './types/assign-students-body.type';`, `import { AssignStudentsResponse } from './types/assign-students-response.type';`
2. Add two route registrations in the constructor, after the `/:id/resume` registration:

```typescript
		/**
		 * @openapi
		 * /api/operator/classes/{id}/assign-students:
		 *   post:
		 *     summary: Bulk-assign students to a class's standing roster
		 *     description: >
		 *       Each studentId is evaluated independently — partial success is possible. Not available for
		 *       assigned-type classes (their single student is set at creation).
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [studentIds]
		 *             properties:
		 *               studentIds: { type: array, items: { type: integer } }
		 *     responses:
		 *       200:
		 *         description: Per-studentId results (200 even if some items failed — check each item's success field)
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Class not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/assign-students', RouteHandlers.wrap(this.assignStudents.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/unassign-students:
		 *   post:
		 *     summary: Bulk-unassign students from a class's standing roster
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [studentIds]
		 *             properties:
		 *               studentIds: { type: array, items: { type: integer } }
		 *     responses:
		 *       204: { description: Unassigned }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/unassign-students', RouteHandlers.wrap(this.unassignStudents.bind(this)));
```

3. Add handler methods at the end of the class:

```typescript
	private async assignStudents(req: Request<{ id: string }, AssignStudentsResponse, AssignStudentsBody>, res: Response<AssignStudentsResponse>): Promise<void> {
		try {
			const results = await this.classesServer.assignStudents(Number(req.params.id), req.body.studentIds);
			res.json(
				results.map((result) =>
					result.success ? { studentId: result.studentId, success: true, enrollment: result.enrollment } : { studentId: result.studentId, success: false, error: result.error },
				),
			);
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(404).end();
				return;
			}
			throw error;
		}
	}

	private async unassignStudents(req: Request<{ id: string }, unknown, AssignStudentsBody>, res: Response): Promise<void> {
		await this.classesServer.unassignStudents(Number(req.params.id), req.body.studentIds);
		res.status(204).end();
	}
```

- [ ] **Step 9: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 10: Update `docs/db/schema.sql`**

Add the `class_enrollments` table DDL block (copy verbatim from the spec's Data Model section), placed after `classes` and after `students` (since it references both).

- [ ] **Step 11: Apply the schema change to the local dev DB**

Write and run a throwaway `pg` script (delete afterward) creating `class_enrollments` exactly as specified, including the `UNIQUE (class_id, student_id)` constraint. Verify with a query against `information_schema.tables`/`columns`/`table_constraints`.

- [ ] **Step 12: Manual smoke test**

Start the server locally. Using an existing household/student (or create one via the existing household endpoints) and an existing class:
- `POST /api/operator/classes/{id}/assign-students` with one valid studentId succeeds (200, `success: true`).
- Re-submitting the same studentId returns `success: false, error: 'Student already assigned to this class'`.
- Submitting enough studentIds to exceed the class's `maxSize` shows the excess ones as `success: false, error: 'Class is at maxSize'`.
- `POST /api/operator/classes/{id}/unassign-students` with that studentId, then re-assigning the same student succeeds again (confirms reactivation, not a duplicate-row error).
- `DELETE /api/operator/classes/{id}` while an active enrollment exists now correctly 409s; succeeds after unassigning.
- Re-run Task 1/2's `change-type` guard test end-to-end: create a class, assign a student, confirm `change-type` 409s; unassign and delete the class, confirm `change-type` now succeeds.

- [ ] **Step 13: Commit**

```bash
git add src/entities/class-enrollment.entity.ts src/repositories/class-enrollment.repository.ts src/repositories/class.repository.ts src/servers/classes.server.ts src/controllers/operator/classes/ src/container/types.ts src/container/inversify.config.ts docs/db/schema.sql
git commit -m "add class_enrollments, assign/unassign-students endpoints, wire real delete/change-type guards

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Occurrence generation, session reschedule, recup sessions, plain-session type-gate

**Files:**
- Modify: `src/entities/session.entity.ts`
- Modify: `src/repositories/session.repository.ts`
- Modify: `src/servers/sessions.server.ts`
- Modify: `src/servers/classes.server.ts`
- Modify: `src/controllers/operator/sessions/sessions.controller.ts`
- Modify: `src/controllers/operator/sessions/types/get-session-roster-response.type.ts`
- Create: `src/controllers/operator/sessions/types/reschedule-session-body.type.ts`
- Create: `src/controllers/operator/sessions/types/plain-session-error-response.type.ts`
- Modify: `src/controllers/operator/classes/classes.controller.ts`
- Create: `src/controllers/operator/classes/types/generate-occurrences-body.type.ts`
- Create: `src/controllers/operator/classes/types/generate-occurrences-response.type.ts`
- Create: `src/controllers/operator/classes/types/recup-session-body.type.ts`
- Modify: `src/docs/swagger-spec.ts`
- Modify: `docs/db/schema.sql`

**Interfaces:**
- Consumes: `Class`, `ClassesServer`, `ClassEnrollmentRepository` from Tasks 2-3; `Session`, `SessionsServer`, `EnrollmentAndCreditRepository` (existing).
- Produces: `Session.classId: number | null`, `Session.isRecupSession: boolean`; `SessionRepository.create(...)` gains optional `classId`/`isRecupSession` params (existing method, extended signature, not a new method); `ClassesServer.generateOccurrences(classId, options): Promise<Session[]>`; `ClassesServer.createRecupSession(classId, startTime, studentIds): Promise<Session>`; `SessionsServer.reschedule(sessionId, startTime): Promise<Session | null>`; `SessionsServer.create` gains a type-gate throwing a new `PlainSessionNotAllowedError` for `type='schedule'` operators.

- [ ] **Step 1: Extend the `Session` entity**

Edit `src/entities/session.entity.ts`:

```typescript
import { BaseEntity, EntityDescriptor } from './base.entity';

export interface Session extends BaseEntity {
	operatorId: number;
	title: string;
	startTime: Date;
	capacityLimit: number;
	currentRosterCount: number | null;
	classId: number | null;
	isRecupSession: boolean;
}

export const SessionEntity: EntityDescriptor<Session> = {
	tableName: 'sessions',
};
```

- [ ] **Step 2: Add class-aware create to `SessionRepository`**

Edit `src/repositories/session.repository.ts` — update the existing `create` method's signature to accept the two new optional fields, defaulting them so every existing call site (which doesn't pass them) keeps working:

```typescript
	public async create(data: { operatorId: number; title: string; startTime: Date; capacityLimit: number; classId?: number | null; isRecupSession?: boolean }): Promise<Session> {
		return this.db.insert(SessionEntity, { ...data, classId: data.classId ?? null, isRecupSession: data.isRecupSession ?? false, currentRosterCount: 0, isDeleted: false });
	}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS — the existing `SessionsServer.create` call site doesn't pass `classId`/`isRecupSession`, but they're optional so this compiles unchanged.

- [ ] **Step 4: Add the plain-session type-gate to `SessionsServer`**

Edit `src/servers/sessions.server.ts`:
1. Add import: `import { OperatorRepository } from '../repositories/operator.repository';` — check first whether it's already imported (it is, per the existing constructor); if so, skip this.
2. Add a new error class near the top of the file:

```typescript
export class PlainSessionNotAllowedError extends Error {
	public constructor() {
		super('Schedule-type operators cannot create plain one-off sessions — use a class instead');
		this.name = 'PlainSessionNotAllowedError';
	}
}
```

3. Update the `create` method to check the operator's type before creating:

```typescript
	public async create(data: { operatorId: number; title: string; startTime: Date; capacityLimit: number }): Promise<Session | null> {
		const operator = await this.operators.findById(data.operatorId);
		if (!operator) {
			return null;
		}
		if (operator.type === 'schedule') {
			throw new PlainSessionNotAllowedError();
		}
		return this.sessions.create(data);
	}
```

4. Add a `reschedule` method, placed after `cancel`:

```typescript
	// Single-occurrence override — leaves the class definition and every sibling occurrence untouched. Works on
	// any session (class-generated or plain), same as cancel() already does.
	public async reschedule(sessionId: number, startTime: Date): Promise<Session | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}
		return this.sessions.update(sessionId, { startTime });
	}
```

`SessionRepository.update(id, data: Partial<{ title, startTime, capacityLimit }>)` already exists in the current codebase — `reschedule` above calls it directly, no repository change needed for this step.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 6: Add the reschedule endpoint to `SessionsController`**

Create `src/controllers/operator/sessions/types/reschedule-session-body.type.ts`:

```typescript
export interface RescheduleSessionBody {
	startTime: string;
}
```

Edit `src/controllers/operator/sessions/sessions.controller.ts`:
1. Add import: `import { RescheduleSessionBody } from './types/reschedule-session-body.type';`
2. Add import: `import { PlainSessionNotAllowedError } from '../../../servers/sessions.server';` (merge into the existing `import { SessionsServer } from '../../../servers/sessions.server';` line instead: `import { SessionsServer, PlainSessionNotAllowedError } from '../../../servers/sessions.server';`)
3. Add a route registration after `/:id/cancel`:

```typescript
		/**
		 * @openapi
		 * /api/operator/sessions/{id}/reschedule:
		 *   patch:
		 *     summary: Reschedule a single session occurrence
		 *     description: Leaves the class definition and every other occurrence untouched.
		 *     tags: [Operator - Sessions]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [startTime]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
		 *     responses:
		 *       200:
		 *         description: OK
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       404: { description: Not found }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.patch('/:id/reschedule', RouteHandlers.wrap(this.rescheduleSession.bind(this)));
```

4. Create `src/controllers/operator/sessions/types/plain-session-error-response.type.ts`:

```typescript
export interface PlainSessionErrorResponse {
	error: string;
}
```

5. Update `createSession`'s signature and body to use a union response type (matching the established convention in `src/controllers/admin/operators/operators.controller.ts`'s `createOperator`/`updateOperator`, which use `Response<CreateOperatorResponse | CreateOperatorValidationErrorResponse>` for the same reason: a 400 error body doesn't match the success type). Add the import `import { PlainSessionErrorResponse } from './types/plain-session-error-response.type';`, then replace the method:

```typescript
	private async createSession(req: Request<unknown, CreateSessionResponse | PlainSessionErrorResponse, CreateSessionBody>, res: Response<CreateSessionResponse | PlainSessionErrorResponse>): Promise<void> {
		const { operatorId, title, startTime, capacityLimit } = req.body;
		try {
			const session = await this.sessionsServer.create({ operatorId, title, startTime: new Date(startTime), capacityLimit });
			if (!session) {
				res.status(404).end();
				return;
			}
			res.status(201).json(toPublic(session));
		} catch (error) {
			if (error instanceof PlainSessionNotAllowedError) {
				res.status(400).json({ error: error.message });
				return;
			}
			throw error;
		}
	}
```

6. Add the handler method at the end of the class:

```typescript
	private async rescheduleSession(req: Request<{ id: string }, GetSessionResponse, RescheduleSessionBody>, res: Response<GetSessionResponse>): Promise<void> {
		const rescheduled = await this.sessionsServer.reschedule(Number(req.params.id), new Date(req.body.startTime));
		if (!rescheduled) {
			res.status(404).end();
			return;
		}
		res.json(toPublic(rescheduled));
	}
```

- [ ] **Step 7: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 8: Add occurrence generation and recup-session to `ClassesServer`**

Edit `src/servers/classes.server.ts`:
1. Add imports: `import { SessionRepository } from '../repositories/session.repository';`, `import { EnrollmentAndCreditRepository } from '../repositories/enrollment-and-credit.repository';`, `import { Session } from '../entities/session.entity';`
2. Add both to the constructor: `@inject(TYPES.SessionRepository) private readonly sessions: SessionRepository,`, `@inject(TYPES.EnrollmentAndCreditRepository) private readonly enrollments: EnrollmentAndCreditRepository,`
3. Add a generation cap constant near the top: `const MAX_GENERATED_OCCURRENCES = 104;`
4. Add these two methods after `unassignStudents`:

```typescript
	// Generates concrete `sessions` rows for every occurrence of this class's weekly pattern, starting from the
	// next matching day-of-week on/after today, through either an explicit end date or a fixed count (exactly one
	// of the two is required). Capped at MAX_GENERATED_OCCURRENCES per call to prevent runaway inserts — a larger
	// request is a validation error, not silently truncated.
	public async generateOccurrences(classId: number, options: { through?: Date; count?: number }): Promise<Session[]> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}
		if (foundClass.status === 'paused') {
			throw new ValidationError([{ field: 'classId', message: 'Class is paused' }]);
		}
		if ((options.through == null) === (options.count == null)) {
			throw new ValidationError([{ field: 'generate', message: 'Exactly one of through or count is required' }]);
		}

		const dates = this.computeOccurrenceDates(foundClass.dayOfWeek, foundClass.startTime, options);
		if (dates.length > MAX_GENERATED_OCCURRENCES) {
			throw new ValidationError([{ field: 'generate', message: `Cannot generate more than ${MAX_GENERATED_OCCURRENCES} occurrences per call` }]);
		}

		const created: Session[] = [];
		for (const startTime of dates) {
			// eslint-disable-next-line no-await-in-loop -- bulk-insert of a bounded (<=104), operator-triggered batch; sequential is simplest and this isn't a hot path
			const session = await this.sessions.create({ operatorId: foundClass.operatorId, title: foundClass.title, startTime, capacityLimit: foundClass.maxSize, classId: foundClass.id, isRecupSession: false });
			created.push(session);
		}
		return created;
	}

	// Computes each concrete Date for the class's weekly day/time, starting from the next matching day-of-week
	// on/after now, stopping at either `through` (inclusive) or after `count` occurrences.
	private computeOccurrenceDates(dayOfWeek: number, startTime: string, options: { through?: Date; count?: number }): Date[] {
		const [hours, minutes, seconds] = startTime.split(':').map(Number);
		const dates: Date[] = [];

		const cursor = new Date();
		cursor.setHours(hours, minutes, seconds ?? 0, 0);
		const daysUntilNext = (dayOfWeek - cursor.getDay() + 7) % 7;
		cursor.setDate(cursor.getDate() + daysUntilNext);
		if (cursor.getTime() < Date.now()) {
			cursor.setDate(cursor.getDate() + 7);
		}

		while (true) {
			if (options.through && cursor.getTime() > options.through.getTime()) {
				break;
			}
			if (options.count && dates.length >= options.count) {
				break;
			}
			if (!options.through && !options.count) {
				break;
			}
			dates.push(new Date(cursor));
			cursor.setDate(cursor.getDate() + 7);
			if (dates.length > MAX_GENERATED_OCCURRENCES) {
				break;
			}
		}

		return dates;
	}

	// Recup sessions accept any studentId (not just active class members) — an operator may use a recup slot for
	// a trial student, per the spec. Each student is booked via the existing enrollments_and_credits create path,
	// so cancellation/credit logic downstream treats a recup booking exactly like any other enrollment.
	public async createRecupSession(classId: number, startTime: Date, studentIds: number[]): Promise<Session> {
		const foundClass = await this.classes.findById(classId);
		if (!foundClass) {
			throw new ValidationError([{ field: 'classId', message: 'Class not found' }]);
		}

		const session = await this.sessions.create({ operatorId: foundClass.operatorId, title: `${foundClass.title} (make-up)`, startTime, capacityLimit: foundClass.maxSize, classId: foundClass.id, isRecupSession: true });

		for (const studentId of studentIds) {
			// eslint-disable-next-line no-await-in-loop -- small, bounded list of students for one ad hoc recup session
			await this.enrollments.create({ studentId, sessionId: session.id, householdId: await this.householdIdForStudent(studentId), status: 'booked' });
		}

		return session;
	}

	private async householdIdForStudent(studentId: number): Promise<number> {
		const student = await this.students.findById(studentId);
		if (!student) {
			throw new ValidationError([{ field: 'studentIds', message: `Student ${studentId} not found` }]);
		}
		return student.householdId;
	}
```

- [ ] **Step 9: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 10: Add generate-occurrences and recup-session endpoints to `ClassesController`**

Create `src/controllers/operator/classes/types/generate-occurrences-body.type.ts`:

```typescript
export interface GenerateOccurrencesBody {
	through?: string;
	count?: number;
}
```

Create `src/controllers/operator/classes/types/generate-occurrences-response.type.ts`:

```typescript
import { Session } from '../../../../entities/session.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export type GenerateOccurrencesResponse = PublicEntity<Session>[];
```

Create `src/controllers/operator/classes/types/recup-session-body.type.ts`:

```typescript
export interface RecupSessionBody {
	startTime: string;
	studentIds: number[];
}
```

Edit `src/controllers/operator/classes/classes.controller.ts`:
1. Add imports for the three new types above, plus `import { GetSessionResponse } from '../sessions/types/get-session-response.type';` (reusing the existing session response type for the recup-session endpoint's response) and `import { toPublic } from '../../../utils/to-public';` (already imported).
2. Add two route registrations after `/:id/unassign-students`:

```typescript
		/**
		 * @openapi
		 * /api/operator/classes/{id}/generate-occurrences:
		 *   post:
		 *     summary: Generate concrete session occurrences from a class's recurring pattern
		 *     description: Exactly one of `through` or `count` is required. Capped at 104 occurrences per call.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             properties:
		 *               through: { type: string, format: date }
		 *               count: { type: integer }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { type: array, items: { $ref: '#/components/schemas/Session' } }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/generate-occurrences', RouteHandlers.wrap(this.generateOccurrences.bind(this)));

		/**
		 * @openapi
		 * /api/operator/classes/{id}/recup-session:
		 *   post:
		 *     summary: Create a make-up session tied to this class
		 *     description: Any student id is accepted — not limited to active class members.
		 *     tags: [Operator - Classes]
		 *     parameters:
		 *       - in: path
		 *         name: id
		 *         required: true
		 *         schema: { type: integer }
		 *     requestBody:
		 *       required: true
		 *       content:
		 *         application/json:
		 *           schema:
		 *             type: object
		 *             required: [startTime, studentIds]
		 *             properties:
		 *               startTime: { type: string, format: date-time }
		 *               studentIds: { type: array, items: { type: integer } }
		 *     responses:
		 *       201:
		 *         description: Created
		 *         content:
		 *           application/json:
		 *             schema: { $ref: '#/components/schemas/Session' }
		 *       400: { $ref: '#/components/responses/BadRequest' }
		 *       401: { $ref: '#/components/responses/Unauthorized' }
		 *       500: { $ref: '#/components/responses/InternalError' }
		 */
		this.internalRouter.post('/:id/recup-session', RouteHandlers.wrap(this.createRecupSession.bind(this)));
```

3. Add import: `import { ClassValidationErrorResponse } from './types/class-validation-error-response.type';` (this type already exists from Task 2 — reused here for the same reason `createClass`/`updateClass` in this same file use it: a 400 error body doesn't match the success type, so the handler's `Response<...>` is typed as a union of both, matching this codebase's established convention instead of casting).

4. Add handler methods at the end of the class:

```typescript
	private async generateOccurrences(
		req: Request<{ id: string }, GenerateOccurrencesResponse | ClassValidationErrorResponse, GenerateOccurrencesBody>,
		res: Response<GenerateOccurrencesResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const sessions = await this.classesServer.generateOccurrences(Number(req.params.id), { through: req.body.through ? new Date(req.body.through) : undefined, count: req.body.count });
			res.status(201).json(sessions.map(toPublic));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async createRecupSession(
		req: Request<{ id: string }, GetSessionResponse | ClassValidationErrorResponse, RecupSessionBody>,
		res: Response<GetSessionResponse | ClassValidationErrorResponse>,
	): Promise<void> {
		try {
			const session = await this.classesServer.createRecupSession(Number(req.params.id), new Date(req.body.startTime), req.body.studentIds);
			res.status(201).json(toPublic(session));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}
```

- [ ] **Step 11: Extend `GetSessionRosterResponse` per the spec's roster-resolution rule**

Read `src/controllers/operator/sessions/types/get-session-roster-response.type.ts` first to see its current shape, then edit `SessionsServer.getRoster` (in `src/servers/sessions.server.ts`) to also fetch and return the class's active `class_enrollments` (as a plain student-id list, not full `Student` objects, to keep this task's scope bounded) when the session has a `classId` and is not itself a recup session:

```typescript
	public async getRoster(sessionId: number): Promise<{ enrollments: EnrollmentAndCredit[]; classMemberStudentIds: number[] } | null> {
		const session = await this.sessions.findById(sessionId);
		if (!session) {
			return null;
		}
		const enrollments = await this.enrollments.findBySessionId(sessionId);
		if (!session.classId || session.isRecupSession) {
			return { enrollments, classMemberStudentIds: [] };
		}
		const classEnrollments = await this.classEnrollments.findActiveByClassId(session.classId);
		return { enrollments, classMemberStudentIds: classEnrollments.map((enrollment) => enrollment.studentId) };
	}
```

This requires adding `ClassEnrollmentRepository` as a new constructor dependency of `SessionsServer` — add the import and `@inject(TYPES.ClassEnrollmentRepository) private readonly classEnrollments: ClassEnrollmentRepository,` to its constructor.

Update `GetSessionRosterResponse` (`src/controllers/operator/sessions/types/get-session-roster-response.type.ts`) to match the new shape:

```typescript
import { EnrollmentAndCredit } from '../../../../entities/enrollment-and-credit.entity';
import { PublicEntity } from '../../../../entities/base.entity';

export interface GetSessionRosterResponse {
	enrollments: PublicEntity<EnrollmentAndCredit>[];
	classMemberStudentIds: number[];
}
```

Update `SessionsController.getRoster` to match:

```typescript
	private async getRoster(req: Request<{ id: string }>, res: Response<GetSessionRosterResponse>): Promise<void> {
		const roster = await this.sessionsServer.getRoster(Number(req.params.id));
		if (!roster) {
			res.status(404).end();
			return;
		}
		res.json({ enrollments: roster.enrollments.map(toPublic), classMemberStudentIds: roster.classMemberStudentIds });
	}
```

- [ ] **Step 12: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 13: Add `classId`/`isRecupSession` to the `Session` swagger schema; update the roster response doc**

Edit `src/docs/swagger-spec.ts`:
1. In the `Session` schema, add `classId: { type: 'integer', nullable: true },` and `isRecupSession: { type: 'boolean' },` after `currentRosterCount`.
2. Update the `/api/operator/sessions/{id}/roster` route's `@openapi` response schema (in `sessions.controller.ts`) from `{ type: array, items: ... }` to:

```yaml
 *             schema:
 *               type: object
 *               properties:
 *                 enrollments: { type: array, items: { $ref: '#/components/schemas/EnrollmentAndCredit' } }
 *                 classMemberStudentIds: { type: array, items: { type: integer } }
```

- [ ] **Step 14: Update `docs/db/schema.sql`**

Add the two new `sessions` columns (`class_id`, `is_recup_session`) to the existing `sessions` table DDL block, matching the spec's `ALTER TABLE` verbatim (as new column lines in the `CREATE TABLE` block, plus the FK).

- [ ] **Step 15: Apply the schema change to the local dev DB**

Write and run a throwaway `pg` script (delete afterward):

```sql
ALTER TABLE sessions
	ADD COLUMN IF NOT EXISTS class_id BIGINT REFERENCES classes (id) ON DELETE CASCADE,
	ADD COLUMN IF NOT EXISTS is_recup_session BOOLEAN NOT NULL DEFAULT FALSE;
```

Verify with `information_schema.columns`.

- [ ] **Step 16: Manual smoke test — the full flow end to end**

Start the server locally. Using a `schedule`-type operator with a class:
- `POST /api/operator/classes/{id}/generate-occurrences` with `{ "count": 4 }` creates 4 `sessions` rows on the correct weekday, all with `classId` set and `capacityLimit` = the class's `maxSize`.
- `GET /api/operator/sessions?operatorId=` lists them.
- `PATCH /api/operator/sessions/{sessionId}/reschedule` with a new `startTime` moves just that one session; the other 3 and the class are unaffected (`GET` the class and the other sessions to confirm).
- `POST /api/operator/sessions/{sessionId}/cancel` on a different one of the 4 still works exactly as before (skip semantics unchanged).
- `POST /api/operator/classes/{id}/recup-session` with a student not assigned to the class succeeds, creating a session with `isRecupSession: true`.
- `GET /api/operator/sessions/{recupSessionId}/roster` shows only the explicitly-booked student in `enrollments`, and an empty `classMemberStudentIds` (recup exclusion rule).
- `GET /api/operator/sessions/{normalOccurrenceId}/roster` shows the class's assigned students in `classMemberStudentIds`.
- `POST /api/operator/sessions` (plain create) against the `schedule`-type operator now 400s; against an `assigned`-type operator still succeeds as before.

- [ ] **Step 17: Commit**

```bash
git add src/entities/session.entity.ts src/repositories/session.repository.ts src/servers/sessions.server.ts src/servers/classes.server.ts src/controllers/operator/sessions/ src/controllers/operator/classes/ src/docs/swagger-spec.ts docs/db/schema.sql
git commit -m "add occurrence generation, session reschedule, recup sessions, plain-session type-gate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Assigned-type recurring 1:1 slots (class create with atomic student assignment)

**Files:**
- Modify: `src/servers/classes.server.ts`
- Modify: `src/controllers/operator/classes/classes.controller.ts`
- Modify: `src/controllers/operator/classes/types/create-class-body.type.ts`

**Interfaces:**
- Consumes: everything from Tasks 2-4.
- Produces: `ClassesServer.create` gains type-aware validation (requires `studentId` + forces `maxSize=1` for `assigned`-type operators; forbids `studentId` for `schedule`-type).

- [ ] **Step 1: Extend `CreateClassBody` with an optional `studentId`**

Edit `src/controllers/operator/classes/types/create-class-body.type.ts`:

```typescript
export interface CreateClassBody {
	operatorId: number;
	title: string;
	dayOfWeek: number;
	startTime: string;
	durationMinutes: number;
	minSize?: number;
	maxSize: number;
	studentId?: number;
}
```

- [ ] **Step 2: Update `ClassesServer.create` to branch on operator type**

Edit `src/servers/classes.server.ts`. `OperatorRepository` and `StudentRepository` are already constructor dependencies as of Task 3 Step 6 — no new DI wiring needed here, just use `this.operators`/`this.students` directly.

Replace the `create` method:

```typescript
	public async create(data: { operatorId: number; title: string; dayOfWeek: number; startTime: string; durationMinutes: number; minSize?: number; maxSize: number; studentId?: number }): Promise<Class> {
		const operator = await this.operators.findById(data.operatorId);
		if (!operator) {
			throw new ValidationError([{ field: 'operatorId', message: 'Operator not found' }]);
		}

		if (operator.type === 'assigned') {
			if (data.studentId == null) {
				throw new ValidationError([{ field: 'studentId', message: 'studentId is required for assigned-type operators' }]);
			}
			if (data.maxSize !== 1) {
				throw new ValidationError([{ field: 'maxSize', message: 'Must be 1 for assigned-type operators' }]);
			}
			const student = await this.students.findById(data.studentId);
			if (!student) {
				throw new ValidationError([{ field: 'studentId', message: 'Student not found' }]);
			}
		} else if (data.studentId != null) {
			throw new ValidationError([{ field: 'studentId', message: 'studentId is only accepted for assigned-type operators — use assign-students instead' }]);
		}

		const details = this.validate(data);
		if (details.length > 0) {
			throw new ValidationError(details);
		}

		const created = await this.classes.create({
			operatorId: data.operatorId,
			title: data.title,
			dayOfWeek: data.dayOfWeek,
			startTime: data.startTime,
			durationMinutes: data.durationMinutes,
			minSize: data.minSize ?? null,
			maxSize: data.maxSize,
		});

		if (data.studentId != null) {
			await this.classEnrollments.create(created.id, data.studentId);
		}

		return created;
	}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

- [ ] **Step 4: Update the controller to pass `studentId` through**

Edit `src/controllers/operator/classes/classes.controller.ts` — in `createClass`, destructure and pass `studentId`:

```typescript
	private async createClass(req: Request<unknown, CreateClassResponse | ClassValidationErrorResponse, CreateClassBody>, res: Response<CreateClassResponse | ClassValidationErrorResponse>): Promise<void> {
		const { operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize, studentId } = req.body;
		try {
			const created = await this.classesServer.create({ operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize, studentId });
			res.status(201).json(toPublic(created));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}
```

- [ ] **Step 5: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 6: Update the `POST /api/operator/classes` swagger doc**

Edit the `@openapi` block for `POST /` in `classes.controller.ts` to add `studentId: { type: integer, description: 'Required for assigned-type operators; forbidden otherwise' }` to the request body's `properties`, and a note in the `description` field that `maxSize` must be 1 and `studentId` required when the operator is `assigned`-type.

- [ ] **Step 7: Manual smoke test**

Start the server locally, using an `assigned`-type operator and an existing student:
- `POST /api/operator/classes` with `studentId` set and `maxSize: 1` succeeds, and a `GET` on the class's roster (via `assign-students` idempotency check, or directly querying `class_enrollments` through a throwaway script) shows the one student already active.
- The same request with `maxSize: 2` 400s (`"Must be 1 for assigned-type operators"`).
- The same request without `studentId` 400s.
- The same request against a `schedule`-type operator, with `studentId` included, 400s (`"studentId is only accepted for assigned-type operators..."`).
- `DELETE` on that assigned-type class (which has exactly one active `class_enrollments` row) succeeds directly with 204, not a 409 — this confirms the operator-type branch added to `ClassesServer.delete` back in Task 3 Step 6 is working: `schedule`-type classes are blocked by an active-enrollments count, `assigned`-type classes are not.

- [ ] **Step 8: Commit**

```bash
git add src/servers/classes.server.ts src/controllers/operator/classes/classes.controller.ts src/controllers/operator/classes/types/create-class-body.type.ts
git commit -m "support assigned-type recurring 1:1 class creation with atomic student assignment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Bulk class creation

**Files:**
- Modify: `src/controllers/operator/classes/classes.controller.ts`
- Modify: `src/controllers/operator/classes/types/create-class-response.type.ts` (or add a new bulk-specific response type)

**Interfaces:**
- Consumes: `ClassesServer.create` from Tasks 2/5 (unchanged — bulk is purely a controller-level fan-out, no new server method needed since each item is independently validated by the existing `create`).
- Produces: `POST /api/operator/classes` now accepts either a single object or an array; array requests return one per-item result (success/error) instead of a single object.

- [ ] **Step 1: Add a bulk-result response type**

Create `src/controllers/operator/classes/types/create-class-result.type.ts`:

```typescript
import { Class } from '../../../../entities/class.entity';
import { PublicEntity } from '../../../../entities/base.entity';
import { ClassValidationErrorDetail } from './class-validation-error-response.type';

export interface CreateClassSuccessResult {
	success: true;
	class: PublicEntity<Class>;
}

export interface CreateClassFailureResult {
	success: false;
	error: string;
	details?: ClassValidationErrorDetail[];
}

export type CreateClassResult = CreateClassSuccessResult | CreateClassFailureResult;
```

- [ ] **Step 2: Update `createClass` to detect array vs. single-object bodies**

Edit `src/controllers/operator/classes/classes.controller.ts`:
1. Add import: `import { CreateClassResult } from './types/create-class-result.type';`
2. Replace the `createClass` handler:

```typescript
	private async createClass(
		req: Request<unknown, CreateClassResponse | ClassValidationErrorResponse | CreateClassResult[], CreateClassBody | CreateClassBody[]>,
		res: Response<CreateClassResponse | ClassValidationErrorResponse | CreateClassResult[]>,
	): Promise<void> {
		if (Array.isArray(req.body)) {
			const results: CreateClassResult[] = [];
			for (const item of req.body) {
				// eslint-disable-next-line no-await-in-loop -- bulk create, one operator-triggered batch — sequential keeps per-item error handling simple and this isn't a hot path
				results.push(await this.createOneClass(item));
			}
			res.status(201).json(results);
			return;
		}

		const { operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize, studentId } = req.body;
		try {
			const created = await this.classesServer.create({ operatorId, title, dayOfWeek, startTime, durationMinutes, minSize, maxSize, studentId });
			res.status(201).json(toPublic(created));
		} catch (error) {
			if (error instanceof ValidationError) {
				res.status(400).json({ error: 'Validation failed', details: error.details });
				return;
			}
			throw error;
		}
	}

	private async createOneClass(body: CreateClassBody): Promise<CreateClassResult> {
		try {
			const created = await this.classesServer.create(body);
			return { success: true, class: toPublic(created) };
		} catch (error) {
			if (error instanceof ValidationError) {
				return { success: false, error: 'Validation failed', details: error.details };
			}
			throw error;
		}
	}
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npx tsc --noEmit -p .`
Expected: PASS.

Run: `npx eslint .`
Expected: PASS.

- [ ] **Step 4: Update the `POST /api/operator/classes` swagger doc for the bulk case**

Edit the `@openapi` block for `POST /` in `classes.controller.ts` — change `requestBody.content['application/json'].schema` to a `oneOf` covering both a single class object and an array of them, and add a note in `description`: "Accepts a single class object or an array for bulk creation (satisfies bulk class definitions in one call). Array requests return one per-item success/error result instead of a single class object — partial success is possible."

- [ ] **Step 5: Manual smoke test**

Start the server locally:
- `POST /api/operator/classes` with a single object body still returns a single `Class` object (201), unchanged from before.
- `POST /api/operator/classes` with an array of 3 class bodies, one of which is invalid (e.g. `dayOfWeek: 9`), returns 201 with an array of 3 results — 2 with `success: true`, 1 with `success: false` and the validation details.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/operator/classes/classes.controller.ts src/controllers/operator/classes/types/create-class-result.type.ts
git commit -m "support bulk class creation in one API call

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Deferred / explicitly out of scope (per spec)

- Household-side booking restrictions against class-generated sessions — user will define separately.
- Reassigning an `assigned`-type class's student (Open Question in the spec) — no endpoint built; delete-and-recreate is the only path today.
- Waitlist integration, automatic credit issuance on class pause/session skip, background job for rolling generation — all explicitly out of scope per the spec's Non-goals.
