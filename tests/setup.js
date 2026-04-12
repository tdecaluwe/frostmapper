/**
 * tests/setup.js
 *
 * Vitest global setup: polyfill Web Crypto API for Node.js test environment.
 */

import { webcrypto } from 'node:crypto'
import p4 from 'proj4'

// Make proj4 available on the global (simulates the CDN <script> in the browser).
// primitives.js and layer.js no longer import proj4 directly; they read globalThis.proj4.
globalThis.proj4 = p4

// In Node 18 the globalThis.crypto may not be set in vitest's sandboxed context.
// Explicitly set it so our modules (crypto.js, primitives.js etc.) can use it.
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    writable: false,
    configurable: true,
  })
}

// btoa / atob may also be missing in older Node test environments
if (!globalThis.btoa) {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64')
  globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary')
}
