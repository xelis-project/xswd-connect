/**
 * AES-256-GCM encryption utilities for end-to-end encrypted relay connections
 */

/**
 * Generate a random AES-256-GCM encryption key
 * @returns CryptoKey suitable for encryption/decryption
 */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  )
}

/**
 * Export a CryptoKey to base64 string for embedding in QR code
 * @param key - The CryptoKey to export
 * @returns Base64 encoded key
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', key)
  return btoa(String.fromCharCode(...new Uint8Array(exported)))
}

/**
 * Import a CryptoKey from base64 string (from QR code)
 * @param keyData - Base64 encoded key
 * @returns Imported CryptoKey
 */
export async function importKey(keyData: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'raw',
    raw,
    'AES-GCM',
    true,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt a message using AES-256-GCM
 * @param plaintext - Message to encrypt
 * @param key - Encryption key
 * @returns Base64 encoded encrypted message with IV prepended
 */
export async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plaintext)

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    data
  )

  // Prepend IV to ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)

  // Convert to base64
  return btoa(String.fromCharCode(...combined))
}

/**
 * Decrypt a message using AES-256-GCM
 * @param ciphertext - Base64 encoded encrypted message with IV prepended
 * @param key - Decryption key
 * @returns Decrypted plaintext message
 */
export async function decrypt(ciphertext: string, key: CryptoKey): Promise<string> {
  // Decode base64
  const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))

  // Extract IV (first 12 bytes)
  const iv = combined.slice(0, 12)
  const encrypted = combined.slice(12)

  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encrypted
  )

  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}
