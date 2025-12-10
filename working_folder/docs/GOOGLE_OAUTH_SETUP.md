# Google OAuth Setup Guide

## Prerequisites
You need a Google Cloud account to set up OAuth 2.0 credentials.

## Setup Steps

### 1. Go to Google Cloud Console
Navigate to https://console.cloud.google.com/

### 2. Create or Select a Project
- Click on the project dropdown at the top
- Either select an existing project or create a new one

### 3. Enable Google OAuth 2.0 API
- Go to "APIs & Services" > "Library"
- Search for "Google+ API" or "Google Identity"
- Click "Enable" if not already enabled

### 4. Create OAuth 2.0 Credentials
- Go to "APIs & Services" > "Credentials"
- Click "Create Credentials" > "OAuth client ID"
- If prompted, configure the OAuth consent screen first:
  - Choose "External" user type for testing
  - Fill in the required fields (app name, user support email, etc.)
  - Add test users if needed
  - Save and continue

### 5. Configure OAuth Client
- Application type: "Web application"
- Name: "APEYOLO Dev" (or your preferred name)
- Authorized JavaScript origins:
  - `http://localhost:3000`
  - `http://localhost:5000`
- Authorized redirect URIs:
  - `http://localhost:5000/api/auth/google/callback`
  - `https://apeyolo.com/api/auth/google/callback` (for production)
- Click "Create"

### 6. Copy Credentials
After creation, you'll see:
- **Client ID**: Copy this
- **Client Secret**: Copy this

### 7. Update .env File
Add these to your `.env` file:
```bash
# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback

# JWT Secret (generate a random string)
JWT_SECRET=your_random_jwt_secret_here_use_a_long_random_string

# Client URL for redirects
CLIENT_URL=http://localhost:3000
```

### 8. Generate JWT Secret
You can generate a secure JWT secret using:
```bash
openssl rand -base64 32
```
Or in Node.js:
```javascript
require('crypto').randomBytes(32).toString('base64')
```

## Testing the OAuth Flow

1. Make sure your dev server is running: `npm run dev`
2. Navigate to http://localhost:3000/onboarding
3. Click "Continue with Google"
4. You should be redirected to Google's login page
5. After successful authentication, you'll be redirected back to the onboarding step 2

## Troubleshooting

### Common Issues:
- **Redirect URI mismatch**: Make sure the redirect URI in your .env matches exactly what's configured in Google Cloud Console
- **Invalid client**: Check that your client ID and secret are correct
- **CORS errors**: Ensure your origins are properly configured in Google Cloud Console

## Production Deployment
For production:
1. Update the redirect URI to use your production domain
2. Add production URLs to authorized origins and redirect URIs
3. Update .env with production values
4. Consider using environment-specific configuration

## Security Notes
- Never commit your `.env` file to git
- Keep your client secret secure
- Use different credentials for development and production
- Rotate your JWT secret periodically