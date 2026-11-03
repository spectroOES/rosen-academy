import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const STORAGE_KEY = 'rosen-calibration-v1';
type StoredStandard = { id: string; concentration: number; included: boolean; readings: number[] };

async function session(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY) as Promise<{
    lineId: string;
    mode: string;
    weighting: string;
    integration: number;
    standards: StoredStandard[];
  }>;
}

async function readings(page: Page) {
  return (await session(page)).standards.map((standard) => standard.readings);
}

async function loadDemo(page: Page) {
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(page.getByText('6/6 measured', { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Playwright supplies an isolated browser context/storage for every test.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Calibration workspace.' })).toBeVisible();
});

test('starts empty, fits demo data, and refits without reacquiring signals', async ({ page }) => {
  await expect(page.getByText('0/6 measured', { exact: true })).toBeVisible();
  await expect(page.getByText('Measure standards to build your calibration', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeDisabled();

  await loadDemo(page);
  const originalReadings = await readings(page);
  expect(originalReadings.map((values) => values.length)).toEqual([10, 3, 3, 3, 3, 3]);
  await expect(page.getByText('Fit available', { exact: true }).or(page.getByText('Review errors', { exact: true }))).toBeVisible();
  await expect(page.getByText(/Instrumental estimates: 3s \/ slope and 10s \/ slope; n = 10 blank readings/)).toBeVisible();
  const originalMeans = await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents();
  const unweightedEquation = await page.locator('.equation').innerText();

  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x²', exact: true }).click();
  await expect(page.locator('.equation')).not.toHaveText(unweightedEquation);
  expect(await readings(page)).toEqual(originalReadings);
  expect(await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents()).toEqual(originalMeans);
  await expect(page.getByText(/Qtegra legacy: Forcing = Blank/)).toBeVisible();

  const weightedEquation = await page.locator('.equation').innerText();
  await page.getByRole('checkbox', { name: 'Include Standard 5', exact: true }).uncheck();
  await expect(page.locator('.equation')).not.toHaveText(weightedEquation);
  expect(await readings(page)).toEqual(originalReadings);
  expect((await session(page)).standards.at(-1)?.included).toBe(false);
  await expect(page.getByText(/4 weighted levels \+ blank anchor/)).toBeVisible();
});

test('changing the analytical line, response, or integration clears incompatible measurements', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('group', { name: 'Analytical line', exact: true }).getByRole('button', { name: /Cu 224\.700/ }).click();
  await expect(page.getByText('0/6 measured', { exact: true })).toBeVisible();
  expect((await readings(page)).every((values) => values.length === 0)).toBe(true);
  await expect(page.getByRole('status')).toContainText('Analytical line changed');

  await loadDemo(page);
  await page.getByLabel('Response model', { exact: true }).selectOption('linear');
  await expect(page.getByText('0/6 measured', { exact: true })).toBeVisible();
  expect((await readings(page)).every((values) => values.length === 0)).toBe(true);

  await loadDemo(page);
  await page.getByLabel('Integration', { exact: true }).selectOption('10');
  await expect(page.getByText('0/6 measured', { exact: true })).toBeVisible();
  expect((await readings(page)).every((values) => values.length === 0)).toBe(true);
  expect((await session(page)).integration).toBe(10);
});

test('acquires all included standards sequentially and requires extra blanks for detection limits', async ({ page }) => {
  await page.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop acquisition', exact: true })).toBeVisible();
  await expect(page.getByLabel('Analyte', { exact: true })).toBeDisabled();
  await expect(page.getByText('6/6 measured', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible();
  expect((await readings(page)).map((values) => values.length)).toEqual([3, 3, 3, 3, 3, 3]);
  await expect(page.getByText('LOD / LOQ require at least 10 included blank readings and a positive calibration slope.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: /Acquire 10 blank readings/ }).click();
  await expect(page.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible({ timeout: 10_000 });
  expect((await readings(page))[0]).toHaveLength(13);
  await expect(page.getByText(/n = 13 blank readings/)).toBeVisible();
});

test('stopping acquisition keeps completed readings and stops adding new ones', async ({ page }) => {
  await page.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await expect.poll(async () => (await readings(page))[0].length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop acquisition', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Completed readings have been retained');
  const stoppedReadings = await readings(page);
  expect(stoppedReadings[0].length).toBeGreaterThan(0);
  expect(stoppedReadings.flat().length).toBeLessThan(18);
  await page.waitForTimeout(500);
  expect(await readings(page)).toEqual(stoppedReadings);
  await expect(page.getByLabel('Analyte', { exact: true })).toBeEnabled();
});

test('validates concentrations and invalidates only the edited standard', async ({ page }) => {
  await loadDemo(page);
  const previous = await readings(page);
  const concentration = page.getByRole('spinbutton', { name: 'Standard 1 concentration', exact: true });

  for (const invalid of ['0.001', '101']) {
    await concentration.fill(invalid);
    await concentration.press('Tab');
    await expect(page.getByRole('status')).toContainText('Enter a concentration from 0.01 to 100 ppm');
    await expect(concentration).toHaveValue('0.01');
    expect(await readings(page)).toEqual(previous);
  }
  await concentration.fill('0.1');
  await concentration.press('Tab');
  await expect(page.getByRole('status')).toContainText('Each standard must have a unique concentration');
  await expect(concentration).toHaveValue('0.01');
  expect(await readings(page)).toEqual(previous);

  await concentration.fill('0.02');
  await concentration.press('Tab');
  await expect(concentration).toHaveValue('0.02');
  await expect(page.getByText('5/6 measured', { exact: true })).toBeVisible();
  const edited = await readings(page);
  expect(edited[1]).toEqual([]);
  expect(edited.filter((_, i) => i !== 1)).toEqual(previous.filter((_, i) => i !== 1));
});

test('exports raw replicates with method metadata and restores its session after reload', async ({ page }) => {
  await loadDemo(page);
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x²', exact: true }).click();
  const beforeReload = await session(page);
  const meanTexts = await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rosen-Cu-324.754-calibration.csv');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"Replicate","Net intensity (cps)"');
  expect(csv).toContain('"Cu","324.754","saturation","1/x²","5"');
  expect(csv).toContain('"Fit summary","Value"');
  expect(csv).toContain('Synthetic educational data');
  expect(csv.split('\r\n').filter((line) => line.startsWith('"Cu",'))).toHaveLength(25);
  for (const value of beforeReload.standards.flatMap((standard) => standard.readings)) {
    expect(csv).toContain(`"${value}"`);
  }

  await page.reload();
  await expect(page.getByText('6/6 measured', { exact: true })).toBeVisible();
  expect(await session(page)).toEqual(beforeReload);
  expect(await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents()).toEqual(meanTexts);
  await expect(page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x²', exact: true })).toHaveClass(/active/);
});

test('log plotting hides only the blank point and preserves its fit inclusion and readings', async ({ page }) => {
  await loadDemo(page);
  const acquired = await readings(page);
  const equation = await page.locator('.equation').innerText();
  const chart = page.getByRole('region', { name: 'Calibration curve', exact: true });
  await expect(chart.getByRole('button', { name: /^Select Calibration blank,/ })).toHaveCount(1);
  await chart.getByRole('button', { name: 'Log x', exact: true }).click();
  await expect(chart.getByText(/zero-concentration blank is hidden on the log axis/)).toBeVisible();
  await expect(chart.getByRole('button', { name: /^Select Calibration blank,/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true })).toBeChecked();
  expect(await readings(page)).toEqual(acquired);
  await expect(page.locator('.equation')).toHaveText(equation);
  await chart.getByRole('button', { name: 'Linear', exact: true }).click();
  await expect(chart.getByRole('button', { name: /^Select Calibration blank,/ })).toHaveCount(1);
});

test('keeps the lab usable on a narrow screen and the guide keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Demo acquired');
  expect((await readings(page)).filter(values => values.length > 0)).toHaveLength(6);
  const sizes = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  const chart = page.getByRole('region', { name: 'Calibration curve', exact: true });
  await expect(chart.getByRole('button', { name: 'Log x', exact: true })).toBeVisible();
  await chart.getByRole('button', { name: 'Log x', exact: true }).click();
  await expect(chart.getByText(/zero-concentration blank is hidden/)).toBeVisible();
  await page.getByRole('button', { name: 'Lab guide', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lab guide', exact: true })).toBeFocused();
});

test('offers three lines for every element and exhibits less high-level compression on a weaker line', async ({ page }) => {
  for (const element of ['Cu', 'Cd', 'Pb', 'Fe', 'Zn']) {
    await page.getByLabel('Analyte', { exact: true }).selectOption(element);
    await expect(page.getByRole('group', { name: 'Analytical line', exact: true }).getByRole('button')).toHaveCount(3);
  }
  await page.getByLabel('Analyte', { exact: true }).selectOption('Cu');
  await loadDemo(page);
  const strong = (await session(page)).standards.find(row => row.concentration === 100)!;
  const strongRelativeResponse = strong.readings.reduce((a, b) => a + b, 0) / strong.readings.length / (52_000 * 100);
  await page.getByRole('group', { name: 'Analytical line', exact: true }).getByRole('button', { name: /Cu 224\.700/ }).click();
  await loadDemo(page);
  const weak = (await session(page)).standards.find(row => row.concentration === 100)!;
  const weakRelativeResponse = weak.readings.reduce((a, b) => a + b, 0) / weak.readings.length / (4_200 * 100);
  expect(strongRelativeResponse).toBeLessThan(0.3);
  expect(weakRelativeResponse).toBeGreaterThan(0.85);
});
