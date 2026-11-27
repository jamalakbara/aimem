-- aimem sync server, M6 slice 6.1a (docs/07 §4.3, plan 6.1 §5). Claims and events are disposable;
-- tokens, memberships and the audit log are not.
CREATE TABLE projects (
  id          bigserial PRIMARY KEY,
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE users (
  id          bigserial PRIMARY KEY,
  handle      text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE memberships (
  project_id  bigint NOT NULL REFERENCES projects(id),
  user_id     bigint NOT NULL REFERENCES users(id),
  roles       text[] NOT NULL DEFAULT '{}',
  is_admin    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE tokens (
  id            bigserial PRIMARY KEY,
  project_id    bigint NOT NULL REFERENCES projects(id),
  user_id       bigint NOT NULL REFERENCES users(id),
  kind          text NOT NULL CHECK (kind IN ('human', 'agent')),
  name          text NOT NULL,
  hash          text NOT NULL UNIQUE,
  scopes        text[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at    timestamptz,
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE TABLE claims (
  id                   bigserial PRIMARY KEY,
  project_id           bigint NOT NULL REFERENCES projects(id),
  task_ref             text NOT NULL,
  owner_user_id        bigint NOT NULL REFERENCES users(id),
  holder               text NOT NULL,
  on_behalf_of         text,
  session              text NOT NULL,
  paths                text[],
  note                 text,
  started_at           timestamptz NOT NULL,
  heartbeat_at         timestamptz NOT NULL,
  ttl_minutes          integer NOT NULL CHECK (ttl_minutes BETWEEN 1 AND 1440),
  expires_at           timestamptz NOT NULL,
  expired_notified_at  timestamptz,
  released_at          timestamptz,
  released_status      text CHECK (released_status IN ('released', 'taken_over'))
);
-- At most one open claim per task (07 §4.3). Expiry does not release a claim (plan §4).
CREATE UNIQUE INDEX claims_one_open ON claims (project_id, task_ref) WHERE released_at IS NULL;

-- Event numbers per project, taken from a row that stays locked until commit (plan §5, QA W5).
CREATE TABLE project_event_seq (
  project_id  bigint PRIMARY KEY REFERENCES projects(id),
  last_seq    bigint NOT NULL DEFAULT 0
);

CREATE TABLE events (
  project_id  bigint NOT NULL REFERENCES projects(id),
  seq         bigint NOT NULL,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  at          timestamptz NOT NULL,
  PRIMARY KEY (project_id, seq)
);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  project_id  bigint REFERENCES projects(id),
  actor       text NOT NULL,
  action      text NOT NULL,
  target      text NOT NULL,
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  meta        jsonb NOT NULL DEFAULT '{}'
);
