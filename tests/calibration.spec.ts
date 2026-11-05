import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const STORAGE_KEY = 'rosen-calibration-v3-teaching';
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
  await expect(page.getByText('4/4 measured', { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Playwright supplies an isolated browser context/storage for every test.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Calibration workspace.' })).toBeVisible();
});

test('starts empty, fits demo data, and refits without reacquiring signals', async ({ page }) => {
  await expect(page.getByText('0/4 measured', { exact: true })).toBeVisible();
  await expect(page.getByText('Measure standards to build your calibration', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV', exact: true })).toBeDisabled();

  await loadDemo(page);
  const originalReadings = await readings(page);
  expect(originalReadings.map((values) => values.length)).toEqual([10, 3, 3, 3]);
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
  await page.getByRole('checkbox', { name: 'Include Standard 3', exact: true }).uncheck();
  await expect(page.locator('.equation')).not.toHaveText(weightedEquation);
  expect(await readings(page)).toEqual(originalReadings);
  expect((await session(page)).standards.at(-1)?.included).toBe(false);
  await expect(page.getByText(/2 weighted levels \+ blank anchor/)).toBeVisible();
});

test('changing the channel clears readings but preserves the user’s concentration plan', async ({ page }) => {
  await loadDemo(page);
  const concentrations = (await session(page)).standards.map(row => row.concentration);
  await page.getByRole('group', { name: 'Analytical line', exact: true }).getByRole('button', { name: 'Mg 279.079 Radial iFR', exact: true }).click();
  await expect(page.getByText('0/4 measured', { exact: true })).toBeVisible();
  expect((await readings(page)).every(values => values.length === 0)).toBe(true);
  expect((await session(page)).standards.map(row => row.concentration)).toEqual(concentrations);
  await expect(page.getByRole('status')).toContainText('Channel changed');

  await loadDemo(page);
  await page.getByLabel('Analyte', { exact: true }).selectOption('As');
  await expect(page.getByText('0/4 measured', { exact: true })).toBeVisible();
  expect((await session(page)).standards.map(row => row.concentration)).toEqual(concentrations);
  expect((await readings(page)).every(values => values.length === 0)).toBe(true);
  const exposure = page.getByLabel('Exposure', { exact: true });
  await expect(exposure).toHaveValue('5 s');
  await expect(exposure).toHaveAttribute('readonly', '');
  expect((await session(page)).integration).toBe(5);
});

test('acquires all included standards sequentially and requires extra blanks for detection limits', async ({ page }) => {
  await page.getByRole('button', { name: 'Run calibration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop acquisition', exact: true })).toBeVisible();
  await expect(page.getByLabel('Analyte', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Observation view', { exact: true })).toBeDisabled();
  await expect(page.getByText('4/4 measured', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible();
  expect((await readings(page)).map((values) => values.length)).toEqual([3, 3, 3, 3]);
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
  expect(stoppedReadings.flat().length).toBeLessThan(12);
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
    await expect(concentration).toHaveValue('0.1');
    expect(await readings(page)).toEqual(previous);
  }
  await concentration.fill('0.5');
  await concentration.press('Tab');
  await expect(page.getByRole('status')).toContainText('Each standard must have a unique concentration');
  await expect(concentration).toHaveValue('0.1');
  expect(await readings(page)).toEqual(previous);

  await concentration.fill('0.02');
  await concentration.press('Tab');
  await expect(concentration).toHaveValue('0.02');
  await expect(page.getByText('3/4 measured', { exact: true })).toBeVisible();
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
  expect(download.suggestedFilename()).toBe('rosen-Mg-279.553-calibration.csv');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"Replicate","Intensity (cps)"');
  expect(csv).toContain('"Mg","279.553","teaching","1/x²","5"');
  expect(csv).toContain('"Fit summary","Value"');
  expect(csv).toContain('Educational line model');
  expect(csv).not.toMatch(/mixture/i);
  expect(csv.split('\r\n').filter((line) => line.startsWith('"Mg",'))).toHaveLength(19);
  for (const value of beforeReload.standards.flatMap((standard) => standard.readings)) {
    expect(csv).toContain(`"${value}"`);
  }

  await page.reload();
  await expect(page.getByText('4/4 measured', { exact: true })).toBeVisible();
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
  expect((await readings(page)).filter(values => values.length > 0)).toHaveLength(4);
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
