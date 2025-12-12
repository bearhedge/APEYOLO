/**
 * Migration script to copy IBKR credentials from ENV vars to database
 * for the owner account. This enables multi-user mode while maintaining
 * backward compatibility for the original owner.
 *
 * Usage: npx tsx scripts/migrate-owner-credentials.ts
 */

// Load environment variables BEFORE any imports that need them
import { config } from 'dotenv';
config();

// Now dynamically import db after env is loaded
async function migrateOwnerCredentials() {
  // Dynamic imports after dotenv is configured
  const { db } = await import('../server/db');
  const { users, ibkrCredentials } = await import('../shared/schema');
  const { eq } = await import('drizzle-orm');
  const { encryptPrivateKey } = await import('../server/crypto');
  const { randomUUID } = await import('crypto');
  console.log('[Migration] Starting owner credentials migration...');

  const ownerEmail = process.env.OWNER_EMAIL || 'info@bearhedge.com';
  console.log(`[Migration] Looking for owner: ${ownerEmail}`);

  // Find owner user
  const ownerResults = await db.select().from(users)
    .where(eq(users.email, ownerEmail))
    .limit(1);

  if (ownerResults.length === 0) {
    console.error(`[Migration] ERROR: Owner user not found: ${ownerEmail}`);
    console.error('[Migration] Make sure the owner has logged in at least once');
    process.exit(1);
  }

  const owner = ownerResults[0];
  console.log(`[Migration] Found owner: ${owner.id} (${owner.email})`);

  // Check if credentials already exist
  const existing = await db.select().from(ibkrCredentials)
    .where(eq(ibkrCredentials.userId, owner.id))
    .limit(1);

  if (existing.length > 0) {
    console.log('[Migration] Credentials already exist for owner - skipping');
    console.log(`[Migration] Existing status: ${existing[0].status}`);
    process.exit(0);
  }

  // Get ENV credentials
  const clientId = process.env.IBKR_CLIENT_ID;
  const clientKeyId = process.env.IBKR_CLIENT_KEY_ID;
  const privateKey = process.env.IBKR_PRIVATE_KEY;
  const credential = process.env.IBKR_CREDENTIAL;
  const accountId = process.env.IBKR_ACCOUNT_ID;
  const allowedIp = process.env.IBKR_ALLOWED_IP;
  const environment = process.env.IBKR_ENV || 'paper';

  console.log('[Migration] Checking ENV credentials...');
  console.log(`  - IBKR_CLIENT_ID: ${clientId ? clientId.substring(0, 4) + '****' : 'NOT SET'}`);
  console.log(`  - IBKR_CLIENT_KEY_ID: ${clientKeyId ? clientKeyId.substring(0, 4) + '****' : 'NOT SET'}`);
  console.log(`  - IBKR_PRIVATE_KEY: ${privateKey ? 'SET (length: ' + privateKey.length + ')' : 'NOT SET'}`);
  console.log(`  - IBKR_CREDENTIAL: ${credential ? credential.substring(0, 4) + '****' : 'NOT SET'}`);
  console.log(`  - IBKR_ACCOUNT_ID: ${accountId || 'NOT SET'}`);
  console.log(`  - IBKR_ALLOWED_IP: ${allowedIp || 'NOT SET'}`);
  console.log(`  - IBKR_ENV: ${environment}`);

  if (!clientId || !clientKeyId || !privateKey || !credential) {
    console.error('[Migration] ERROR: Missing required IBKR ENV vars');
    console.error('[Migration] Required: IBKR_CLIENT_ID, IBKR_CLIENT_KEY_ID, IBKR_PRIVATE_KEY, IBKR_CREDENTIAL');
    process.exit(1);
  }

  // Check encryption key (uses IBKR_ENCRYPTION_KEY or falls back to JWT_SECRET)
  const encryptionKey = process.env.IBKR_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!encryptionKey) {
    console.error('[Migration] ERROR: No encryption key available');
    console.error('[Migration] Set IBKR_ENCRYPTION_KEY or JWT_SECRET');
    process.exit(1);
  }
  console.log(`[Migration] Using ${process.env.IBKR_ENCRYPTION_KEY ? 'IBKR_ENCRYPTION_KEY' : 'JWT_SECRET'} for encryption`);

  console.log('[Migration] Encrypting private key...');
  const privateKeyEncrypted = encryptPrivateKey(privateKey);
  console.log(`[Migration] Encrypted key length: ${privateKeyEncrypted.length}`);

  console.log('[Migration] Inserting credentials...');
  const credentialId = randomUUID();

  await db.insert(ibkrCredentials).values({
    id: credentialId,
    userId: owner.id,
    clientId,
    clientKeyId,
    privateKeyEncrypted,
    credential,
    accountId: accountId || null,
    allowedIp: allowedIp || null,
    environment,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log(`[Migration] SUCCESS: Migrated credentials for ${ownerEmail}`);
  console.log(`[Migration] Credential ID: ${credentialId}`);
  console.log('[Migration] Status: active');
  console.log('[Migration] Environment:', environment);
}

// Run migration
migrateOwnerCredentials()
  .then(() => {
    console.log('[Migration] Complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Migration] FAILED:', error);
    process.exit(1);
  });
