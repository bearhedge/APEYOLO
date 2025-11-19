# IBKR Integration Setup Guide

## Current Architecture (Single-User Mode)

The APEYOLO application currently operates in single-user mode with IBKR OAuth2 credentials configured via environment variables. This approach is suitable for personal use and development.

## Environment Configuration

### Required Environment Variables

The following environment variables must be set in your `.env` file:

```bash
# IBKR OAuth2 Credentials
IBKR_CLIENT_ID=your-client-id        # From IBKR Client Portal
IBKR_CLIENT_KEY_ID=your-key-id       # Key identifier
IBKR_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
IBKR_CREDENTIAL=your-ibkr-username   # IBKR account username
IBKR_ACCOUNT_ID=your-account-id      # Account ID (e.g., DU1234567)
IBKR_ALLOWED_IP=your-server-ip       # Whitelisted IP address
IBKR_SCOPE=sso-sessions.write        # OAuth scope

# IBKR Settings
IBKR_ENV=paper                       # Trading environment: 'paper' or 'live'
IBKR_BASE_URL=https://api.ibkr.com   # IBKR API base URL
BROKER_PROVIDER=ibkr                 # Broker provider selection

# Feature Flag
ENABLE_MULTI_USER=false              # Multi-user mode toggle (future use)
```

### Obtaining IBKR OAuth2 Credentials

1. **Log into IBKR Client Portal**
   - Navigate to https://portal.ibkr.com/
   - Sign in with your IBKR credentials

2. **Enable API Access**
   - Go to Settings → API → Enable API Trading
   - Enable OAuth 2.0 applications

3. **Create OAuth2 Application**
   - Navigate to OAuth Applications
   - Create New Application
   - Save the generated Client ID and Client Key ID

4. **Generate Private Key**
   - Generate an RSA private key
   - Store securely - this cannot be recovered if lost

5. **Configure Allowed IPs**
   - Add your server's IP address to the whitelist
   - For development, you may use your local IP

## API Endpoints

### Status Check
```bash
GET /api/ibkr/status
```
Returns current IBKR connection status and configuration.

### Test Connection
```bash
POST /api/ibkr/test
```
Tests the IBKR connection by attempting OAuth, SSO, validation, and initialization.

## Connection Flow

1. **OAuth Authentication**: Authenticates using client credentials
2. **SSO Session Creation**: Creates a single sign-on session
3. **Validation**: Validates the session and credentials
4. **Initialization**: Initializes the brokerage session for trading

## UI Integration

### Settings Page
- Displays IBKR connection status
- Shows environment (paper/live)
- Test Connection button
- Real-time status indicators

### Onboarding Page
- Step 2 shows IBKR status
- Automatic connection detection
- Clear instructions for setup

## Security Considerations

1. **Private Key Security**
   - Store private keys securely
   - Never commit to version control
   - Use environment variables or secret management

2. **IP Whitelisting**
   - Always use IP whitelisting in production
   - Restrict to known server IPs only

3. **Environment Separation**
   - Keep paper and live credentials separate
   - Test thoroughly in paper before live

## Future Migration Path (Multi-User Mode)

When IBKR licensing is obtained, the system can be migrated to multi-user mode:

### 1. Enable Feature Flag
```bash
ENABLE_MULTI_USER=true
```

### 2. Database Storage
- Credentials stored encrypted in database
- Per-user credential management
- AES-256-GCM encryption for private keys

### 3. User Flow
- Users input their own IBKR credentials
- Credentials validated and stored securely
- Each user trades through their own account

### 4. Architecture Changes
- Per-user IBKR client instances
- Credential CRUD endpoints activated
- UI credential management enabled

## Troubleshooting

### Common Issues

1. **"Not Configured" Status**
   - Verify all environment variables are set
   - Check `.env` file is loaded properly

2. **"Configured but Not Connected"**
   - Test connection using the Test Connection button
   - Check IP whitelist in IBKR Client Portal
   - Verify private key format (PEM)

3. **OAuth Failures**
   - Verify Client ID and Client Key ID
   - Check private key is properly formatted
   - Ensure IP is whitelisted

4. **SSO Failures**
   - Check IBKR credentials are correct
   - Verify two-factor authentication is configured

## Development vs Production

### Development
- Use paper trading credentials
- Local IP addresses acceptable
- Verbose error logging enabled

### Production
- Use separate production credentials
- Static server IP required
- Minimal error exposure
- Regular connection monitoring

## Monitoring

- Connection status checked every 30 seconds in UI
- Automatic reconnection attempts on failure
- Audit logging for all credential operations
- Health check endpoints for monitoring services

## Support

For IBKR-specific issues:
- IBKR API Documentation: https://www.interactivebrokers.com/api/
- IBKR Client Portal: https://portal.ibkr.com/

For application issues:
- Check server logs for detailed error messages
- Verify all environment variables are set correctly
- Test connection using the UI or API endpoints