import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
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
    command: 'npx serve . -l 4321 -s --no-clipboard',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 15_000,
  },
})
