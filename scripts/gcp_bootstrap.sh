#!/usr/bin/env bash
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"

echo "Setting project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

echo "Enabling required services..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  certificatemanager.googleapis.com \
  dns.googleapis.com \
  secretmanager.googleapis.com

echo "Submitting Cloud Build (docker build + deploy to Cloud Run)..."
gcloud builds submit --config cloudbuild.yaml --project "$PROJECT_ID" .

echo "Fetching Cloud Run URL..."
gcloud run services describe apeyolo --region asia-east1 --format='value(status.url)'

