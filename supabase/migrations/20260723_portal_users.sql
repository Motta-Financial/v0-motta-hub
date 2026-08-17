-- ────────────────────────────────────────────────────────────────
-- Client Portal: portal_users + portal_messages
--
-- portal_users  — one row per client/contact who can log in to
--                 the portal. Linked to the Supabase Auth user
--                 (auth.users.id) and to a Karbon client_id.
--
-- portal_messages — single-thread messaging between a client and
--                   the Motta team. All messages for a client live
--                   in one conversation, ordered by created_at.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portal_users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           text NOT NULL,   -- Karbon contact/org key
  email               text NOT NULL,
  full_name           text,
  role                text NOT NULL DEFAULT 'client'
                        CHECK (role IN ('client', 'client_contact')),
  invited_by          uuid,            -- team_members.id
  invite_token        text UNIQUE,
  invite_accepted_at  timestamptz,
  last_login_at       timestamptz,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Quick lookup by auth_user_id (the most common join)
CREATE INDEX IF NOT EXISTS portal_users_auth_user_id_idx
  ON portal_users (auth_user_id);

-- Quick lookup by client_id (list all users for a client)
CREATE INDEX IF NOT EXISTS portal_users_client_id_idx
  ON portal_users (client_id);


CREATE TABLE IF NOT EXISTS portal_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    text NOT NULL,     -- matches portal_users.client_id
  sender_id    text NOT NULL,     -- portal_users.id OR team_members.id (text so both work)
  sender_role  text NOT NULL CHECK (sender_role IN ('client', 'team')),
  sender_name  text,              -- denormalised display name
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  read_at      timestamptz        -- set when the OTHER party first opens the thread
);

-- All messages for a client, newest first
CREATE INDEX IF NOT EXISTS portal_messages_client_id_created_at_idx
  ON portal_messages (client_id, created_at DESC);
