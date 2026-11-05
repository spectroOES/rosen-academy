import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const modelVersion = readFileSync(new URL('../src/lib/teaching-method.ts', import.meta.url), 'utf8').match(/TEACHING_MODEL_VERSION\s*=\s*['"]([^'"]+)['"]/)![1];

const KEY = 'rosen-calibration-v3-teaching';
const blankReadings = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3];
const fixture = {
  sourceHash: modelVersion, lineId: 'mg-279553-radial-ifr', mode: 'teaching', weighting: 'none', forcing: 'none', replicates: 3, integration: 5, sequence: 1,
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

test('explicit blank forcing fixes concentration-weighted fits and exports no numeric blank weight', async ({ page }) => {
  await seed(page);
  const original = (await saved(page)).standards.map(row => row.readings);
  await page.getByLabel('Intercept', { exact: true }).selectOption('blank');
  for (const [label, expectedSlope] of [['1/x', 18 / 7], ['1/x²', 11 / 4]] as const) {
    await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByLabel('Intercept', { exact: true })).toHaveValue('blank');
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
  await expect(page.getByLabel('Intercept', { exact: true })).toHaveValue('blank');
  expect((await saved(page)).standards.map(row => row.readings)).toEqual(original);
});

test('an excluded or unmeasured blank blocks explicit forcing until free intercept is selected', async ({ page }) => {
  await seed(page);
  await page.getByLabel('Intercept', { exact: true }).selectOption('blank');
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true }).uncheck();
  await expect(page.getByRole('alert')).toContainText('included, measured calibration blank');
  await expect(page.locator('.fit-status')).toHaveText('Fit needs data');
  const rows = await csv(page);
  expect(rows.some(row => row[0] === 'Intercept (cps)')).toBe(false);
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: 'None', exact: true }).click();
  await expect(page.getByLabel('Intercept', { exact: true })).toHaveValue('blank');
  await expect(page.getByRole('alert')).toContainText('included, measured calibration blank');
  await page.getByLabel('Intercept', { exact: true }).selectOption('none');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const state = await saved(page);
  state.standards[0].included = true;
  state.standards[0].readings = [];
  state.weighting = '1/x2';
  state.forcing = 'blank';
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: KEY, state });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('included, measured calibration blank');
});

test('remeasuring only the blank updates its anchor and slope while preserving nonzero measurements', async ({ page }) => {
  await seed(page);
  await page.getByLabel('Intercept', { exact: true }).selectOption('blank');
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

test('intercept selection refits the same readings with independently checked coefficients and diagnostics', async ({ page }) => {
  await seed(page);
  const intercept = page.getByLabel('Intercept', { exact: true });
  await expect(intercept).toHaveValue('none');
  const original = await saved(page);
  const means = await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents();
  const rsds = await page.locator('.standards-table tbody tr td:nth-child(5)').allTextContents();
  const freeRows = await csv(page);
  const value = (rows: string[][], name: string) => Number(rows.find(row => row[0] === name)![1]);
  // Hand-calculated OLS for x=[0,1,2,4], y=[2,5,8,11].
  expect(value(freeRows, 'Slope (cps/ppm)')).toBeCloseTo(78 / 35, 12);
  expect(value(freeRows, 'Intercept (cps)')).toBeCloseTo(13 / 5, 12);
  expect(value(freeRows, 'Regression observation count')).toBe(4);
  expect(value(freeRows, 'Fitted parameter count')).toBe(2);
  expect(value(freeRows, 'Residual standard error (cps)')).toBeCloseTo(Math.sqrt(27 / 35), 12);
  const freeStandard = freeRows.find(row => row[0] === 'Mg' && row[5] === 'Standard 1')!;
  expect(Number(freeStandard[13])).toBeCloseTo(14 / 13, 12);
  expect(Number(freeStandard[14])).toBeCloseTo(100 / 13, 12);
  expect(freeRows.find(row => row[0] === 'Effective forcing')![1]).toBe('None');
  expect(freeRows.find(row => row[0] === 'Internal standard correction')![1]).toBe('None');
  await expect(page.getByText('Blank anchor', { exact: true })).toHaveCount(0);

  await intercept.selectOption('blank');
  const forcedRows = await csv(page);
  // With b fixed to blank mean2, slope=(3+12+36)/(1+4+16)=17/7.
  expect(value(forcedRows, 'Slope (cps/ppm)')).toBeCloseTo(17 / 7, 12);
  expect(value(forcedRows, 'Intercept (cps)')).toBe(2);
  expect(value(forcedRows, 'Regression observation count')).toBe(3);
  expect(value(forcedRows, 'Fitted parameter count')).toBe(1);
  expect(value(forcedRows, 'Residual standard error (cps)')).toBeCloseTo(Math.sqrt(15 / 14), 12);
  const forcedStandard = forcedRows.find(row => row[0] === 'Mg' && row[5] === 'Standard 1')!;
  expect(Number(forcedStandard[13])).toBeCloseTo(21 / 17, 12);
  expect(Number(forcedStandard[14])).toBeCloseTo(400 / 17, 12);
  expect(forcedRows.find(row => row[0] === 'Effective forcing')![1]).toBe('Blank');
  expect(value(forcedRows, 'Estimated instrumental LOD (ppm)')).not.toBe(value(freeRows, 'Estimated instrumental LOD (ppm)'));
  await expect(page.getByText('Blank anchor', { exact: true })).toBeVisible();
  const blank = page.locator('.standards-table tbody tr').first();
  await expect(blank.locator('.regression-weight')).toHaveText('ANCHOR');
  expect((await saved(page)).standards).toEqual(original.standards);
  expect(await page.locator('.standards-table tbody tr td:nth-child(4)').allTextContents()).toEqual(means);
  expect(await page.locator('.standards-table tbody tr td:nth-child(5)').allTextContents()).toEqual(rsds);
  await intercept.selectOption('none');
  const restoredRows = await csv(page);
  expect(value(restoredRows, 'Slope (cps/ppm)')).toBe(value(freeRows, 'Slope (cps/ppm)'));
  expect(value(restoredRows, 'Intercept (cps)')).toBe(value(freeRows, 'Intercept (cps)'));
  expect((await saved(page)).standards).toEqual(original.standards);
});

test('free inverse-concentration fits omit the zero blank and keep forcing independent of all weightings', async ({ page }) => {
  await seed(page);
  const original = (await saved(page)).standards;
  const intercept = page.getByLabel('Intercept', { exact: true });
  for (const [label, slope, offset] of [['1/x', 27 / 13, 41 / 13], ['1/x²', 9 / 4, 20 / 7]] as const) {
    await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: label, exact: true }).click();
    await expect(intercept).toHaveValue('none');
    await expect(page.getByRole('alert')).toHaveCount(0);
    const blank = page.locator('.standards-table tbody tr').first();
    await expect(blank.locator('.regression-weight')).toHaveText('NO WEIGHT');
    await expect(page.getByText('Blank anchor', { exact: true })).toHaveCount(0);
    const rows = await csv(page);
    expect(Number(rows.find(row => row[0] === 'Slope (cps/ppm)')![1])).toBeCloseTo(slope, 12);
    expect(Number(rows.find(row => row[0] === 'Intercept (cps)')![1])).toBeCloseTo(offset, 12);
    expect(Number(rows.find(row => row[0] === 'Regression observation count')![1])).toBe(3);
    expect(Number(rows.find(row => row[0] === 'Fitted parameter count')![1])).toBe(2);
    expect(rows.find(row => row[0] === 'Mg' && row[5] === 'Calibration blank')!.slice(-2)).toEqual(['omitted', '']);
  }
  await page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true }).uncheck();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.equation')).not.toContainText('measure at least');
  await page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true }).check();
  await intercept.selectOption('blank');
  for (const label of ['None', '1/x', '1/x²', '1/SD²', '1/RSD²']) {
    await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: label, exact: true }).click();
    await expect(intercept).toHaveValue('blank');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.standards-table tbody tr').first().locator('.regression-weight')).toHaveText('ANCHOR');
    expect((await saved(page)).standards).toEqual(original);
    const rows = await csv(page);
    expect(Number(rows.find(row => row[0] === 'Intercept (cps)')![1])).toBe(2);
  }
  await page.reload();
  await expect(intercept).toHaveValue('blank');
  expect((await saved(page)).standards).toEqual(original);
});

test('older sessions infer their former forcing once and retain every reading during migration', async ({ page }) => {
  await page.goto('/');
  const { forcing: _, ...older } = structuredClone(fixture);
  for (const [weighting, expected] of [['none', 'none'], ['1/x', 'blank'], ['1/x2', 'blank'], ['1/SD2', 'none']] as const) {
    const state = { ...older, weighting };
    await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: KEY, state });
    await page.reload();
    await expect(page.getByLabel('Intercept', { exact: true })).toHaveValue(expected);
    expect((await saved(page)).forcing).toBe(expected);
    expect((await saved(page)).standards).toEqual(fixture.standards);
  }
});
