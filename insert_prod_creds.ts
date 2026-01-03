import { Pool } from 'pg';
import crypto from 'crypto';

// Production database URL
const DATABASE_URL = 'postgresql://postgres:DOMRD7x7ECUny4Pc615y9w==@34.80.65.104:5432/apeyolo';

// JWT Secret (same in local and prod)
const JWT_SECRET = 'Q8Q0oVuIolCgaexDsS3B5Ay6nTrWF8AjQ0JhhPCAeRI=';

// Credentials from local .env
const CREDENTIALS = {
  clientId: 'BearHedge-Prod',
  clientKeyId: 'main',
  credential: 'bearhedgefntx',
  accountId: 'U19860056',
  environment: 'live',
  allowedIp: '35.206.203.27', // Cloud Run IP
  privateKey: `-----BEGIN PRIVATE KEY-----
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
tt345DEOCFL36kCOPCPrDj7d/Uww
-----END PRIVATE KEY-----`
};

// Encrypt function (same as server/crypto.ts)
function encryptPrivateKey(plaintext: string): string {
  const key = JWT_SECRET;
  const salt = crypto.randomBytes(64);
  const iv = crypto.randomBytes(16);
  const derivedKey = crypto.pbkdf2Sync(key, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  
  try {
    // First, get all users to find the right one
    const usersResult = await pool.query('SELECT id, email, name FROM users ORDER BY created_at DESC LIMIT 10');
    console.log('Users in production DB:');
    console.log(usersResult.rows);
    
    // Check existing credentials
    const credsResult = await pool.query('SELECT id, user_id, client_id, status FROM ibkr_credentials');
    console.log('\nExisting IBKR credentials:');
    console.log(credsResult.rows);
    
    if (usersResult.rows.length === 0) {
      console.log('\nNo users found in production. You need to log in first.');
      return;
    }
    
    // Use the first user (most recent)
    const userId = usersResult.rows[0].id;
    console.log(`\nUsing user: ${usersResult.rows[0].email} (${userId})`);
    
    // Encrypt the private key
    const encryptedKey = encryptPrivateKey(CREDENTIALS.privateKey);
    console.log('\nPrivate key encrypted successfully');
    
    // Insert or update credentials
    const query = `
      INSERT INTO ibkr_credentials (
        id, user_id, client_id, client_key_id, private_key_encrypted, 
        credential, account_id, allowed_ip, environment, status,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW(), NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        client_id = $2,
        client_key_id = $3,
        private_key_encrypted = $4,
        credential = $5,
        account_id = $6,
        allowed_ip = $7,
        environment = $8,
        status = 'active',
        updated_at = NOW()
      RETURNING id, user_id, status;
    `;
    
    const result = await pool.query(query, [
      userId,
      CREDENTIALS.clientId,
      CREDENTIALS.clientKeyId,
      encryptedKey,
      CREDENTIALS.credential,
      CREDENTIALS.accountId,
      CREDENTIALS.allowedIp,
      CREDENTIALS.environment
    ]);
    
    console.log('\nCredentials inserted/updated:');
    console.log(result.rows[0]);
    console.log('\nDone! Refresh the Settings page on apeyolo.com');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

main();
