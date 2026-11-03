import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

test('self-contained HTML supports real offline acquisition and CSV export', async ({ browser }) => {
  const filename = resolve('dist/rosen-academy.html');
  test.skip(!existsSync(filename), 'Run npm run build:standalone to validate the downloadable simulator.');
  const context = await browser.newContext({ offline: true, acceptDownloads: true });
  // The managed Chromium policy blocks file:// navigation. Supply the file at a
  // permitted test origin with networking disabled; every byte comes from disk.
  const simulatorURL = 'http://127.0.0.1:5173/offline-simulator.html';
  const html = await readFile(filename);
  await context.route(simulatorURL, route => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && request.url() !== simulatorURL) requests.push(request.url()); });
  await page.goto(simulatorURL);
  await expect(page.getByRole('heading', { name: 'Calibration workspace.' })).toBeVisible();
  await page.getByRole('link', { name: 'Rosen Academy home' }).click();
  await expect(page).toHaveURL(simulatorURL + '#top');
  await page.getByLabel('Response model', { exact: true }).selectOption('linear');
  await page.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await expect(page.getByText('6/6 measured', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible();
  await expect(page.locator('.standards-table tbody tr').last().locator('td').nth(3)).not.toHaveText('—');
  const means = await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents();
  const equation = await page.locator('.equation').textContent();
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x²', exact: true }).click();
  await expect(page.locator('.equation')).not.toHaveText(equation!);
  expect(await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents()).toEqual(means);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/calibration\.csv$/);
  await page.reload();
  await expect(page.getByText('6/6 measured', { exact: true })).toBeVisible();
  expect(await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents()).toEqual(means);
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
  await context.close();
});
