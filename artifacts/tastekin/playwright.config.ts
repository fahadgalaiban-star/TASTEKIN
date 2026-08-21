import { defineConfig } from '@playwright/test';

const baseURL = process.env.TASTEKIN_BASE_URL ?? 'http://127.0.0.1:23385';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 15_000,
  reporter: 'list',
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          },
        }
      : {}),
  },
  webServer: process.env.TASTEKIN_BASE_URL
    ? undefined
    : {
        command: 'PORT=23385 BASE_PATH=/ pnpm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});