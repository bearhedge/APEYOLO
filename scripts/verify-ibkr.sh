#!/usr/bin/env bash
set -euo pipefail

# Default to local backend on the VM; override with a URL arg
BASE_URL="${1:-http://localhost:8080}"

echo "==> Verifying IBKR pipeline at: $BASE_URL"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1"; exit 1; }; }
need curl
need jq

echo "-- Checking configuration (/api/ibkr/status)"
STATUS_JSON=$(curl -fsS "$BASE_URL/api/ibkr/status")
echo "$STATUS_JSON" | jq . >/dev/null || { echo "Non-JSON response from /api/ibkr/status"; exit 1; }

CONFIGURED=$(echo "$STATUS_JSON" | jq -r '.configured')
if [[ "$CONFIGURED" != "true" ]]; then
  echo "Configured: $CONFIGURED"
  MISSING=$(echo "$STATUS_JSON" | jq -r '.missing // [] | join(", ")')
  if [[ -n "$MISSING" ]]; then
    echo "Missing env vars on service: $MISSING"
  fi
  echo "Aborting: service not configured."
  exit 2
fi

echo "Configured: true"
echo "Environment: $(echo "$STATUS_JSON" | jq -r '.environment')"
echo "Account ID:  $(echo "$STATUS_JSON" | jq -r '.accountId')"
echo "Client ID:   $(echo "$STATUS_JSON" | jq -r '.clientId')"

echo "-- Warming pipeline (/api/broker/warm)"
curl -fsS "$BASE_URL/api/broker/warm" | jq '.ok, .diag | {oauth: .oauth.status, sso: .sso.status, validate: .validate.status, init: .init.status}'

echo "-- Running Test Connection (/api/ibkr/test)"
TEST_JSON=$(curl -fsS -X POST "$BASE_URL/api/ibkr/test")
echo "$TEST_JSON" | jq .

OAUTH=$(echo "$TEST_JSON" | jq -r '.steps.oauth.status')
SSO=$(echo "$TEST_JSON" | jq -r '.steps.sso.status')
VALIDATE=$(echo "$TEST_JSON" | jq -r '.steps.validate.status')
INIT=$(echo "$TEST_JSON" | jq -r '.steps.init.status')

if [[ "$OAUTH" == "200" && "$SSO" == "200" && "$VALIDATE" == "200" && "$INIT" == "200" ]]; then
  echo "✅ All four steps OK (200)."
else
  echo "❌ Pipeline not fully ready. Statuses: oauth=$OAUTH sso=$SSO validate=$VALIDATE init=$INIT"
  exit 3
fi

if [[ "${2:-}" == "order" ]]; then
  echo "-- Placing paper order: BUY 1 SPY MKT (/api/broker/paper/order)"
  curl -fsS -X POST "$BASE_URL/api/broker/paper/order" \
    -H 'Content-Type: application/json' \
    -d '{"symbol":"SPY","side":"BUY","quantity":1,"orderType":"MKT","tif":"DAY"}' | jq .
fi

echo "Done."
