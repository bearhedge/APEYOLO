# Repository Refactoring Log

**Started**: 2024-11-22
**Purpose**: Clean repository after establishing Google OAuth & IBKR OAuth 2.0 baseline infrastructure

## Context

After successfully implementing:
- Google OAuth authentication
- IBKR OAuth 2.0 integration
- Order placement and management functionality
- Cloud Run deployment

We are now refactoring the repository to focus on UI design and furthering the plumbing with a clean, organized codebase.

## Archive Tier System

- **archive_1/**: Temporary archive - Keep until **2024-12-22** (1 month)
  - Files that might still be needed for reference
  - Will be reviewed before deletion

- **archive_2/**: Deep archive - Keep until **2024-11-29** (1 week)
  - Files that are very likely obsolete
  - Can be safely deleted after review period

## Changes Log

### Phase 1: Setup (2024-11-22)

| Timestamp | Action | Details |
|-----------|--------|---------|
| 2024-11-22 15:30 | Created | archive/ directory structure |
| 2024-11-22 15:30 | Created | archive_1/ and archive_2/ subdirectories |
| 2024-11-22 15:30 | Created | REFACTOR_LOG.md (this file) |

---

### Phase 2: Deep Archive (archive_2/) - Delete After 2024-11-29

**Files moved to archive_2/ - Very likely obsolete:**

| Timestamp | Item | Original Path | Size | Reason | Status |
|-----------|------|---------------|------|--------|--------|
| 2024-11-22 16:34 | legacy_backup_20251008/ | / | 416K | Old October backup | Archived |
| 2024-11-22 16:34 | legacy/ | / | 124K | Outdated client/infra code | Archived |
| 2024-11-22 16:34 | .venv/ | / | 26MB | Unused Python environment | Archived |
| 2024-11-22 16:34 | NODE_ENV=development | / | 0B | Accidental file | Archived |
| 2024-11-22 16:34 | rest-express@1.0.0 | / | 0B | Accidental file | Archived |
| 2024-11-22 16:34 | replit.md | / | 6.7K | Not using Replit | Archived |
| 2024-11-22 16:35 | .env.bak.20251029183229 | / | 560B | Old env backup | Archived |
| 2024-11-22 16:35 | .env.ibkr | / | 340B | Deprecated IBKR config | Archived |
| 2024-11-22 16:50 | .venv/ | / | 26MB | Python virtual environment (project uses Node.js only) | Archived |
| 2024-11-22 16:50 | .env.example | / | 537B | Obsolete env template | Archived |
| 2024-11-22 16:50 | .env.production.example | / | 962B | Obsolete production env template | Archived |
| 2024-11-22 16:50 | .replit | / | 264B | Not using Replit platform | Archived |

---

### Phase 3: Temporary Archive (archive_1/) - Delete After 2024-12-22

**Files moved to archive_1/ - Might need for reference:**

| Timestamp | Item | Original Path | Size | Reason | Status |
|-----------|------|---------------|------|--------|--------|
| 2024-11-22 16:37 | WIP/ | / | 248K | Work in progress docs/screenshots | Archived |
| 2024-11-22 16:37 | IBKR/ | / | 1.1MB | IBKR reference materials & Postman collections | Archived |
| 2024-11-22 16:37 | attached_assets/ | / | 940K | Old screenshots and design files | Archived |
| 2024-11-22 16:37 | SESSION_CONTEXT.md | / | 5.0K | Session tracking document | Archived |
| 2024-11-22 16:37 | DEPLOY_TRIGGER.md | / | 173B | Minimal deployment notes | Archived |
| 2024-11-22 16:37 | IBKR_SETUP.md | / | 5.0K | IBKR setup documentation | Archived |
| 2024-11-22 16:37 | test-ibkr-flow.js | / | 2.6K | IBKR test file | Archived |
| 2024-11-22 16:37 | test_ibkr_auth.ts | / | 2.4K | IBKR auth test file | Archived |
| 2024-11-22 16:51 | setup-cloud-sql.sh | / | 3.0K | Cloud SQL setup script (not using database) | Archived |

---

### Phase 4: Documentation Reorganization

**Documentation files moved to docs/ folder:**

| Timestamp | File | Original Path | New Path | Details |
|-----------|------|---------------|----------|---------|
| 2024-11-22 16:50 | design_guidelines.md | / | docs/ | Design standards documentation |
| 2024-11-22 16:50 | GOOGLE_OAUTH_SETUP.md | / | docs/ | Google OAuth setup guide |
| 2024-11-22 16:50 | PRODUCTION_OAUTH_SETUP.md | / | docs/ | Production OAuth setup guide |

---

### Phase 5: Code Structure Changes

**Repository organization improvements:**

| Timestamp | File/Folder | Change Type | Details |
|-----------|-------------|-------------|---------|
| 2024-11-22 16:49 | .claudepoint/ | Moved | Moved from root to .claude/ folder for better organization |

---

## Review Schedule

- **2024-11-29** (1 week): Review archive_2/ and delete if confirmed obsolete
- **2024-12-22** (1 month): Review archive_1/ and delete if confirmed obsolete

## Restoration Instructions

If you need to restore any archived files:

```bash
# To restore from archive_1
cp -r archive/archive_1/[folder_name] ./

# To restore from archive_2
cp -r archive/archive_2/[folder_name] ./

# To restore a single file
cp archive/archive_1/[file_name] ./
```

---

### Phase 6: Dev Workflow Cleanup (2025-11-28)

**Files archived - Redundant env examples:**

| Timestamp | Item | Original Path | Size | Reason | Status |
|-----------|------|---------------|------|--------|--------|
| 2025-11-28 17:45 | .env.development.example | / | 829B | Redundant - actual .env has better docs | Archived |
| 2025-11-28 17:45 | .env.staging.example | / | 621B | Redundant - staging uses Cloud Run env vars | Archived |
| 2025-11-28 17:45 | .env.production.example | / | 622B | Redundant - prod uses Secret Manager | Archived |

**Reason**: The actual `.env` file already contains comprehensive documentation with comments. These example files just duplicated that with placeholder values. Cloud Run staging/prod use environment variables set via gcloud, not .env files.

---

## Notes

- All archived files are tracked in git history
- No files were permanently deleted during refactoring
- ClaudePoint checkpoint created before refactoring began
- Git commit checkpoint: [to be added]
