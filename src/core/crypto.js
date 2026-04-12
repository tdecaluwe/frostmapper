/**
 * core/crypto.js
 *
 * Encrypted key store using the Web Crypto API.
 * Keys are encrypted with AES-GCM derived from a master password via PBKDF2.
 * The encrypted blob is stored in localStorage (or an injected storage for testing).
 *
 * No external libraries required.
 */

const STORAGE_KEY      = 'geo-scouting-keystore'
const PBKDF2_ITERS     = 100_000
const PBKDF2_HASH      = 'SHA-256'
const AES_KEY_BITS     = 256
const AES_ALGORITHM    = 'AES-GCM'
const PBKDF2_ALGORITHM = 'PBKDF2'

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class KeyStoreNotInitialisedError extends Error {
  constructor() { super('KeyStore is not initialised — no blob in storage'); this.name = 'KeyStoreNotInitialisedError' }
}

export class KeyStoreDecryptionError extends Error {
  constructor() { super('KeyStore decryption failed — wrong password or corrupted data'); this.name = 'KeyStoreDecryptionError' }
}

export class KeyStoreLockedError extends Error {
  constructor() { super('KeyStore is locked — call unlock() or create() first'); this.name = 'KeyStoreLockedError' }
}

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

/** Default storage: localStorage in browser, Map-backed in Node.js */
function createDefaultStorage() {
  if (typeof localStorage !== 'undefined') return localStorage
  // Node.js fallback: in-memory map (module-level, shared across instances)
  return _nodeStorage
}

// Shared in-memory storage for Node.js tests
export const _nodeStorage = {
  _map: new Map(),
  getItem(key)        { return this._map.get(key) ?? null },
  setItem(key, value) { this._map.set(key, value) },
  removeItem(key)     { this._map.delete(key) },
  clear()             { this._map.clear() },
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str)
}

function fromBase64(b64) {
  const str = atob(b64)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return bytes.buffer
}

async function deriveKey(password, salt) {
  const subtle  = globalThis.crypto.subtle
  const keyMat = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: PBKDF2_ALGORITHM },
    false,
    ['deriveKey']
  )
  return subtle.deriveKey(
    { name: PBKDF2_ALGORITHM, salt, iterations: PBKDF2_ITERS, hash: PBKDF2_HASH },
    keyMat,
    { name: AES_ALGORITHM, length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encrypt(cryptoKey, iv, plaintext) {
  const subtle   = globalThis.crypto.subtle
  const encoded  = new TextEncoder().encode(plaintext)
  return subtle.encrypt({ name: AES_ALGORITHM, iv }, cryptoKey, encoded)
}

async function decrypt(cryptoKey, iv, ciphertext) {
  const subtle = globalThis.crypto.subtle
  return subtle.decrypt({ name: AES_ALGORITHM, iv }, cryptoKey, ciphertext)
}

// ---------------------------------------------------------------------------
// KeyStore class
// ---------------------------------------------------------------------------

export class KeyStore {
  /** @private */
  constructor(cryptoKey, keyMap, storage) {
    this._key     = cryptoKey  // CryptoKey — non-extractable
    this._keys    = keyMap     // plain JS object { [keyId]: value }
    this._storage = storage    // storage interface
  }

  // ---------------------------------------------------------------------------
  // Static factory methods
  // ---------------------------------------------------------------------------

  /**
   * Create a new key store, replacing any existing one.
   *
   * @param {string}  masterPassword
   * @param {object}  [keys={}]    - Initial key values
   * @param {object}  [storage]    - Storage interface (for testing)
   * @returns {Promise<KeyStore>}
   */
  static async create(masterPassword, keys = {}, storage) {
    const st = storage ?? createDefaultStorage()
    const subtle = globalThis.crypto.subtle

    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16))
    const iv   = globalThis.crypto.getRandomValues(new Uint8Array(12))

    const cryptoKey  = await deriveKey(masterPassword, salt)
    const ciphertext = await encrypt(cryptoKey, iv, JSON.stringify(keys))

    const blob = JSON.stringify({
      salt:       toBase64(salt.buffer),
      iv:         toBase64(iv.buffer),
      ciphertext: toBase64(ciphertext),
    })
    st.setItem(STORAGE_KEY, blob)

    return new KeyStore(cryptoKey, { ...keys }, st)
  }

  /**
   * Unlock an existing key store using the master password.
   *
   * @param {string}  masterPassword
   * @param {object}  [storage]    - Storage interface (for testing)
   * @returns {Promise<KeyStore>}
   * @throws {KeyStoreNotInitialisedError}
   * @throws {KeyStoreDecryptionError}
   */
  static async unlock(masterPassword, storage) {
    const st   = storage ?? createDefaultStorage()
    const raw  = st.getItem(STORAGE_KEY)
    if (!raw) throw new KeyStoreNotInitialisedError()

    let blob
    try { blob = JSON.parse(raw) } catch { throw new KeyStoreDecryptionError() }

    const salt       = new Uint8Array(fromBase64(blob.salt))
    const iv         = new Uint8Array(fromBase64(blob.iv))
    const ciphertext = fromBase64(blob.ciphertext)

    const cryptoKey = await deriveKey(masterPassword, salt)

    let plaintext
    try {
      const decrypted = await decrypt(cryptoKey, iv, ciphertext)
      plaintext = new TextDecoder().decode(decrypted)
    } catch {
      throw new KeyStoreDecryptionError()
    }

    let keys
    try { keys = JSON.parse(plaintext) } catch { throw new KeyStoreDecryptionError() }

    return new KeyStore(cryptoKey, keys, st)
  }

  /**
   * Check whether a key store blob exists in storage without attempting decryption.
   *
   * @param {object} [storage] - Storage interface (for testing)
   * @returns {boolean}
   */
  static isInitialised(storage) {
    const st = storage ?? createDefaultStorage()
    return st.getItem(STORAGE_KEY) !== null
  }

  // ---------------------------------------------------------------------------
  // Instance methods
  // ---------------------------------------------------------------------------

  /**
   * Get the value of a stored key.
   *
   * @param {string} keyId
   * @returns {string | null}
   * @throws {KeyStoreLockedError}
   */
  async get(keyId) {
    if (!this._key) throw new KeyStoreLockedError()
    return this._keys[keyId] ?? null
  }

  /**
   * Update a key value, re-encrypting and re-storing the full blob with a fresh IV.
   *
   * @param {string} keyId
   * @param {string} value
   * @throws {KeyStoreLockedError}
   */
  async set(keyId, value) {
    if (!this._key) throw new KeyStoreLockedError()
    this._keys[keyId] = value

    const iv         = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const raw        = JSON.parse(this._storage.getItem(STORAGE_KEY))
    const salt       = new Uint8Array(fromBase64(raw.salt))
    const ciphertext = await encrypt(this._key, iv, JSON.stringify(this._keys))

    const blob = JSON.stringify({
      salt:       toBase64(salt.buffer),
      iv:         toBase64(iv.buffer),
      ciphertext: toBase64(ciphertext),
    })
    this._storage.setItem(STORAGE_KEY, blob)
  }

  /**
   * Lock the key store, clearing the in-memory key map and crypto key.
   */
  async lock() {
    this._key  = null
    this._keys = null
  }
}

// ---------------------------------------------------------------------------
// Convenience module-level API (backwards-compatible)
// ---------------------------------------------------------------------------

let _keystoreInstance = null
let _unlockedKeys = null

export function hasKeystore(storage) {
  return KeyStore.isInitialised(storage)
}

export async function initKeystore(password, storage) {
  const ks = await KeyStore.create(password, {}, storage)
  _keystoreInstance = ks
  _unlockedKeys = { ...ks._keys }
  return ks
}

export async function unlockKeystore(password, storage) {
  const ks = await KeyStore.unlock(password, storage)
  _keystoreInstance = ks
  _unlockedKeys = { ...ks._keys }
  return ks
}

export function isUnlocked() {
  return _keystoreInstance !== null && _unlockedKeys !== null
}

export function getKey(keyId) {
  if (!_unlockedKeys) return null
  return _unlockedKeys[keyId] ?? null
}

export async function setKey(keyId, value) {
  if (!_keystoreInstance) throw new KeyStoreLockedError()
  await _keystoreInstance.set(keyId, value)
  _unlockedKeys[keyId] = value
}

export function keyStatus() {
  return {
    lantmateriet: !!(_unlockedKeys && _unlockedKeys.lantmateriet),
    openrouteservice: !!(_unlockedKeys && _unlockedKeys.openrouteservice),
  }
}
