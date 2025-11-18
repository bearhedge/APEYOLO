#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
DOMAIN=${DOMAIN:-apeyolo.com}

echo "Setting project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "Creating domain mapping (or ignoring if exists)..."
gcloud run domain-mappings create \
  --service apeyolo \
  --region asia-east1 \
  --domain "$DOMAIN" || true

echo "Describe mapping; add printed DNS records at your DNS host:"
gcloud run domain-mappings describe \
  --domain "$DOMAIN" \
  --region asia-east1 \
  --format='yaml'

