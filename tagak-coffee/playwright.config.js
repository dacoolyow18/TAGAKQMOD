// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const E2E_PORT = Number(process.env.TAGAK_TEST_PORT || 3100);
const E2E_BASE = `http://localhost:${E2E_PORT}`;
require('./tests/test-database');

// Playwright clears its output before globalSetup can reject a competing suite.
if (!/^[a-f0-9-]{36}$/.test(process.env.TAGAK_TEST_RUN || '')) process.env.TAGAK_TEST_RUN = require('node:crypto').randomUUID();
module.exports = defineConfig({
  outputDir: require('node:path').join(__dirname,'test-results',process.env.TAGAK_TEST_RUN),
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: require.resolve('./tests/global-setup.js'),
  use: {
    baseURL: E2E_BASE,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'api',
      testMatch: /tests\/(api|db)\/.*\.spec\.js/,
    },
    {
      name: 'desktop',
      testMatch: /tests\/e2e\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /tests\/e2e\/.*\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
  ],
});
