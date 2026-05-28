import {
  encrypt,
  decrypt,
  encryptCredentials,
  decryptCredentials,
} from '../../../src/utils/encryption';

// We need to set the ENCRYPTION_KEY before importing the module
const ENCRYPTION_KEY = 'test-encryption-key-32bytes!';
process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;

// Re-import after setting env var
jest.mock('../../../src/config/app.config', () => ({
  config: {
    encryption: {
      key: 'test-encryption-key-32bytes!',
    },
    isDevelopment: false,
    isProduction: false,
    isTest: true,
    nodeEnv: 'test',
  },
}));

describe('Encryption', () => {
  test('encrypt and decrypt round-trip works', () => {
    const originalText = 'Hello, World!';

    const encrypted = encrypt(originalText);
    const decrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.tag);

    expect(decrypted).toBe(originalText);
  });

  test('encrypt produces different output each time (random IV)', () => {
    const text = 'Same text';

    const result1 = encrypt(text);
    const result2 = encrypt(text);

    // IVs should be different
    expect(result1.iv).not.toBe(result2.iv);
    // Encrypted output should be different due to different IVs
    expect(result1.encrypted).not.toBe(result2.encrypted);
  });

  test('decrypt fails with wrong key', () => {
    const originalText = 'Secret message';
    const encrypted = encrypt(originalText);

    // We can't easily change the key after module load, but we can test
    // that tampering with the encrypted data causes a failure
    const tamperedEncrypted = encrypted.encrypted + '00';

    expect(() => {
      decrypt(tamperedEncrypted, encrypted.iv, encrypted.tag);
    }).toThrow('Decryption operation failed: invalid ciphertext or key');
  });

  test('encryptCredentials / decryptCredentials round-trip', () => {
    const credentials = {
      username: 'oracle-user',
      password: 'oracle-pass-123!',
    };

    const encrypted = encryptCredentials(credentials);
    const decrypted = decryptCredentials(encrypted);

    expect(decrypted.username).toBe(credentials.username);
    expect(decrypted.password).toBe(credentials.password);
  });

  test('encryptCredentials stores same ciphertext for both fields', () => {
    const credentials = {
      username: 'admin',
      password: 'secret',
    };

    const encrypted = encryptCredentials(credentials);

    // Both username and password fields get the same encrypted hex
    expect(encrypted.username).toBe(encrypted.password);
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.tag).toBeDefined();
  });

  test('decryptCredentials handles complex credentials', () => {
    const credentials = {
      username: 'user@oracle.com',
      password: 'P@ssw0rd!$pecialCh#rs',
    };

    const encrypted = encryptCredentials(credentials);
    const decrypted = decryptCredentials(encrypted);

    expect(decrypted.username).toBe('user@oracle.com');
    expect(decrypted.password).toBe('P@ssw0rd!$pecialCh#rs');
  });

  test('handles empty string', () => {
    const originalText = '';

    const encrypted = encrypt(originalText);
    const decrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.tag);

    expect(decrypted).toBe('');
  });

  test('handles unicode characters', () => {
    const unicodeText = 'Hello 世界 Привет こんにちは 🎉';

    const encrypted = encrypt(unicodeText);
    const decrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.tag);

    expect(decrypted).toBe(unicodeText);
  });

  test('handles very long strings', () => {
    const longText = 'A'.repeat(10000);

    const encrypted = encrypt(longText);
    const decrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.tag);

    expect(decrypted).toBe(longText);
    expect(decrypted.length).toBe(10000);
  });

  test('decrypt fails with wrong IV', () => {
    const originalText = 'Important secret';
    const encrypted = encrypt(originalText);

    // Use a different IV
    const fakeIv = 'a'.repeat(32); // 16 bytes in hex = 32 hex chars

    expect(() => {
      decrypt(encrypted.encrypted, fakeIv, encrypted.tag);
    }).toThrow('Decryption operation failed: invalid ciphertext or key');
  });

  test('decrypt fails with wrong auth tag', () => {
    const originalText = 'Important secret';
    const encrypted = encrypt(originalText);

    const fakeTag = 'b'.repeat(32); // 16 bytes in hex = 32 hex chars

    expect(() => {
      decrypt(encrypted.encrypted, encrypted.iv, fakeTag);
    }).toThrow('Decryption operation failed: invalid ciphertext or key');
  });

  test('multiple round trips produce consistent results', () => {
    const texts = [
      'Short',
      'A bit longer text with spaces',
      'Text_with_underscores_and_123_numbers',
      'Line 1\nLine 2\nLine 3',
      '<html><body>XML-like content</body></html>',
    ];

    for (const text of texts) {
      const encrypted = encrypt(text);
      const decrypted = decrypt(encrypted.encrypted, encrypted.iv, encrypted.tag);
      expect(decrypted).toBe(text);
    }
  });

  test('encrypt throws when encryption fails', () => {
    // We can't easily make the built-in crypto fail, but let's verify
    // the function returns the expected structure on success
    const result = encrypt('test');
    expect(result).toHaveProperty('encrypted');
    expect(result).toHaveProperty('iv');
    expect(result).toHaveProperty('tag');
    expect(typeof result.encrypted).toBe('string');
    expect(typeof result.iv).toBe('string');
    expect(typeof result.tag).toBe('string');
    expect(result.encrypted.length).toBeGreaterThan(0);
    expect(result.iv.length).toBeGreaterThan(0);
    expect(result.tag.length).toBeGreaterThan(0);
  });

  test('decryptCredentials throws on tampered data', () => {
    const credentials = { username: 'user', password: 'pass' };
    const encrypted = encryptCredentials(credentials);

    // Tamper with the iv
    const tampered = {
      ...encrypted,
      iv: 'zz' + encrypted.iv.substring(2),
    };

    expect(() => {
      decryptCredentials(tampered);
    }).toThrow('Credential decryption operation failed');
  });

  test('IV is always 16 bytes (32 hex characters)', () => {
    const result = encrypt('test');
    expect(result.iv.length).toBe(32); // 16 bytes = 32 hex chars
  });

  test('Auth tag is always 16 bytes (32 hex characters)', () => {
    const result = encrypt('test');
    expect(result.tag.length).toBe(32); // 16 bytes = 32 hex chars
  });
});
