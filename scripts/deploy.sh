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
  --set-env-vars "APP_ENV=${APP_ENV},BROKER_PROVIDER=ibkr,IBKR_ENV=paper,IBKR_BASE_URL=https://api.ibkr.com,IBKR_ACCOUNT_ID=DU9807013,IBKR_ALLOWED_IP=35.206.203.27" \
  --set-secrets "IBKR_CLIENT_ID=ibkr-client-id:latest,IBKR_CLIENT_KEY_ID=ibkr-client-key-id:latest,IBKR_CREDENTIAL=ibkr-credential:latest,IBKR_PRIVATE_KEY=ibkr-private-key:latest,DATABASE_URL=database-url:latest,JWT_SECRET=jwt-secret:latest,GOOGLE_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest" \
  --update-annotations=run.googleapis.com/invoker-iam-disabled=true \
  --allow-unauthenticated

echo "✅ Deployed ${SERVICE} to ${REGION}"
echo ""

# Show the service URL
gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --format='value(status.url)'
