-- Clasifacil Server — full database DDL.
--
-- This is a hand-maintained snapshot of the schema actually running against the local dev database
-- (introspected via information_schema/pg_catalog, since this repo has no migration tooling and no
-- pg_dump available in this environment). Run it against a fresh database to provision a new
-- environment (staging, prod, another dev machine).
--
-- IMPORTANT: whenever the schema changes (a new ALTER TABLE, a new table, a new index/constraint),
-- update this file in the same change — it is not auto-generated and will drift silently otherwise.

-- ==========================================================================
-- operators
-- ==========================================================================
-- type has no CHECK constraint at the DB level (validated in the server layer only), matching the households.status column's existing convention in this file.
CREATE TABLE operators (
	id                 BIGSERIAL PRIMARY KEY,
	name               VARCHAR(255)             NOT NULL,
	email              VARCHAR(255)             NOT NULL,
	phone              VARCHAR                  NOT NULL,
	country_code       VARCHAR(2)               NOT NULL,
	stripe_account_id  VARCHAR(255),
	onboarding_status  VARCHAR(50)              DEFAULT 'pending',
	status             VARCHAR                  NOT NULL DEFAULT 'active',
	paused_until       TIMESTAMPTZ,
	avatar_url         TEXT,
	type               VARCHAR(20)              NOT NULL DEFAULT 'schedule',
	is_deleted         BOOLEAN                  NOT NULL DEFAULT FALSE,
	deleted_at         TIMESTAMPTZ,
	created_at         TIMESTAMPTZ              DEFAULT CURRENT_TIMESTAMP,
	updated_at         TIMESTAMPTZ              DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT operators_status_check CHECK (status IN ('active', 'paused'))
);

-- Case-insensitive-in-practice (app validates format), but uniqueness is scoped to active rows only —
-- a soft-deleted operator's email is free to be reused by a new one.
CREATE UNIQUE INDEX operators_email_active_key ON operators (email) WHERE (NOT is_deleted);

-- ==========================================================================
-- classes
-- ==========================================================================
-- Recurring weekly classes (schedule-type operators) and recurring 1:1 slots (assigned-type operators) share
-- this same table — see docs/superpowers/specs/2026-09-12-operator-scheduling-design.md. For type='assigned'
-- recurring slots, max_size is always 1 and min_size is always NULL (enforced in the server layer, not here).
CREATE TABLE classes (
    id                BIGSERIAL PRIMARY KEY,
    operator_id       BIGINT        NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
    title             VARCHAR(255)  NOT NULL,
    day_of_week       SMALLINT      NOT NULL,  -- 0 (Sunday) .. 6 (Saturday)
    start_time        TIME          NOT NULL,  -- time-of-day, e.g. 16:00
    duration_minutes  INTEGER       NOT NULL,
    min_size          INTEGER,                  -- nullable, informational only
    max_size          INTEGER       NOT NULL,   -- becomes each generated session's capacity_limit
    status            VARCHAR(20)   NOT NULL DEFAULT 'active',  -- 'active' | 'stopped'
    stopped_at        TIMESTAMPTZ,
    color             VARCHAR(20),              -- nullable, operator-chosen, unenforced format (client picks a default when NULL)
    is_deleted        BOOLEAN       NOT NULL DEFAULT FALSE,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT classes_day_of_week_check CHECK (day_of_week BETWEEN 0 AND 6),
    CONSTRAINT classes_max_size_check CHECK (max_size >= 1),
    CONSTRAINT classes_min_size_check CHECK (min_size IS NULL OR min_size <= max_size),
    CONSTRAINT classes_status_check CHECK (status IN ('active', 'stopped'))
);

-- ==========================================================================
-- households
-- ==========================================================================
-- Unlike operators/users, email uniqueness here is a plain table-level UNIQUE constraint, not a partial
-- index scoped to active rows — a soft-deleted household's email is NOT freed up for reuse. Preserved
-- as-is to match what's actually running; consider aligning with the operators/users pattern
-- (a partial unique index WHERE NOT is_deleted) if that was an oversight rather than intentional.
CREATE TABLE households (
	id            BIGSERIAL PRIMARY KEY,
	name          VARCHAR(255)  NOT NULL,
	email         VARCHAR(255)  NOT NULL UNIQUE,
	avatar_url    TEXT,
	status        TEXT          NOT NULL DEFAULT 'active',
	paused_until  TIMESTAMPTZ,
	is_deleted    BOOLEAN       NOT NULL DEFAULT FALSE,
	deleted_at    TIMESTAMPTZ,
	created_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at    TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================================
-- sessions
-- ==========================================================================
CREATE TABLE sessions (
	id                     BIGSERIAL PRIMARY KEY,
	operator_id            BIGINT        NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
	title                  VARCHAR(255),  -- NULL for any class-linked session (class_id IS NOT NULL) — display
	                                       -- always reads the parent class's current title live. Only populated
	                                       -- for a true one-off session (class_id IS NULL).
	start_time             TIMESTAMPTZ   NOT NULL,
	capacity_limit         INTEGER       NOT NULL,
	current_roster_count   INTEGER       DEFAULT 0,
	class_id               BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	is_makeup_session      BOOLEAN       NOT NULL DEFAULT FALSE,
	is_deleted             BOOLEAN       NOT NULL DEFAULT FALSE,
	deleted_at             TIMESTAMPTZ,
	created_at             TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at             TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================================
-- students
-- ==========================================================================
CREATE TABLE students (
	id             BIGSERIAL PRIMARY KEY,
	household_id   BIGINT        NOT NULL REFERENCES households (id) ON DELETE CASCADE,
	full_name      VARCHAR(255)  NOT NULL,
	date_of_birth  TIMESTAMPTZ,
	notes          TEXT,
	is_deleted     BOOLEAN       NOT NULL DEFAULT FALSE,
	deleted_at     TIMESTAMPTZ,
	created_at     TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at     TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================================
-- class_enrollments
-- ==========================================================================
-- The standing student<->class membership for schedule-type classes (assigned-type classes' single student is
-- intrinsic to the class row and does not use this table's guard the same way — see ClassesServer.delete).
-- No household_id column — a student's household is resolved via students.household_id whenever needed, never
-- duplicated here. The unique constraint is a plain (class_id, student_id) pair, not partial on status, so
-- unassigning then reassigning the same student re-activates the existing row instead of inserting a new one.
CREATE TABLE class_enrollments (
    id          BIGSERIAL PRIMARY KEY,
    class_id    BIGINT        NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
    student_id  BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
    status      VARCHAR(20)   NOT NULL DEFAULT 'active',  -- 'active' | 'removed'
    created_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT class_enrollments_status_check CHECK (status IN ('active', 'removed')),
    CONSTRAINT class_enrollments_unique_active UNIQUE (class_id, student_id)
);

-- ==========================================================================
-- session_attendance
-- ==========================================================================
-- One row per (session_id, student_id) — marking again updates in place (bumps updated_at), never inserts a
-- duplicate. Not an audit log. class_id is nullable: populated for a class-linked session, NULL for a true
-- one-off session's attendance. student_id has no required relationship to class_enrollments — a "trial"
-- student (never enrolled) can still get a row here for one specific session.
CREATE TABLE session_attendance (
	id           BIGSERIAL PRIMARY KEY,
	session_id   BIGINT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	class_id     BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	student_id   BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	status       VARCHAR(20)   NOT NULL,  -- 'present' | 'absent' | 'approved_absent'
	created_at   TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at   TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT session_attendance_status_check CHECK (status IN ('present', 'absent', 'approved_absent')),
	CONSTRAINT session_attendance_unique UNIQUE (session_id, student_id)
);

-- ==========================================================================
-- session_attendance_history
-- ==========================================================================
-- Same shape as session_attendance plus archived_at. Populated by POST /api/admin/session-attendance/archive,
-- which moves matching rows here and deletes them from the live table (not wrapped in an explicit transaction —
-- see SessionAttendanceServer.archive). FKs kept (not decoupled) so archived rows stay referentially valid.
CREATE TABLE session_attendance_history (
	id           BIGINT        PRIMARY KEY,
	session_id   BIGINT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
	class_id     BIGINT        REFERENCES classes (id) ON DELETE CASCADE,
	student_id   BIGINT        NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	status       VARCHAR(20)   NOT NULL,
	created_at   TIMESTAMPTZ,
	updated_at   TIMESTAMPTZ,
	archived_at  TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================================
-- enrollments_and_credits
-- ==========================================================================
CREATE TABLE enrollments_and_credits (
	id                    BIGSERIAL PRIMARY KEY,
	student_id            BIGINT       NOT NULL REFERENCES students (id) ON DELETE CASCADE,
	session_id            BIGINT       REFERENCES sessions (id) ON DELETE SET NULL,
	household_id          BIGINT       NOT NULL REFERENCES households (id) ON DELETE CASCADE,
	status                VARCHAR(50)  NOT NULL DEFAULT 'booked',
	credit_token_expiry   TIMESTAMPTZ,
	is_deleted            BOOLEAN      NOT NULL DEFAULT FALSE,
	deleted_at            TIMESTAMPTZ,
	created_at            TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
	updated_at            TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================================
-- invoices_and_payments
-- ==========================================================================
CREATE TABLE invoices_and_payments (
	id                 BIGSERIAL PRIMARY KEY,
	household_id       BIGINT        NOT NULL REFERENCES households (id) ON DELETE CASCADE,
	operator_id        BIGINT        NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
	amount             NUMERIC       NOT NULL,
	payment_type       VARCHAR(50)   NOT NULL,
	status             VARCHAR(50)   NOT NULL DEFAULT 'pending',
	stripe_charge_id   VARCHAR(255),
	is_deleted         BOOLEAN       NOT NULL DEFAULT FALSE,
	deleted_at         TIMESTAMPTZ,
	created_at         TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at         TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================================
-- users (login accounts — role + associated_entity_id points at an operators.id or households.id row)
-- ==========================================================================
CREATE TABLE users (
	id                     BIGSERIAL PRIMARY KEY,
	auth_uid               UUID          NOT NULL,
	email                  VARCHAR(255)  NOT NULL,
	role                   VARCHAR(50)   NOT NULL,
	associated_entity_id   BIGINT,
	is_deleted             BOOLEAN       NOT NULL DEFAULT FALSE,
	deleted_at             TIMESTAMPTZ,
	created_at             TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	updated_at             TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT users_auth_uid_key UNIQUE (auth_uid)
);

-- Login email must be unique among active accounts only — a soft-deleted user's email is free to reuse.
CREATE UNIQUE INDEX users_email_active_key ON users (email) WHERE (NOT is_deleted);

-- ==========================================================================
-- audit_logs
-- ==========================================================================
CREATE TABLE audit_logs (
	id                   BIGSERIAL PRIMARY KEY,
	table_name           VARCHAR(100)  NOT NULL,
	record_id            BIGINT        NOT NULL,
	action               VARCHAR(20)   NOT NULL,
	old_data             JSONB,
	new_data             JSONB,
	changed_by_user_id   BIGINT        REFERENCES users (id) ON DELETE RESTRICT,
	changed_at           TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP
);
