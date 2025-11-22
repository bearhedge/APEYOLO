#!/bin/bash

# Deploy script for APEYOLO to Google Cloud Run
# This script builds and deploys the application using Cloud Build

set -e

echo "🚀 Starting deployment to Google Cloud Run..."

# Configuration
PROJECT_ID="fabled-cocoa-443004-n3"
SERVICE_NAME="apeyolo"
REGION="asia-east1"

echo "📦 Step 1: Building and deploying with Cloud Build..."
echo "   Project: $PROJECT_ID"
echo "   Service: $SERVICE_NAME"
echo "   Region: $REGION"

# Submit build to Cloud Build
gcloud builds submit \
  --config cloudbuild.yaml \
  --project=$PROJECT_ID

echo ""
echo "✅ Build submitted to Cloud Build"
echo ""

# Monitor the build
echo "⏳ Monitoring build progress..."
BUILD_ID=$(gcloud builds list --limit=1 --project=$PROJECT_ID --format="value(id)")

# Wait for build to complete
while true; do
  STATUS=$(gcloud builds list --limit=1 --project=$PROJECT_ID --format="value(status)")

  if [ "$STATUS" = "SUCCESS" ]; then
    echo "✅ Build completed successfully!"
    break
  elif [ "$STATUS" = "FAILURE" ]; then
    echo "❌ Build failed. Check logs with:"
    echo "   gcloud builds log $BUILD_ID --project=$PROJECT_ID"
    exit 1
  else
    echo "⏳ Build in progress... (status: $STATUS)"
    sleep 10
  fi
done

echo ""
echo "🔍 Checking deployment status..."

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME \
  --region=$REGION \
  --project=$PROJECT_ID \
  --format="value(status.url)")

echo ""
echo "🎉 Deployment complete!"
echo "🌐 Service URL: $SERVICE_URL"
echo "🌐 Custom domain: https://apeyolo.com"
echo ""
echo "📊 To view service logs:"
echo "   gcloud run services logs read $SERVICE_NAME --region=$REGION --project=$PROJECT_ID --limit=50"
echo ""
echo "🔍 To check service status:"
echo "   gcloud run services describe $SERVICE_NAME --region=$REGION --project=$PROJECT_ID"
echo ""
echo "✨ Deployment successful! Visit https://apeyolo.com to test the application"