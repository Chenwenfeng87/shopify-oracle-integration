import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { encryptCredentials, decryptCredentials } from '../utils/encryption';

/**
 * Oracle credential record stored in the database.
 * The username and password are encrypted at rest.
 */
export interface OracleCredential {
  id: string;
  storeId: string;
  username: string;
  password: string;
  baseUrl: string;
  environment: string;
  isValid: boolean;
  lastTestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Row shape returned by the database.
 */
interface OracleCredentialRow {
  id: string;
  store_id: string;
  encrypted_username: string;
  encrypted_password: string;
  encryption_iv: string;
  encryption_tag: string;
  base_url: string;
  environment: string;
  is_valid: boolean;
  last_tested_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToCredential(row: OracleCredentialRow): OracleCredential {
  try {
    const decrypted = decryptCredentials({
      username: row.encrypted_username,
      password: row.encrypted_password,
      iv: row.encryption_iv,
      tag: row.encryption_tag,
    });

    return {
      id: row.id,
      storeId: row.store_id,
      username: decrypted.username,
      password: decrypted.password,
      baseUrl: row.base_url,
      environment: row.environment,
      isValid: row.is_valid,
      lastTestedAt: row.last_tested_at ? new Date(row.last_tested_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  } catch {
    // If decryption fails, return masked credentials
    return {
      id: row.id,
      storeId: row.store_id,
      username: '***ENCRYPTED***',
      password: '***ENCRYPTED***',
      baseUrl: row.base_url,
      environment: row.environment,
      isValid: row.is_valid,
      lastTestedAt: row.last_tested_at ? new Date(row.last_tested_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}

export interface CreateCredentialInput {
  storeId: string;
  username: string;
  password: string;
  baseUrl: string;
  environment: string;
}

export interface UpdateCredentialInput {
  username?: string;
  password?: string;
  baseUrl?: string;
  environment?: string;
}

export const CredentialModel = {
  /**
   * Create a new Oracle credential record.
   * The username and password are encrypted before storage.
   */
  async create(input: CreateCredentialInput): Promise<OracleCredential> {
    const id = uuidv4();
    const now = new Date().toISOString();

    const encrypted = encryptCredentials({
      username: input.username,
      password: input.password,
    });

    const result = await query<OracleCredentialRow>(
      `INSERT INTO oracle_credentials
       (id, store_id, encrypted_username, encrypted_password, encryption_iv, encryption_tag, base_url, environment, is_valid, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $9)
       RETURNING *`,
      [
        id,
        input.storeId,
        encrypted.username,
        encrypted.password,
        encrypted.iv,
        encrypted.tag,
        input.baseUrl,
        input.environment,
        now,
      ],
    );

    return rowToCredential(result.rows[0]);
  },

  /**
   * Find Oracle credentials by store ID.
   */
  async findByStoreId(storeId: string): Promise<OracleCredential | null> {
    const result = await query<OracleCredentialRow>(
      'SELECT * FROM oracle_credentials WHERE store_id = $1',
      [storeId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToCredential(result.rows[0]);
  },

  /**
   * Update Oracle credentials for a store.
   * Only provided fields will be updated.
   */
  async update(
    storeId: string,
    input: UpdateCredentialInput,
  ): Promise<OracleCredential> {
    const now = new Date().toISOString();
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.username !== undefined || input.password !== undefined) {
      const existing = await this.findByStoreId(storeId);

      if (existing && existing.username !== '***ENCRYPTED***') {
        // We have the decrypted values from the existing record for merge
      }

      const username = input.username ?? (existing ? existing.username : '');
      const password = input.password ?? (existing ? existing.password : '');

      const encrypted = encryptCredentials({ username, password });
      setClauses.push(`encrypted_username = $${paramIndex++}`);
      params.push(encrypted.username);
      setClauses.push(`encrypted_password = $${paramIndex++}`);
      params.push(encrypted.password);
      setClauses.push(`encryption_iv = $${paramIndex++}`);
      params.push(encrypted.iv);
      setClauses.push(`encryption_tag = $${paramIndex++}`);
      params.push(encrypted.tag);
    }

    if (input.baseUrl !== undefined) {
      setClauses.push(`base_url = $${paramIndex++}`);
      params.push(input.baseUrl);
    }

    if (input.environment !== undefined) {
      setClauses.push(`environment = $${paramIndex++}`);
      params.push(input.environment);
    }

    if (setClauses.length === 0) {
      // Nothing to update, return existing
      const existing = await this.findByStoreId(storeId);
      if (!existing) {
        throw new Error('Credentials not found for store');
      }
      return existing;
    }

    setClauses.push(`updated_at = $${paramIndex++}`);
    params.push(now);

    params.push(storeId);
    const sql = `UPDATE oracle_credentials SET ${setClauses.join(', ')} WHERE store_id = $${paramIndex} RETURNING *`;

    const result = await query<OracleCredentialRow>(sql, params);

    if (result.rows.length === 0) {
      throw new Error('Credentials not found for store');
    }

    return rowToCredential(result.rows[0]);
  },

  /**
   * Mark Oracle credentials as valid (connection test passed).
   */
  async markValid(storeId: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      'UPDATE oracle_credentials SET is_valid = true, last_tested_at = $1, updated_at = $1 WHERE store_id = $2',
      [now, storeId],
    );
  },

  /**
   * Mark Oracle credentials as invalid (connection test failed).
   */
  async markInvalid(storeId: string): Promise<void> {
    const now = new Date().toISOString();
    await query(
      'UPDATE oracle_credentials SET is_valid = false, last_tested_at = $1, updated_at = $1 WHERE store_id = $2',
      [now, storeId],
    );
  },

  /**
   * Delete Oracle credentials for a store.
   */
  async delete(storeId: string): Promise<void> {
    await query(
      'DELETE FROM oracle_credentials WHERE store_id = $1',
      [storeId],
    );
  },
};
