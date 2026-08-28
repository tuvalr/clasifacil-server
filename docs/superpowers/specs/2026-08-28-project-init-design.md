# Project Initialization: Inversify Express Server

## Context

`clasifacil-server` currently has only `package.json` (with `dotenv`,
`inversify`, and ESLint/TypeScript dev tooling already installed) and no
source tree, no git repository, and no runtime scaffolding. This spec
covers initializing the project structure so that controllers, services,
and repositories can be added later without further structural changes.

A GitHub remote already exists at
`https://github.com/tuvalr/clasifacil-server.git`, but no local git
repository has been initialized yet.

## Goals

- Stand up an Express HTTP server wired through Inversify's IoC container,
  using `inversify-express-utils` so decorator-based controllers can be
  dropped in later with no rework.
- Support three environments — `dev`, `local`, `prod` — selected via
  `NODE_ENV`, each with its own `.env` file.
- Validate required environment variables at startup with a fail-fast,
  hand-written TypeScript check (no schema library).
- Establish a layer-based `src/` folder structure (`controllers/`,
  `services/`, `repositories/`, `config/`, `container/`) ready for future
  additions.
- Initialize git locally and connect it to the existing GitHub remote.

## Non-goals

- No actual controllers, services, or repositories are implemented — only
  placeholder directories.
- No database/ORM setup.
- No CI/CD pipeline.
- No authentication/authorization scaffolding.
- No push to the remote — the local repo is initialized and committed
  only; pushing is left to the user.

## Stack

- **Framework**: Express 5
- **DI wiring**: `inversify` (already at `^8.2.3`), `reflect-metadata`.
  `inversify-express-utils` is NOT used — its latest release (6.5.0) peer-
  requires `inversify@^6` and `express@^4`, which conflicts with the
  already-installed `inversify@^8.2.3` and the desire to run Express 5.
  Controllers will instead be registered manually: each controller class
  is bound in the Inversify container and mounted onto an Express
  `Router` by hand when controllers are added later. This is a deliberate
  deviation from typical Inversify-Express starter templates, made to
  avoid downgrading the already-installed `inversify` major version.
- **Language**: TypeScript (already installed), run via `ts-node` in dev
- **Config loading**: `dotenv`, loading `.env.<NODE_ENV>`
- **Middleware**: `helmet`, `cors`, `express.json()`

New runtime dependencies to add: `express`, `reflect-metadata`, `helmet`,
`cors`.
New dev dependencies to add: `@types/express`, `@types/cors`,
`@types/node` (already present).

## Environment strategy

- `NODE_ENV` takes one of `dev`, `local`, `prod`.
- At startup, `dotenv` loads `.env.${NODE_ENV}` (falling back to failing
  loudly if the file is missing rather than silently continuing).
- `.env.dev`, `.env.local`, `.env.prod` are gitignored (may contain
  secrets). `.env.example` is committed, listing every required key with
  placeholder values, kept in sync with the validator.

## Config validation

`src/config/env.ts` exports a `loadConfig()` function that:
- Reads `process.env` after dotenv has loaded the right file.
- Checks each required key is present and non-empty (starting set:
  `NODE_ENV`, `PORT`); throws a descriptive `Error` listing all missing
  keys if any are absent.
- Returns a typed `Config` object (`{ nodeEnv: 'dev' | 'local' | 'prod',
  port: number }`).
- Is the single source of truth other modules import config from — no
  other module reads `process.env` directly.

## Folder structure

```
src/
  config/
    env.ts              # loadConfig() — validation described above
  container/
    types.ts             # Symbol identifiers for injectable bindings
    inversify.config.ts  # Container instance + bindings (empty to start)
  controllers/
    .gitkeep              # populated later
  services/
    .gitkeep               # populated later
  repositories/
    .gitkeep                 # populated later
  app.ts                  # builds InversifyExpressServer, registers
                           # helmet/cors/json middleware, returns app
  index.ts                 # entrypoint: dotenv config, loadConfig(),
                           # start the server on the configured port
.env.example
.env.dev / .env.local / .env.prod   (gitignored)
tsconfig.json
.gitignore
```

## App wiring

- `container/inversify.config.ts` creates and exports a `Container`
  instance. No bindings yet beyond what's needed for the server to boot.
- `app.ts` creates a plain Express app, applies `helmet()`, `cors()`,
  `express.json()` as global middleware, and exports the app. A comment
  marks where future controller routers get mounted (e.g.
  `app.use('/api', controllerRouter)`), since none exist yet.
- `index.ts` loads env vars, validates config, imports the container and
  app, starts the HTTP listener on `config.port`, and logs the bound port
  and active environment.

## Scripts (package.json)

- `dev`: run with `ts-node`, `NODE_ENV` defaults to `dev` if unset.
- `build`: `tsc` to `dist/`.
- `start`: `node dist/index.js` (expects `NODE_ENV` set externally, e.g.
  by the deploy environment).
- Env-specific convenience scripts (`dev:local`, `dev:prod`) set
  `NODE_ENV` inline for local testing against other env configs.

`dist/` is gitignored (built, not committed).

## Git setup

- `git init` in the project root.
- Add remote `origin` → `https://github.com/tuvalr/clasifacil-server.git`.
- `.gitignore`: `node_modules/`, `dist/`, `.env.dev`, `.env.local`,
  `.env.prod`, editor/OS cruft (`.DS_Store`, `.vscode/` optional).
- One initial commit containing the full scaffold. No push.

## Testing

- No automated tests are added in this pass (no controllers/services
  exist yet to test). The existing `npm test` placeholder script stays
  until real tests exist.
- Manual verification: `npm run dev` boots the server without throwing,
  binds to the configured port, and responds (e.g. a trivial health
  check is out of scope here since it would be the first controller —
  verification is limited to "server starts and listens without error").
