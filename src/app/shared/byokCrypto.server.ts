const AES_GCM_IV_BYTES = 12;
export const BYOK_CRYPTO_VERSION = "v1";

type EncryptInput = {
  secret: string;
  plaintext: string;
};

type DecryptInput = {
  secret: string;
  ciphertext: string;
  iv: string;
  version: string;
};

function sanitizeSecret(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("BYOK secret is missing");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("BYOK secret is missing");
  }
  return normalized;
}

function sanitizePlaintext(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("BYOK plaintext is required");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("BYOK plaintext is required");
  }
  return normalized;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Invalid BYOK payload");
  }
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error("Invalid BYOK payload");
  }
}

async function deriveEncryptionKey(secret: string): Promise<CryptoKey> {
  const encodedSecret = new TextEncoder().encode(sanitizeSecret(secret));
  const digest = await crypto.subtle.digest("SHA-256", encodedSecret);
  return crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptByokApiKey(input: EncryptInput): Promise<{
  ciphertext: string;
  iv: string;
  version: string;
}> {
  const plaintext = sanitizePlaintext(input.plaintext);
  const key = await deriveEncryptionKey(input.secret);
  const ivBytes = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBytes },
    key,
    plaintextBytes,
  );
  return {
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
    iv: toBase64(ivBytes),
    version: BYOK_CRYPTO_VERSION,
  };
}

export async function decryptByokApiKey(input: DecryptInput): Promise<string> {
  if (input.version !== BYOK_CRYPTO_VERSION) {
    throw new Error("Unsupported BYOK key version");
  }

  const key = await deriveEncryptionKey(input.secret);
  const ivBytes = fromBase64(input.iv);
  if (ivBytes.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error("Invalid BYOK payload");
  }
  const ciphertextBytes = fromBase64(input.ciphertext);

  try {
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      key,
      ciphertextBytes,
    );
    const plaintext = new TextDecoder().decode(plaintextBuffer).trim();
    if (!plaintext) {
      throw new Error("Invalid BYOK payload");
    }
    return plaintext;
  } catch {
    throw new Error("Failed to decrypt BYOK key");
  }
}
