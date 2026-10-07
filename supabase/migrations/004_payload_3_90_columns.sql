-- Payload CMS 3.90 expects two columns that 3.89 did not have.
-- This project runs Payload with push:false, so they must be added by hand.
-- Both are nullable and ignored by 3.89, so this is safe to apply BEFORE deploying the upgrade.

-- cloud-storage: object key of the uploaded file
alter table payload.media add column if not exists _objectkey varchar;

-- auth: timestamp of the last password-reset request (login query selects it)
alter table payload.users add column if not exists reset_password_requested_at timestamptz;
