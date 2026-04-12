import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
    launchOptions: {
      args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-webgpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npx vite --config ../vite.config.js --host 127.0.0.1 --port 4322',
    url: 'http://localhost:4322/demo/demo.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
