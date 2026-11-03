import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results-streamlit',
  testMatch: /streamlit\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8501',
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
      args: ['--no-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: '.venv/bin/python -m streamlit run streamlit_app.py --server.port 8501 --server.headless true',
    url: 'http://127.0.0.1:8501/_stcore/health',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
