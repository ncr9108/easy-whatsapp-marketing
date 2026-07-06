const ENCRYPTION_KEY = Deno.env.get('ENCRYPTION_KEY') || 'easy-whatsapp-default-secret-encryption-key-2026';

// Converts the configuration key into a valid SubtleCrypto 256-bit AES key
async function getCryptoKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const rawKey = encoder.encode(ENCRYPTION_KEY);
  
  // Hash configuration string with SHA-256 to ensure exact 32 bytes sizing
  const keyBuffer = await crypto.subtle.digest('SHA-256', rawKey);
  
  return await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt token string using AES-256-GCM Web Crypto
 * @param text - Plain text
 * @returns format ivHex:ciphertextHex
 */
export async function encryptToken(text: string): Promise<string> {
  if (!text) return '';
  try {
    const encoder = new TextEncoder();
    const key = await getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 12-byte standard GCM IV
    
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(text)
    );
    
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cipherHex = Array.from(new Uint8Array(ciphertext)).map(b => b.toString(16).padStart(2, '0')).join('');
    
    return `${ivHex}:${cipherHex}`;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Encryption utility failure');
  }
}

/**
 * Decrypt AES-256-GCM hexadecimal segments back to plain text
 * @param encryptedText - format ivHex:ciphertextHex
 * @returns Decrypted plain text
 */
export async function decryptToken(encryptedText: string): Promise<string> {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encryption token string format');
    }
    
    const iv = new Uint8Array(parts[0].match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const ciphertext = new Uint8Array(parts[1].match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
    const key = await getCryptoKey();
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Decryption utility failure');
  }
}
