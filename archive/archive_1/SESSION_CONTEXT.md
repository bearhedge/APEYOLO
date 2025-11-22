# APEYOLO Session Context

## Last Updated: 2025-11-17

## Current Status
✅ **Engine Feature Deployed** - Trading decision system is now LIVE on apeyolo.com

## Key Information
- **GCP Project ID**: `fabled-cocoa-443004-n3`
- **GCP Region**: `asia-east1`
- **Service Name**: `apeyolo`
- **Live URL**: https://apeyolo.com

## Deployment Command
```bash
cd ~/Projects/APEYOLO
gcloud builds submit --config cloudbuild.yaml --project fabled-cocoa-443004-n3 --substitutions=COMMIT_SHA=latest .
```

## What's Working
1. **5-Step Trading Engine**:
   - Market regime check (12-2PM EST)
   - Direction selection (PUT/CALL/STRANGLE)
   - Strike selection (0.15-0.20 delta)
   - Position sizing (portfolio margin)
   - Exit rules (200% stop loss)

2. **Frontend**:
   - Engine page with clean dark design
   - No emojis, minimal UI as requested
   - Navigation between Agent/Engine/Portfolio

## What Needs Work
1. **IBKR Integration**: Option chain retrieval returns empty arrays
2. **Database**: Need to migrate from in-memory to PostgreSQL
3. **Auto-deployment**: Set up Cloud Build triggers for automatic deploys

## Project Structure
- Frontend: React + TypeScript + Vite
- Backend: Express + TypeScript
- Deployment: GCP Cloud Run with Docker
- Engine files: `/server/engine/step1-5.ts` + `/server/engine/index.ts`

## Notes
- Required storage.admin permissions for service account
- Uses portfolio margin calculations (12% strangle, 18% single)
- Smart contract logic implemented with mock data first