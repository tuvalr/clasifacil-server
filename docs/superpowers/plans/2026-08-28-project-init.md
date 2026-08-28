# Project Initialization: Inversify Express Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `clasifacil-server` with a booting Express app wired
through Inversify's IoC container, three-environment config
(dev/local/prod), and a layer-based `src/` structure ready for
controllers/services/repositories to be added later.

**Architecture:** Plain Express 5 app (no `inversify-express-utils`,
since it's incompatible with the installed `inversify@^8`), with a
hand-written env loader/validator and an empty Inversify `Container`
wired up in `index.ts`. No controllers exist yet — only placeholder
directories and a comment marking where future routers mount.

**Tech Stack:** TypeScript, Express 5, Inversify 8, reflect-metadata,
dotenv, helmet, cors, ts-node.

**Spec:** [docs/superpowers/specs/2026-08-28-project-init-design.md](../specs/2026-08-28-project-init-design.md)

## Global Constraints

- `NODE_ENV` must be one of `dev`, `local`, `prod` — these select
  `.env.dev` / `.env.local` / `.env.prod` respectively.
- `inversify-express-utils` is NOT a dependency — controllers are wired
  manually against a plain Express `Router` (see spec's "App wiring").
- `inversify` stays at its currently installed `^8.2.3` — do not
  downgrade it.
- Express is v5 (`^5.2.1`), not v4.
- `.env.dev`, `.env.local`, `.env.prod` are gitignored; `.env.example`
  is committed.
- `dist/` is gitignored (build output, not committed).
- No automated tests are written in this plan — there is no behavior
  yet beyond "the server boots," which is verified manually per task.
- No push to the git remote — local commits only.

---

### Task 1: Install runtime and dev dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (via npm)

**Interfaces:**
- Produces: `express`, `reflect-metadata`, `helmet`, `cors` in
  `dependencies`; `@types/express`, `@types/cors` in `devDependencies`,
  available for all later tasks to import.

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
npm install express@^5.2.1 reflect-metadata@^0.2.2 helmet@^8.3.0 cors@^2.8.6
```

- [ ] **Step 2: Install dev dependency type packages**

Run:
```bash
npm install --save-dev @types/express@^5.0.6 @types/cors@^2.8.19
```

- [ ] **Step 3: Verify install**

Run: `npm ls express inversify reflect-metadata helmet cors --depth=0`
Expected: all five packages listed with no `UNMET PEER DEPENDENCY`
errors related to them (pre-existing unrelated peer warnings from
`@typescript-eslint`/`typescript` are expected and not in scope).

- [ ] **Step 4: Commit**

Note: git is not yet initialized in this repo — defer this commit. Skip
this step here; Task 6 performs `git init` and the first commit will
include these `package.json`/`package-lock.json` changes along with
everything else. Do not run `git commit` in this task.

---

### Task 2: tsconfig and .gitignore

**Files:**
- Create: `tsconfig.json`
- Create: `.gitignore`

**Interfaces:**
- Produces: TypeScript compiler configuration that all later `.ts` files
  compile under; a `.gitignore` that later tasks' generated/secret files
  rely on being excluded.

- [ ] **Step 1: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
dist/
.env.dev
.env.local
.env.prod
*.log
.DS_Store
```

- [ ] **Step 3: Verify tsconfig is valid JSON and TypeScript accepts it**

Run: `npx tsc --showConfig`
Expected: prints the resolved config with no errors (it's fine that
there are no `.ts` files yet — `include` matching zero files is not an
error for `--showConfig`).

---

### Task 3: Environment files and config loader

**Files:**
- Create: `.env.example`
- Create: `.env.dev`
- Create: `.env.local`
- Create: `.env.prod`
- Create: `src/config/env.ts`

**Interfaces:**
- Produces: `loadConfig(): Config` from `src/config/env.ts`, where
  `Config = { nodeEnv: 'dev' | 'local' | 'prod'; port: number }`. Also
  exports the `Config` type. `index.ts` (Task 5) calls `loadConfig()`
  after dotenv has populated `process.env`.

- [ ] **Step 1: Create .env.example**

```
NODE_ENV=dev
PORT=3000
```

- [ ] **Step 2: Create .env.dev**

```
NODE_ENV=dev
PORT=3000
```

- [ ] **Step 3: Create .env.local**

```
NODE_ENV=local
PORT=3000
```

- [ ] **Step 4: Create .env.prod**

```
NODE_ENV=prod
PORT=8080
```

- [ ] **Step 5: Create src/config/env.ts**

```typescript
export type NodeEnv = 'dev' | 'local' | 'prod';

export interface Config {
  nodeEnv: NodeEnv;
  port: number;
}

const VALID_NODE_ENVS: NodeEnv[] = ['dev', 'local', 'prod'];

function isValidNodeEnv(value: string | undefined): value is NodeEnv {
  return VALID_NODE_ENVS.includes(value as NodeEnv);
}

export function loadConfig(): Config {
  const missing: string[] = [];

  const rawNodeEnv = process.env.NODE_ENV;
  if (!rawNodeEnv) {
    missing.push('NODE_ENV');
  } else if (!isValidNodeEnv(rawNodeEnv)) {
    throw new Error(
      `Invalid NODE_ENV "${rawNodeEnv}". Expected one of: ${VALID_NODE_ENVS.join(', ')}`
    );
  }

  const rawPort = process.env.PORT;
  if (!rawPort) {
    missing.push('PORT');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT "${rawPort}": must be a positive number`);
  }

  return {
    nodeEnv: rawNodeEnv as NodeEnv,
    port,
  };
}
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

---

### Task 4: Inversify container scaffold

**Files:**
- Create: `src/container/types.ts`
- Create: `src/container/inversify.config.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TYPES` symbol map from `src/container/types.ts` (empty
  object to start, ready for future `TYPES.SomeService = Symbol.for(...)`
  entries); `container: Container` exported from
  `src/container/inversify.config.ts`, imported by `index.ts` (Task 5).

- [ ] **Step 1: Create src/container/types.ts**

```typescript
// Symbol identifiers for Inversify bindings.
// Add entries here as services/repositories are introduced, e.g.:
//   SomeService: Symbol.for('SomeService'),
export const TYPES = {};
```

- [ ] **Step 2: Create src/container/inversify.config.ts**

```typescript
import 'reflect-metadata';
import { Container } from 'inversify';

const container = new Container();

// Bindings are added here as services/repositories are introduced, e.g.:
//   container.bind<SomeService>(TYPES.SomeService).to(SomeServiceImpl);

export { container };
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

---

### Task 5: Express app, entrypoint, and placeholder layer directories

**Files:**
- Create: `src/app.ts`
- Create: `src/index.ts`
- Create: `src/controllers/.gitkeep`
- Create: `src/services/.gitkeep`
- Create: `src/repositories/.gitkeep`

**Interfaces:**
- Consumes: `loadConfig`, `Config` from `../config/env` (Task 3);
  `container` from `../container/inversify.config` (Task 4).
- Produces: `createApp(): Express` from `src/app.ts`, called by
  `index.ts`. `index.ts` is the process entrypoint (referenced by
  `package.json` scripts in Task 6).

- [ ] **Step 1: Create src/app.ts**

```typescript
import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Future controller routers are mounted here, e.g.:
  //   app.use('/api', controllerRouter);

  return app;
}
```

- [ ] **Step 2: Create src/index.ts**

```typescript
import 'reflect-metadata';
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.${process.env.NODE_ENV ?? 'dev'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { loadConfig } from './config/env';
import { createApp } from './app';
import { container } from './container/inversify.config';

const config = loadConfig();
const app = createApp();

// container is initialized here so future bindings are resolvable
// before the server starts accepting requests.
void container;

app.listen(config.port, () => {
  console.log(`[${config.nodeEnv}] server listening on port ${config.port}`);
});
```

- [ ] **Step 3: Create placeholder .gitkeep files**

```bash
type nul > src\controllers\.gitkeep
type nul > src\services\.gitkeep
type nul > src\repositories\.gitkeep
```

(If using the Bash tool instead of PowerShell: `touch src/controllers/.gitkeep src/services/.gitkeep src/repositories/.gitkeep`)

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Add dev/build/start scripts to package.json**

Modify `package.json`'s `"scripts"` section to:

```json
"scripts": {
  "dev": "cross-env NODE_ENV=dev ts-node src/index.ts",
  "dev:local": "cross-env NODE_ENV=local ts-node src/index.ts",
  "dev:prod": "cross-env NODE_ENV=prod ts-node src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js",
  "test": "echo \"Error: no test specified\" && exit 1"
}
```

This requires `cross-env` for Windows-compatible inline env vars — check
if it's already available:

Run: `npm ls cross-env --depth=0`
If not found, run: `npm install --save-dev cross-env`

- [ ] **Step 6: Verify the server boots**

Run: `npm run dev` (in the background or with a short timeout), then
check the console output.
Expected: `[dev] server listening on port 3000` printed, no thrown
errors. Stop the process afterward (it will run until killed).

---

### Task 6: Git initialization and first commit

**Files:**
- No new files (uses everything created in Tasks 1-5)

**Interfaces:**
- Consumes: the full working tree from Tasks 1-5.
- Produces: an initialized local git repository with `origin` set and
  one commit.

- [ ] **Step 1: Initialize git**

Run: `git init`
Expected: `Initialized empty Git repository in .../Server/.git/`

- [ ] **Step 2: Add the GitHub remote**

Run: `git remote add origin https://github.com/tuvalr/clasifacil-server.git`

- [ ] **Step 3: Verify remote**

Run: `git remote -v`
Expected: `origin  https://github.com/tuvalr/clasifacil-server.git (fetch)`
and `(push)`.

- [ ] **Step 4: Review what will be staged**

Run: `git status`
Expected: `.env.dev`, `.env.local`, `.env.prod`, `node_modules/`,
`dist/` are NOT listed (gitignored). All source files, configs,
`.env.example`, `package.json`, `package-lock.json`, and the spec/plan
docs under `docs/` ARE listed as untracked.

- [ ] **Step 5: Stage and commit**

```bash
git add .
git status
git commit -m "chore: initialize Inversify Express server scaffold"
```

- [ ] **Step 6: Verify commit**

Run: `git log --oneline -1` and `git status`
Expected: one commit present; working tree clean.

(No push — the remote stays a local reference only until the user
explicitly asks to push.)

---

## Self-Review Notes

- **Spec coverage:** Stack (Task 1), tsconfig/.gitignore (Task 2), env
  strategy + config validation (Task 3), Inversify container (Task 4),
  app wiring + folder structure + entrypoint (Task 5), scripts (Task 5
  step 5), git setup (Task 6) — every spec section has a covering task.
- **Placeholder scan:** no TBD/TODO; all code blocks are complete,
  runnable content.
- **Type consistency:** `Config`/`loadConfig` (Task 3) match the
  `../config/env` import in Task 5 exactly; `container` export name
  (Task 4) matches the Task 5 import; `createApp` name matches its use
  in `index.ts`.
- **New dependency surfaced during planning:** `cross-env` is needed for
  the `NODE_ENV=x` script syntax to work on Windows (the dev machine's
  platform, per environment info) — added as a conditional install in
  Task 5 step 5 rather than assumed present.
