-- Remove fake hardcoded seed values
-- Real data comes from WebSocket, not manual seeds

-- Delete VIX seed (it was fake $16.00)
DELETE FROM "latest_prices" WHERE symbol = 'VIX' AND source = 'manual';

-- Delete SPY seed if it hasn't been updated by WebSocket
DELETE FROM "latest_prices" WHERE symbol = 'SPY' AND source = 'manual';
