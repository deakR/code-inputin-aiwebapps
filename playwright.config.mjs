import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:5179/fixtures/gemini-mock.html',
    reuseExistingServer: true,
    stdout: 'ignore',
  },
});
