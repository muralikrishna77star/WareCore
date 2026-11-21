-- WareCore customer registry ("control" database).
--
-- Lives in its own database (warecore_control), next to the customers' own
-- databases on the same Neon branch. It holds no stock, sales or ledger data:
-- only which customers exist, which web addresses open which customer's
-- database, each customer's name, logo and colour, and the owner accounts
-- that may add customers. Each customer's business data stays in that
-- customer's own database (tenants.db_name), migrated by supabase/migrations.

CREATE TABLE IF NOT EXISTS tenants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{1,29}$'),
  display_name     TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  db_name          TEXT NOT NULL UNIQUE CHECK (db_name ~ '^[a-z][a-z0-9_]{1,62}$'),
  status           TEXT NOT NULL DEFAULT 'provisioning'
                     CHECK (status IN ('provisioning', 'active', 'suspended', 'failed')),
  brand_color      TEXT CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-f]{6}$'),
  logo             BYTEA,
  logo_mime        TEXT CHECK (logo_mime IS NULL OR logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  google_sign_in   BOOLEAN NOT NULL DEFAULT false,
  provision_error  TEXT,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((logo IS NULL) = (logo_mime IS NULL)),
  CHECK (logo IS NULL OR octet_length(logo) <= 262144)
);

-- Every web address that opens a customer: its own subdomain
-- (saisteels.warecore.space) plus any old address kept working during a move
-- (warecore.vercel.app). Lower-case host names, no port.
CREATE TABLE IF NOT EXISTS tenant_domains (
  host        TEXT PRIMARY KEY CHECK (host = lower(host) AND host ~ '^[a-z0-9.-]+$'),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_one_primary ON tenant_domains (tenant_id) WHERE is_primary;

-- WareCore owner accounts: sign in on the owner console only. They are not
-- users of any customer and cannot open a customer's screens.
CREATE TABLE IF NOT EXISTS owner_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  full_name      TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- What the owner console did, so a customer's set-up can be traced.
CREATE TABLE IF NOT EXISTS tenant_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  owner_email TEXT,
  action      TEXT NOT NULL,
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_events_tenant ON tenant_events (tenant_id, created_at DESC);
