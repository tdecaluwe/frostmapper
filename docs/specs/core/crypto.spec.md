# Spec: `core/crypto.js`

## Purpose

Manages encrypted storage of API keys in the browser. A single master password unlocks a key store containing all API keys. Keys are encrypted using the Web Crypto API — no external libraries required. The key store persists in localStorage as a base64-encoded encrypted blob.

---

## API keys managed

| Key ID | Description |
|--------|-------------|
| `lantmateriet` | Lantmäteriet WMTS token (Sweden basemap) |
| `openrouteservice` | OpenRouteService API key (isochrones) |

---

## Interface

```javascript
class KeyStore {
  constructor({ storage })              // storage: { getItem, setItem, removeItem }
  static async unlock(masterPassword, storage)   // returns KeyStore instance
  static async create(masterPassword, keys, storage)  // returns KeyStore instance
  static isInitialised(storage)         // returns boolean
  async get(keyId)                      // returns string | null
  async set(keyId, value)               // returns void
  async lock()                          // returns void
}
```

### Storage abstraction

The storage backend is injected at construction to support both browser (localStorage) and test (in-memory Map) environments:

```javascript
// Browser
const storage = localStorage  // implements getItem/setItem/removeItem natively

// Tests
const storage = {
  _data: new Map(),
  getItem(key) { return this._data.get(key) ?? null },
  setItem(key, value) { this._data.set(key, value) },
  removeItem(key) { this._data.delete(key) }
}
```

`storage` is passed to all static methods and to the constructor. The instance stores it for use by `get`, `set`, and `lock`.

---

## Encryption scheme

### Key derivation
Master password → AES-GCM encryption key via PBKDF2:
- Algorithm: PBKDF2
- Hash: SHA-256
- Iterations: 100,000
- Salt: 16 random bytes, stored alongside the encrypted blob
- Derived key: AES-GCM 256-bit

### Encryption
- Algorithm: AES-GCM
- IV: 12 random bytes, generated fresh on every write, stored alongside the ciphertext
- Plaintext: `JSON.stringify({ lantmateriet: '...', openrouteservice: '...' })`
- Output stored in localStorage as a single base64-encoded JSON object:

```json
{
  "salt": "<base64>",
  "iv": "<base64>",
  "ciphertext": "<base64>"
}
```

localStorage key: `geo-scouting-keystore`

---

## `static async unlock(masterPassword, storage)`

Attempts to decrypt the stored key store blob using the provided master password.

### Algorithm
1. Read blob from `storage.getItem('geo-scouting-keystore')`. If not found, throw `KeyStoreNotInitialisedError`.
2. Decode salt, iv, ciphertext from base64.
3. Derive AES-GCM key from `masterPassword` + `salt` via PBKDF2.
4. Decrypt ciphertext using derived key + iv.
5. Parse decrypted JSON into key map.
6. Hold derived key and key map in memory (never in storage).
7. Return `KeyStore` instance with `storage` stored on the instance.

If decryption fails (wrong password or corrupted data): throw `KeyStoreDecryptionError`.

---

## `static async create(masterPassword, keys = {}, storage)`

Initialises a new key store. Overwrites any existing stored blob.

### Algorithm
1. Generate random 16-byte salt.
2. Generate random 12-byte IV.
3. Derive AES-GCM key from `masterPassword` + `salt` via PBKDF2.
4. Encrypt `JSON.stringify(keys)` using derived key + IV.
5. Encode salt, IV, ciphertext as base64. Store JSON blob via `storage.setItem('geo-scouting-keystore', blob)`.
6. Return `KeyStore` instance with key map and `storage` stored in memory.

---

## `static isInitialised(storage)`

Returns `true` if a key store blob exists in `storage`, `false` otherwise. Does not attempt decryption.

---

## `async get(keyId)`

Returns the stored value for `keyId`, or `null` if not set. Throws `KeyStoreLockedError` if called before `unlock()` or `create()`.

---

## `async set(keyId, value)`

Updates a single key in the in-memory map and re-encrypts + re-stores the full blob with a new IV. Throws `KeyStoreLockedError` if locked.

---

## `async lock()`

Clears the in-memory key map and derived crypto key. The blob remains in localStorage — the user must call `unlock()` again to access keys.

---

## Error types

```javascript
class KeyStoreNotInitialisedError extends Error {}  // no blob in localStorage
class KeyStoreDecryptionError extends Error {}       // wrong password or corrupted
class KeyStoreLockedError extends Error {}           // get/set called before unlock
```

---

## Usage in app

On app launch:
1. Check `KeyStore.isInitialised()`
2. If false: show "create" prompt — call `KeyStore.create(password, {})`
3. If true: show "unlock" prompt — call `KeyStore.unlock(password)`
4. Pass `KeyStore` instance to UI components that need API keys
5. UI components call `keyStore.get('lantmateriet')` etc. when initialising sources

Keys can be updated at any time via the API Keys panel in the UI without relocking.

---

## Security notes

- The derived crypto key is held in memory as a `CryptoKey` object (non-extractable). It is never serialised or logged.
- The plaintext key map is held in memory as a plain JS object. It is cleared on `lock()`.
- localStorage stores only the encrypted blob — no plaintext keys ever touch localStorage.
- A fresh IV is generated on every write to prevent IV reuse.
- PBKDF2 with 100,000 iterations makes brute-force attacks on the master password expensive.
- This scheme provides protection against casual inspection of localStorage but is not a substitute for a proper secrets manager. It is appropriate for a personal tool.

---

## Test cases

### 1. Create and retrieve
Call `create('password123', { lantmateriet: 'abc' })`. Call `get('lantmateriet')`. Verify returns `'abc'`.

### 2. Persist and unlock
Call `create('password123', { lantmateriet: 'abc' })`. Simulate page refresh (create new instance). Call `unlock('password123')`. Call `get('lantmateriet')`. Verify returns `'abc'`.

### 3. Wrong password
Call `create('password123', {})`. Call `unlock('wrongpassword')`. Verify throws `KeyStoreDecryptionError`.

### 4. Set and re-unlock
Call `create('password123', {})`. Call `set('openrouteservice', 'xyz')`. Simulate page refresh. Call `unlock('password123')`. Verify `get('openrouteservice')` returns `'xyz'`.

### 5. Lock clears memory
Call `create('password123', { lantmateriet: 'abc' })`. Call `lock()`. Call `get('lantmateriet')`. Verify throws `KeyStoreLockedError`.

### 6. isInitialised
Clear localStorage. Verify `isInitialised()` returns false. Call `create('password123', {})`. Verify `isInitialised()` returns true.

### 7. IV uniqueness
Call `set()` twice. Inspect stored blob both times. Verify IV differs between writes.

### 8. unlock before create
Clear localStorage. Call `unlock('password123')`. Verify throws `KeyStoreNotInitialisedError`.

### 9. get missing key returns null
Call `create('password123', {})`. Call `get('lantmateriet')`. Verify returns `null` (not throws).

### 10. set while locked
Call `create('password123', {})`. Call `lock()`. Call `set('lantmateriet', 'abc')`. Verify throws `KeyStoreLockedError`.

### 11. corrupted blob
Call `create('password123', {})`. Manually corrupt the localStorage blob (replace ciphertext with random bytes). Call `unlock('password123')`. Verify throws `KeyStoreDecryptionError` rather than unhandled error.

### 12. create overwrites existing store
Call `create('password123', { lantmateriet: 'abc' })`. Call `create('newpassword', { lantmateriet: 'xyz' })`. Call `unlock('newpassword')`. Verify `get('lantmateriet')` returns `'xyz'`. Verify `unlock('password123')` throws `KeyStoreDecryptionError`.
