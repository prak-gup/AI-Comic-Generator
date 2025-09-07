import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['list']].concat(process.env.CI ? [['junit', { outputFile: 'test-results/junit.xml' }]] : []),
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      VITE_GEMINI_API_KEY: process.env.VITE_GEMINI_API_KEY || 'test-key',
    },
  },
});


