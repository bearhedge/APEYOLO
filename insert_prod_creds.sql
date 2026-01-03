-- First, let's see what users and credentials exist
SELECT id, email, name, created_at FROM users ORDER BY created_at DESC LIMIT 5;
SELECT id, user_id, client_id, status, error_message FROM ibkr_credentials;
