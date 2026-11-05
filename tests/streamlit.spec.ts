import { expect, test } from '@playwright/test';
import type { FrameLocator, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type BrowserSession = {
  weighting: string;
  replicates: number;
  standards: { id: string; concentration: number; readings: number[] }[];
};

async function laboratory(page: Page) {
  // Locate the actual component iframe rather than depending on an internal
  // Streamlit-generated title or element ID.
  const component = page.locator('iframe').first();
  await expect(component).toBeVisible();
  const frame = component.contentFrame();
  await expect(frame.getByRole('heading', { name: 'Calibration workspace.' })).toBeVisible();
  return frame;
}

async function browserSession(frame: FrameLocator): Promise<BrowserSession> {
  return frame.locator('body').evaluate(() => JSON.parse(localStorage.getItem('rosen-calibration-v2-measured')!));
}

test('Streamlit serves the English laboratory, refits existing demo readings, and downloads CSV', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const frame = await laboratory(page);
  await expect(frame.getByText('0/4 measured', { exact: true })).toBeVisible();
  await expect(frame.getByLabel('Analyte', { exact: true })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible();
  await frame.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(frame.getByText('4/4 measured', { exact: true })).toBeVisible();
  const originalReadings = (await browserSession(frame)).standards.map(standard => standard.readings);
  const equation = await frame.locator('.equation').innerText();
  await frame.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x²', exact: true }).click();
  await expect(frame.locator('.equation')).not.toHaveText(equation);
  expect((await browserSession(frame)).standards.map(standard => standard.readings)).toEqual(originalReadings);

  const downloading = page.waitForEvent('download');
  await frame.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('rosen-Cu-324.754-calibration.csv');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"Cu","324.754","measured","1/x²","5"');
  expect(csv.split('\r\n').filter(line => line.startsWith('"Cu",'))).toHaveLength(19);
  for (const value of originalReadings.flat()) expect(csv).toContain(`"${value}"`);
  expect(errors).toEqual([]);
});

test('completed calibration and weighting persist when the Streamlit parent reloads', async ({ page }) => {
  await page.goto('/');
  let frame = await laboratory(page);
  await frame.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(frame.getByText('4/4 measured', { exact: true })).toBeVisible();
  await frame.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x', exact: true }).click();
  const saved = await browserSession(frame);
  const equation = await frame.locator('.equation').innerText();

  await page.reload();
  frame = await laboratory(page);
  await expect(frame.getByText('4/4 measured', { exact: true })).toBeVisible();
  expect(await browserSession(frame)).toEqual(saved);
  await expect(frame.locator('.equation')).toHaveText(equation);
  await expect(frame.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x', exact: true })).toHaveClass(/active/);
});

test('real acquisition survives multiple source-watcher polls without an iframe reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const frame = await laboratory(page);
  await frame.getByLabel('Replicates', { exact: true }).selectOption('10');
  let iframeNavigations = 0;
  let detachedFrames = 0;
  page.on('framenavigated', navigated => { if (navigated !== page.mainFrame()) iframeNavigations++; });
  page.on('framedetached', detached => { if (detached !== page.mainFrame()) detachedFrames++; });

  const started = Date.now();
  await frame.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await expect(frame.getByRole('button', { name: 'Stop acquisition', exact: true })).toBeVisible();
  await expect(frame.getByText('4/4 measured', { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(frame.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible();
  // 40 sequential readings at 210 ms span over four 2-second watcher polls.
  expect(Date.now() - started).toBeGreaterThan(7_000);
  const acquired = await browserSession(frame);
  expect(acquired.standards.map(standard => standard.readings.length)).toEqual([10, 10, 10, 10]);
  expect(iframeNavigations).toBe(0);
  expect(detachedFrames).toBe(0);
  expect(errors).toEqual([]);
});
