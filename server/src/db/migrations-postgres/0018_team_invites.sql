-- Real team invites: team_members used to be purely decorative (a nome/email row with
-- no actual account behind it — see the old inviteTeamMember). This turns it into a real
-- invite + membership record: a hashed single-use token is emailed to the invitee, and
-- accepting it creates a real login-capable account linked back to the owner via
-- users.team_owner_id.
ALTER TABLE users ADD COLUMN team_owner_id INTEGER REFERENCES users(id);

ALTER TABLE team_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE team_members ADD COLUMN invite_token_hash TEXT;
ALTER TABLE team_members ADD COLUMN invite_expires_at TEXT;
ALTER TABLE team_members ADD COLUMN user_id INTEGER REFERENCES users(id);
ALTER TABLE team_members ADD COLUMN accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_team_members_invite_token ON team_members(invite_token_hash);
