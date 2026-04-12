import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineConfig({
  root: '.',
  server: {
    port: 4173,
    host: '127.0.0.1'
  },
  resolve: {
    alias: {
      'ol': resolve(__dirname, 'node_modules/ol')
    }
  }
})