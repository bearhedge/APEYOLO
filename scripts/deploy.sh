#!/bin/bash
# APEYOLO Deployment Script
# Usage: ./scripts/deploy.sh [staging|prod]

set -e

ENV=${1:-staging}
PROJECT="fabled-cocoa-443004-n3"
REGION="asia-east1"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/cloud-run-source-deploy"

if [ "$ENV" = "prod" ]; then
  SERVICE="apeyolo"
  APP_ENV="production"
  echo "🚀 Deploying to PRODUCTION..."
else
  SERVICE="apeyolo-staging"
  APP_ENV="staging"
  echo "🧪 Deploying to STAGING..."
fi

IMAGE="${REGISTRY}/${SERVICE}"

echo "📦 Building and pushing image..."
gcloud builds submit \
  --tag "${IMAGE}" \
  --project="${PROJECT}"

echo "☁️ Deploying to Cloud Run..."
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --set-env-vars "APP_ENV=${APP_ENV}" \
  --allow-unauthenticated

echo "✅ Deployed ${SERVICE} to ${REGION}"
echo ""

# Show the service URL
gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --format='value(status.url)'
