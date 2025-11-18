#!/bin/bash
set -e

echo "=== Setting up Cloud SQL for APEYOLO ==="

# Generate a secure password for PostgreSQL
DB_PASSWORD=$(openssl rand -base64 16)
echo "Generated database password: $DB_PASSWORD"
echo "SAVE THIS PASSWORD! You'll need it later."
echo ""

# Create Cloud SQL instance
echo "Creating Cloud SQL PostgreSQL instance..."
gcloud sql instances create apeyolo-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=asia-east1 \
  --no-backup \
  --project=fabled-cocoa-443004-n3

echo "Cloud SQL instance created!"

# Create the database
echo "Creating database..."
gcloud sql databases create apeyolo \
  --instance=apeyolo-db \
  --project=fabled-cocoa-443004-n3

echo "Database created!"

# Set password for postgres user
echo "Setting postgres password..."
gcloud sql users set-password postgres \
  --instance=apeyolo-db \
  --password="$DB_PASSWORD" \
  --project=fabled-cocoa-443004-n3

echo "Password set!"

# Get the connection name
echo "Getting connection name..."
CONNECTION_NAME=$(gcloud sql instances describe apeyolo-db --project=fabled-cocoa-443004-n3 --format="value(connectionName)")
echo "Connection name: $CONNECTION_NAME"

# Create the DATABASE_URL
DATABASE_URL="postgresql://postgres:${DB_PASSWORD}@localhost/apeyolo?host=/cloudsql/${CONNECTION_NAME}"
echo ""
echo "DATABASE_URL: $DATABASE_URL"
echo ""

# Store DATABASE_URL in Secret Manager
echo "Storing DATABASE_URL in Secret Manager..."
echo -n "$DATABASE_URL" | gcloud secrets create database-url --data-file=- --project=fabled-cocoa-443004-n3 || echo "Secret already exists, updating..."
echo -n "$DATABASE_URL" | gcloud secrets versions add database-url --data-file=- --project=fabled-cocoa-443004-n3

# Grant Cloud Run access to the secret
echo "Granting Cloud Run access to secret..."
gcloud secrets add-iam-policy-binding database-url \
  --member="serviceAccount:397870885229-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --project=fabled-cocoa-443004-n3

echo ""
echo "=== Updating Cloud Run Service ==="

# Update Cloud Run with database connection and all secrets
gcloud run services update apeyolo \
  --region=asia-east1 \
  --add-cloudsql-instances="$CONNECTION_NAME" \
  --set-env-vars="NODE_ENV=production,GOOGLE_REDIRECT_URI=https://apeyolo.com/api/auth/google/callback,CLIENT_URL=https://apeyolo.com" \
  --set-secrets="GOOGLE_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest,JWT_SECRET=jwt-secret:latest,DATABASE_URL=database-url:latest" \
  --project=fabled-cocoa-443004-n3

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Database Password: $DB_PASSWORD"
echo "Connection Name: $CONNECTION_NAME"
echo ""
echo "Your Cloud Run service is updating. Once complete:"
echo "1. Visit https://apeyolo.com/onboarding"
echo "2. Click 'Continue with Google'"
echo "3. Complete the OAuth flow"
echo ""
echo "To check deployment status:"
echo "gcloud run services describe apeyolo --region=asia-east1 --project=fabled-cocoa-443004-n3"