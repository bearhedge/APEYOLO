# Production OAuth Setup for APEYOLO

This guide walks you through setting up Google OAuth for the production environment on apeyolo.com.

## Prerequisites

- GCP Project: `fabled-cocoa-443004-n3`
- Domain: `apeyolo.com`
- Cloud Run Service: `apeyolo` (region: `asia-east1`)
- Access to Google Cloud Console
- Access to domain DNS settings

## Step 1: Create Production OAuth Credentials

1. Go to [Google Cloud Console - Credentials](https://console.cloud.google.com/apis/credentials)
2. Select project: `fabled-cocoa-443004-n3`
3. Click **"Create Credentials"** → **"OAuth client ID"**
4. Application type: **"Web application"**
5. Name: **"APEYOLO Production"**
6. **Authorized JavaScript origins:**
   - `https://apeyolo.com`
7. **Authorized redirect URIs:**
   - `https://apeyolo.com/api/auth/google/callback`
8. Click **"Create"**
9. **Save the Client ID and Client Secret** - you'll need these

## Step 2: Generate Production JWT Secret

Run this command on your local machine or VM:

```bash
openssl rand -base64 32
```

**Save the output** - this is your production JWT_SECRET.

## Step 3: Store Secrets in GCP Secret Manager

Run these commands (replace the placeholder values with your actual credentials):

```bash
# Set your project
export PROJECT_ID=fabled-cocoa-443004-n3
gcloud config set project $PROJECT_ID

# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com

# Create secrets
echo -n "YOUR_PROD_CLIENT_ID" | gcloud secrets create google-oauth-client-id --data-file=-
echo -n "YOUR_PROD_CLIENT_SECRET" | gcloud secrets create google-oauth-client-secret --data-file=-
echo -n "YOUR_PROD_JWT_SECRET" | gcloud secrets create jwt-secret --data-file=-
```

## Step 4: Grant Cloud Run Access to Secrets

```bash
# Get the Cloud Run service account
export SERVICE_ACCOUNT=$(gcloud run services describe apeyolo \
  --region=asia-east1 \
  --format='value(spec.template.spec.serviceAccountName)')

# Grant access to secrets
for SECRET in google-oauth-client-id google-oauth-client-secret jwt-secret; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
done
```

## Step 5: Update Cloud Run Service

```bash
gcloud run services update apeyolo \
  --region=asia-east1 \
  --set-env-vars="NODE_ENV=production,GOOGLE_REDIRECT_URI=https://apeyolo.com/api/auth/google/callback,CLIENT_URL=https://apeyolo.com" \
  --set-secrets="GOOGLE_CLIENT_ID=google-oauth-client-id:latest,GOOGLE_CLIENT_SECRET=google-oauth-client-secret:latest,JWT_SECRET=jwt-secret:latest"
```

## Step 6: Set Up Domain Mapping

```bash
export PROJECT_ID=fabled-cocoa-443004-n3
export DOMAIN=apeyolo.com

# Run the domain mapping script
bash scripts/map_domain.sh
```

The script will output DNS records that you need to add to your domain registrar.

## Step 7: Update DNS Records

Add the DNS records provided by the domain mapping script to your domain registrar (e.g., GoDaddy, Namecheap, etc.).

Typical records will look like:
```
Type: A
Name: @
Value: <IP-from-gcloud>

Type: AAAA
Name: @
Value: <IPv6-from-gcloud>
```

**Note:** DNS propagation can take 24-48 hours, but often completes within a few minutes.

## Step 8: Verify SSL Certificate

Cloud Run automatically provisions a managed SSL certificate. Check the status:

```bash
gcloud run domain-mappings describe --domain apeyolo.com --region asia-east1
```

Wait for the status to show `certificateStatus: ACTIVE`.

## Step 9: Test OAuth Flow

1. Navigate to `https://apeyolo.com/onboarding`
2. Click **"Continue with Google"**
3. You should be redirected to Google's consent screen
4. After authentication, you should be redirected back to `https://apeyolo.com/onboarding?step=2`
5. Check browser DevTools → Application → Cookies for `auth_token` with `Secure` flag

## Troubleshooting

### OAuth Error: redirect_uri_mismatch
- Verify the redirect URI in Google Console exactly matches: `https://apeyolo.com/api/auth/google/callback`
- Check that you're using HTTPS, not HTTP

### 502 Bad Gateway
- Check Cloud Run logs: `gcloud run services logs read apeyolo --region=asia-east1 --limit=50`
- Verify environment variables are set correctly
- Ensure secrets are properly mounted

### Certificate Not Active
- Wait a few minutes for certificate provisioning
- Verify domain mapping exists: `gcloud run domain-mappings list --region asia-east1`
- Check DNS records are correctly configured

### Cookies Not Being Set
- Verify `NODE_ENV=production` is set (enables secure cookies)
- Check that you're accessing via HTTPS
- Inspect response headers for `Set-Cookie` with `Secure` flag

## Monitoring

View Cloud Run logs:
```bash
gcloud run services logs read apeyolo --region=asia-east1 --follow
```

Check service health:
```bash
gcloud run services describe apeyolo --region=asia-east1
```

## Rollback Plan

If issues occur, roll back to the previous revision:

```bash
# List revisions
gcloud run revisions list --service=apeyolo --region=asia-east1

# Rollback to previous revision
gcloud run services update-traffic apeyolo \
  --region=asia-east1 \
  --to-revisions=PREVIOUS_REVISION=100
```

## Security Notes

- Never commit `.env` files with real credentials
- All sensitive values are stored in GCP Secret Manager
- Cookies are httpOnly and secure in production
- CSRF protection via state parameter
- JWT tokens expire after 7 days

## Next Steps

After OAuth is working:
1. Set up PostgreSQL database
2. Implement IBKR authentication
3. Configure production monitoring and alerting
4. Set up backup and disaster recovery
