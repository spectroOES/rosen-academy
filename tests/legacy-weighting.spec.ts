import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const modelVersion = readFileSync(new URL('../src/lib/teaching-method.ts', import.meta.url), 'utf8').match(/TEACHING_MODEL_VERSION\s*=\s*['"]([^'"]+)['"]/)![1];

const KEY = 'rosen-calibration-v3-teaching';
const blankReadings = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3];
const fixture = {
  sourceHash: modelVersion, lineId: 'mg-279553-radial-ifr', mode: 'teaching', weighting: 'none', replicates: 3, integration: 5, sequence: 1,
  standards: [
    { id: 'b', name: 'Calibration blank', concentration: 0, included: true, readings: blankReadings },
    { id: 's1', name: 'Standard 1', concentration: 1, included: true, readings: [4, 5, 6] },
    { id: 's2', name: 'Standard 2', concentration: 2, included: true, readings: [7, 8, 9] },
    { id: 's3', name: 'Standard 3', concentration: 4, included: true, readings: [10, 11, 12] },
  ],
};
const fields = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"'));
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY) as Promise<typeof fixture>;
async function seed(page: Page) {
  await page.goto('/');
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: KEY, state: fixture });
  await page.reload();
}
async function csv(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const file = await (await downloading).path();
  return (await readFile(file!, 'utf8')).split('\r\n').map(fields);
}

test('legacy concentration weights fix the blank intercept and export no numeric blank weight', async ({ page }) => {
  await seed(page);
  const original = (await saved(page)).standards.map(row => row.readings);
  for (const [label, expectedSlope] of [['1/x', 18 / 7], ['1/x²', 11 / 4]] as const) {
    await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByText('Forcing: Blank (legacy)', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    const blank = page.locator('.standards-table tbody tr').first();
    await expect(blank.locator('.regression-weight')).toHaveText('ANCHOR');
    await expect(blank.locator('td').nth(6)).toHaveText('0');
    await expect(page.getByText('Blank anchor', { exact: true })).toBeVisible();
    expect((await saved(page)).standards.map(row => row.readings)).toEqual(original);
    const rows = await csv(page);
    const metric = (name: string) => Number(rows.find(row => row[0] === name)![1]);
    expect(metric('Slope (cps/ppm)')).toBeCloseTo(expectedSlope, 12);
    expect(metric('Intercept (cps)')).toBe(2);
    expect(metric('Regression observation count')).toBe(3);
    expect(metric('Fitted parameter count')).toBe(1);
    expect(metric('Residual SE degrees of freedom')).toBe(2);
    expect(metric('Estimated instrumental LOD (ppm)')).toBeCloseTo(3 * Math.sqrt(10 / 9) / expectedSlope, 12);
    const blankRow = rows.find(row => row[0] === 'Mg' && row[5] === 'Calibration blank')!;
    expect(blankRow.at(-2)).toBe('anchor');
    expect(blankRow.at(-1)).toBe('');
  }
  const chart = page.getByRole('region', { name: 'Calibration curve', exact: true });
  await chart.getByRole('button', { name: 'Log x', exact: true }).click();
  await expect(chart.getByText(/It still fixes the intercept and is excluded from regression weights/)).toBeVisible();
  await expect(chart.getByRole('button', { name: /^Select Calibration blank,/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true })).toBeChecked();
  await page.reload();
  await expect(page.getByText('Forcing: Blank (legacy)', { exact: true })).toBeVisible();
  expect((await saved(page)).standards.map(row => row.readings)).toEqual(original);
});

test('an excluded or unmeasured blank blocks legacy fitting without silently forcing zero', async ({ page }) => {
  await seed(page);
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true }).uncheck();
  await expect(page.getByRole('alert')).toContainText('included, measured calibration blank');
  await expect(page.locator('.fit-status')).toHaveText('Weighting needs data');
  const rows = await csv(page);
  expect(rows.some(row => row[0] === 'Intercept (cps)')).toBe(false);
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: 'None', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Free intercept', { exact: true })).toBeVisible();
  const state = await saved(page);
  state.standards[0].included = true;
  state.standards[0].readings = [];
  state.weighting = '1/x2';
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: KEY, state });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('included, measured calibration blank');
});

test('remeasuring only the blank updates its anchor and slope while preserving nonzero measurements', async ({ page }) => {
  await seed(page);
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x', exact: true }).click();
  const before = await saved(page);
  await page.getByRole('button', { name: 'Measure Calibration blank', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible();
  const after = await saved(page);
  expect(after.standards.slice(1).map(row => row.readings)).toEqual(before.standards.slice(1).map(row => row.readings));
  const blankMean = after.standards[0].readings.reduce((sum, value) => sum + value, 0) / after.standards[0].readings.length;
  const rows = await csv(page);
  expect(Number(rows.find(row => row[0] === 'Intercept (cps)')![1])).toBeCloseTo(blankMean, 12);
  // For this fixture 1/c cancels c in the numerator and sum(c)=7.
  expect(Number(rows.find(row => row[0] === 'Slope (cps/ppm)')![1])).toBeCloseTo((5 + 8 + 11 - 3 * blankMean) / 7, 12);
});
