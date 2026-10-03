const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get the 32-byte encryption key buffer from process.env
 */
function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error('ENCRYPTION_KEY is not defined in environment variables');
  }
  const keyBuffer = Buffer.from(keyHex, 'hex');
  if (keyBuffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
  }
  return keyBuffer;
}

/**
 * Encrypt sensitive plain text using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} Encrypted string in format "iv:authTag:ciphertext" (all hex)
 */
function encrypt(text) {
  if (text === null || text === undefined || text === '') {
    return text;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt cipher text created with encrypt()
 * @param {string} cipherText - Format "iv:authTag:ciphertext"
 * @returns {string} Decrypted plain text
 */
function decrypt(cipherText) {
  if (!cipherText || typeof cipherText !== 'string' || !cipherText.includes(':')) {
    return cipherText;
  }

  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      return cipherText; // Not in encrypted format or legacy unencrypted
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption failed for payload:', error.message);
    return '[Decryption Failed]';
  }
}

/**
 * Mask card number or sensitive account string
 * e.g., "4312" -> "•••• •••• •••• 4312"
 */
function maskCardNumber(last4 = 'XXXX') {
  const sanitized = String(last4).slice(-4);
  return `•••• •••• •••• ${sanitized}`;
}

module.exports = {
  encrypt,
  decrypt,
  maskCardNumber
};
