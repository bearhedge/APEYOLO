import crypto from 'crypto';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 64; // 64 bytes salt
const TAG_LENGTH = 16; // 128 bit auth tag
const IV_LENGTH = 16; // 128 bit initialization vector
const KEY_LENGTH = 32; // 256 bit key

/**
 * Derives an encryption key from a password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha256');
}

/**
 * Encrypts a string using AES-256-GCM
 * @param text The text to encrypt
 * @param password The password to use for encryption (from environment)
 * @returns Base64 encoded string containing salt, iv, tag, and encrypted data
 */
export function encrypt(text: string, password: string): string {
  // Generate random salt and IV
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from password
  const key = deriveKey(password, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt the text
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);

  // Get the auth tag
  const tag = cipher.getAuthTag();

  // Combine salt + iv + tag + encrypted data
  const combined = Buffer.concat([salt, iv, tag, encrypted]);

  // Return as base64 string
  return combined.toString('base64');
}

/**
 * Decrypts a string encrypted with encrypt()
 * @param encryptedData Base64 encoded encrypted data
 * @param password The password to use for decryption (from environment)
 * @returns The decrypted text
 */
export function decrypt(encryptedData: string, password: string): string {
  // Decode from base64
  const combined = Buffer.from(encryptedData, 'base64');

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  // Derive key from password
  const key = deriveKey(password, salt);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}

/**
 * Gets the encryption key from environment
 * In production, this should come from GCP Secret Manager
 */
export function getEncryptionKey(): string {
  // Use IBKR_ENCRYPTION_KEY if set, otherwise fall back to JWT_SECRET
  const key = process.env.IBKR_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) {
    throw new Error('IBKR_ENCRYPTION_KEY or JWT_SECRET environment variable must be set');
  }
  return key;
}

/**
 * Encrypts IBKR private key for storage
 */
export function encryptPrivateKey(privateKey: string): string {
  const key = getEncryptionKey();
  return encrypt(privateKey, key);
}

/**
 * Decrypts IBKR private key for use
 */
export function decryptPrivateKey(encryptedKey: string): string {
  const key = getEncryptionKey();
  return decrypt(encryptedKey, key);
}

/**
 * Validates that a string is a valid PEM-formatted private key
 */
export function isValidPrivateKey(key: string): boolean {
  const pemRegex = /^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----$/;
  return pemRegex.test(key.trim());
}

/**
 * Sanitizes credentials for logging (removes sensitive data)
 */
export function sanitizeCredentials(creds: any): any {
  const sanitized = { ...creds };
  if (sanitized.privateKey) {
    sanitized.privateKey = '[REDACTED]';
  }
  if (sanitized.privateKeyEncrypted) {
    sanitized.privateKeyEncrypted = '[ENCRYPTED]';
  }
  if (sanitized.clientId) {
    sanitized.clientId = sanitized.clientId.substring(0, 4) + '****';
  }
  return sanitized;
}