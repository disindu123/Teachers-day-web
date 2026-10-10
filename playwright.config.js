import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:9080',
    headless: true,
    launchOptions: process.env.SCMU_BROWSER_PATH
      ? {
          executablePath: process.env.SCMU_BROWSER_PATH,
          args: [
            '--no-sandbox',
            '--no-zygote',
            '--disable-webgl',
            '--single-process',
            '--in-process-gpu',
            '--disable-gpu',
          ],
        }
      : {},
  },
  webServer: {
    command: 'node tests/browser-server.js',
    url: 'http://127.0.0.1:9080/api/health',
    reuseExistingServer: false,
  },
  reporter: 'list',
  timeout: 25_000,
});
