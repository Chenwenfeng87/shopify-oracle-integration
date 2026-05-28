import crypto from 'crypto';
import { config } from '../config/app.config';
import { logger } from './logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derive a 256-bit key from the configured encryption key.
 * If the key is already 32 bytes, use it directly.
 * Otherwise, derive via SHA-256 to normalize to 32 bytes.
 */
function getDerivedKey(): Buffer {
  const key = config.encryption.key;
  const keyBuffer = Buffer.from(key, 'utf8');

  if (keyBuffer.length === KEY_LENGTH) {
    return keyBuffer;
  }

  if (keyBuffer.length > KEY_LENGTH) {
    return keyBuffer.subarray(0, KEY_LENGTH);
  }

  // Use SHA-256 to derive a 32-byte key from shorter input
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * Generates a random initialization vector (IV) for each encryption,
 * ensuring that the same plaintext produces different ciphertext each time.
 *
 * @param text - The plaintext string to encrypt
 * @returns An object containing the encrypted data (hex), IV (hex), and auth tag (hex)
 */
export function encrypt(text: string): { encrypted: string; iv: string; tag: string } {
  try {
    const key = getDerivedKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(text, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return {
      encrypted: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  } catch (error) {
    logger.error('Encryption failed', {
      error: (error as Error).message,
    });
    throw new Error('Encryption operation failed');
  }
}

/**
 * Decrypt a ciphertext string that was encrypted with AES-256-GCM.
 *
 * @param encrypted - The encrypted data (hex string)
 * @param iv - The initialization vector used during encryption (hex string)
 * @param tag - The authentication tag (hex string)
 * @returns The decrypted plaintext string
 */
export function decrypt(encrypted: string, iv: string, tag: string): string {
  try {
    const key = getDerivedKey();
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    logger.error('Decryption failed', {
      error: (error as Error).message,
    });
    throw new Error('Decryption operation failed: invalid ciphertext or key');
  }
}

/**
 * Encrypt Oracle credentials (username and password).
 *
 * Both fields are encrypted together as a single JSON blob so they share
 * the same IV and auth tag, reducing storage overhead.
 *
 * @param credentials - Object containing username and password
 * @returns The encrypted credentials with IV and tag
 */
export function encryptCredentials(credentials: {
  username: string;
  password: string;
}): { username: string; password: string; iv: string; tag: string } {
  try {
    const key = getDerivedKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const payload = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
      cipher.update(payload, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Split the encrypted payload into username and password portions
    // for storage compatibility. Both are the same ciphertext with same IV/tag.
    const encryptedHex = encrypted.toString('hex');

    return {
      username: encryptedHex,
      password: encryptedHex,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  } catch (error) {
    logger.error('Credential encryption failed', {
      error: (error as Error).message,
    });
    throw new Error('Credential encryption operation failed');
  }
}

/**
 * Decrypt Oracle credentials that were encrypted with encryptCredentials.
 *
 * @param encrypted - Object containing encrypted username, password, IV, and tag
 * @returns The decrypted username and password
 */
export function decryptCredentials(encrypted: {
  username: string;
  password: string;
  iv: string;
  tag: string;
}): { username: string; password: string } {
  try {
    const key = getDerivedKey();
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(encrypted.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.username, 'hex')),
      decipher.final(),
    ]);

    const payload = JSON.parse(decrypted.toString('utf8'));

    return {
      username: payload.username,
      password: payload.password,
    };
  } catch (error) {
    logger.error('Credential decryption failed', {
      error: (error as Error).message,
    });
    throw new Error('Credential decryption operation failed');
  }
}
