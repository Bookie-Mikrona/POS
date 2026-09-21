-- 016-os-roles.sql
-- Ustvari os_role enum in os_roles tabelo za ločen dostop do modula Osnovna sredstva.
-- Idempotent: varno pognati večkrat.

DO $$ BEGIN
  CREATE TYPE os_role AS ENUM ('os_admin', 'os_user', 'os_viewer');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS os_roles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT        NOT NULL,
  company_id    UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role          os_role     NOT NULL DEFAULT 'os_viewer',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_os_user_company UNIQUE (clerk_user_id, company_id)
);
