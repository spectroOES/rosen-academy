import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const MODEL_VERSION = readFileSync(new URL('../src/lib/teaching-method.ts', import.meta.url), 'utf8').match(/TEACHING_MODEL_VERSION\s*=\s*['"]([^'"]+)['"]/)![1];
const KEY = 'rosen-calibration-v3-teaching';
type Session = {
  sourceHash: string;
  lineId: string;
  mode: string;
  integration: number;
  weighting: string;
  standards: { name: string; concentration: number; included: boolean; readings: number[] }[];
};
const session = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY) as Promise<Session>;
const concentrations = async (page: Page) => (await session(page)).standards.map(row => row.concentration);
const plan = async (page: Page, value: string) => {
  await page.getByLabel('Standard set', { exact: true }).selectOption(value);
  await page.getByRole('button', { name: 'Apply standard set', exact: true }).click();
};

const pairs = {
  Mg: ['Mg 279.553 Radial iFR', 'Mg 279.079 Radial iFR'],
  Na: ['Na 589.592 Radial iFR', 'Na 330.237 Radial iFR'],
  As: ['As 189.042 Axial eUV', 'As 193.759 Axial eUV'],
  Cd: ['Cd 214.438 Axial iFR', 'Cd 226.502 Axial iFR'],
  Pb: ['Pb 220.353 Axial eUV', 'Pb 216.999 Axial eUV'],
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Calibration workspace.' })).toBeVisible();
});

test('offers only five example elements with a higher and lower sensitivity line each', async ({ page }) => {
  const analyte = page.getByLabel('Analyte', { exact: true });
  const elements = await analyte.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(elements.slice().sort()).toEqual(Object.keys(pairs).sort());
  const view = page.getByLabel('Observation view', { exact: true });
  await expect(view).toHaveValue('Radial');
  for (const selectedView of ['Axial', 'Radial']) {
    await view.selectOption(selectedView);
    for (const [element, labels] of Object.entries(pairs)) {
      await analyte.selectOption(element);
      await expect(view).toHaveValue(selectedView);
      const group = page.getByRole('group', { name: 'Analytical line', exact: true });
      await expect(group.getByRole('button')).toHaveCount(2);
      for (const label of labels) await expect(group.getByRole('button', { name: label.replace(/Axial|Radial/, selectedView), exact: true })).toBeVisible();
      await expect(group).toContainText('Higher sensitivity');
      await expect(group).toContainText('Lower sensitivity');
    }
  }
  expect(await page.locator('body').innerText()).not.toMatch(/mixture/i);
  await page.getByRole('button', { name: 'Lab guide', exact: true }).click();
  expect(await page.getByRole('dialog').innerText()).not.toMatch(/mixture|near.linear response|compressed response/i);
});

test('uses a fixed exposure and one automatic teaching response without an outcome selector', async ({ page }) => {
  await expect(page.getByLabel('Response model', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Integration', { exact: true })).toHaveCount(0);
  const exposure = page.getByLabel('Exposure', { exact: true });
  await expect(exposure).toHaveValue('5 s');
  await expect(exposure).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const state = await session(page);
  expect(state).toMatchObject({ sourceHash: MODEL_VERSION, lineId: 'mg-279553-radial-ifr', mode: 'teaching', integration: 5 });
  expect(state.standards.map(row => row.concentration)).toEqual([0, 0.1, 0.5, 1]);
  for (const row of state.standards) expect(new Set(row.readings).size).toBeGreaterThan(1);
  await page.getByLabel('Show model', { exact: true }).check();
  await expect(page.getByText('Teaching response', { exact: true })).toBeVisible();
  await expect(page.getByText('Imported CSV mean', { exact: true })).toHaveCount(0);
});

test('appends high concentration levels, skips duplicates, and rejects invalid batches atomically', async ({ page }) => {
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const original = await session(page);
  const input = page.getByLabel('Add concentrations (ppm)', { exact: true });
  await input.fill('10, 25, 50, 100');
  await page.getByRole('button', { name: 'Add levels', exact: true }).click();
  expect(await concentrations(page)).toEqual([0, 0.1, 0.5, 1, 10, 25, 50, 100]);
  const expanded = await session(page);
  expect(expanded.standards.slice(0, 4).map(row => row.readings)).toEqual(original.standards.map(row => row.readings));
  expect(expanded.standards.slice(4).every(row => row.readings.length === 0)).toBe(true);
  expect(expanded.standards.slice(1).map(row => row.name)).toEqual(Array.from({ length: 7 }, (_, i) => `Standard ${i + 1}`));
  await input.fill('10, 10, 25');
  await page.getByRole('button', { name: 'Add levels', exact: true }).click();
  expect(await concentrations(page)).toEqual([0, 0.1, 0.5, 1, 10, 25, 50, 100]);
  for (const invalid of ['2, 101', '2, bad', '2, 0.001']) {
    await input.fill(invalid);
    await page.getByRole('button', { name: 'Add levels', exact: true }).click();
    expect((await session(page)).standards).toEqual(expanded.standards);
  }
});

test('provides low and wide concentration plans and allows deletion down to the blank', async ({ page }) => {
  await plan(page, 'wide');
  expect(await concentrations(page)).toEqual([0, 0.1, 0.5, 1, 10, 25, 50, 100]);
  await plan(page, 'low');
  expect(await concentrations(page)).toEqual([0, 0.1, 0.5, 1]);
  const removals = page.getByRole('button', { name: /^Remove Standard / });
  while (await removals.count()) await removals.first().click();
  expect(await concentrations(page)).toEqual([0]);
  await expect(page.getByRole('button', { name: 'Remove Calibration blank', exact: true })).toHaveCount(0);
  await expect(page.locator('.equation')).toContainText('measure at least 3');
  await page.reload();
  expect(await concentrations(page)).toEqual([0]);
  await plan(page, 'low');
  expect(await concentrations(page)).toEqual([0, 0.1, 0.5, 1]);
});

test('naturally saturates the sensitive line at high levels while preserving a broader weak-line range', async ({ page }) => {
  await plan(page, 'high');
  expect(await concentrations(page)).toEqual([0, 10, 25, 50, 100]);
  await expect(page.locator('.standards-table').getByText('Saturation', { exact: true })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/near.linear response|compressed response/i);
  const lines = page.getByRole('group', { name: 'Analytical line', exact: true });
  const doublingResponse = async () => {
    const rows = (await session(page)).standards;
    const avg = (c: number) => {
      const readings = rows.find(row => row.concentration === c)!.readings;
      return readings.reduce((a, b) => a + b, 0) / readings.length;
    };
    return (avg(100) - avg(0)) / (2 * (avg(50) - avg(0)));
  };
  await lines.getByRole('button', { name: pairs.Mg[0], exact: true }).click();
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const compressed = await doublingResponse();
  expect(compressed).toBeGreaterThan(0.45);
  expect(compressed).toBeLessThan(0.6);
  await expect(page.locator('.standards-table tbody tr').last().getByText('Saturation', { exact: true })).toBeVisible();
  await lines.getByRole('button', { name: pairs.Mg[1], exact: true }).click();
  expect(await concentrations(page)).toEqual([0, 10, 25, 50, 100]);
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  expect(await doublingResponse()).toBeGreaterThan(0.85);
  await expect(page.locator('.standards-table').getByText('Saturation', { exact: true })).toHaveCount(0);
});

test('explains the calibration equation, units, and inverse calculation', async ({ page }) => {
  const formula = page.locator('[aria-label="Calibration equation and variable definitions"]');
  for (const text of ['I = b + m × C', 'Mean intensity (cps)', 'Standard concentration (ppm)', 'Slope / sensitivity (cps per ppm)', 'Intercept (cps)', 'C = (I − b) / m']) {
    await expect(formula).toContainText(text);
  }
  await expect(formula).toContainText('weighting cannot remove');
});

test('keeps the previous measured session separate and rejects stale teaching parameters', async ({ page }) => {
  const oldKey = 'rosen-calibration-v2-measured';
  const previous = { lineId: 'cu-324754-axial-ifr', mode: 'measured', standards: [{ concentration: 1, readings: [123, 124, 125] }] };
  await page.evaluate(({ key, oldKey, previous }) => {
    localStorage.removeItem(key);
    localStorage.setItem(oldKey, JSON.stringify(previous));
  }, { key: KEY, oldKey, previous });
  await page.reload();
  await expect(page.getByText('0/4 measured', { exact: true })).toBeVisible();
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), oldKey)).toEqual(previous);
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const stale = await session(page);
  stale.sourceHash = 'stale-teaching-parameters';
  await page.evaluate(({ key, stale }) => localStorage.setItem(key, JSON.stringify(stale)), { key: KEY, stale });
  await page.reload();
  await expect(page.getByText('0/4 measured', { exact: true })).toBeVisible();
  expect((await session(page)).sourceHash).toBe(MODEL_VERSION);
  expect((await session(page)).standards.every(row => row.readings.length === 0)).toBe(true);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), oldKey)).toEqual(previous);
});

test('changing observation view retains the chosen line and plan but clears acquired results and saturation', async ({ page }) => {
  await plan(page, 'wide');
  await page.getByRole('checkbox', { name: 'Include Standard 3', exact: true }).uncheck();
  await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/x²', exact: true }).click();
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(page.locator('.standards-table').getByText('Saturation', { exact: true })).toHaveCount(1);
  const radial = await session(page);
  const view = page.getByLabel('Observation view', { exact: true });
  await view.selectOption('Axial');
  const axial = await session(page);
  expect(axial.lineId).toBe('mg-279553-axial-ifr');
  expect(axial.weighting).toBe(radial.weighting);
  expect(axial.standards.map(({ concentration, included }) => ({ concentration, included }))).toEqual(radial.standards.map(({ concentration, included }) => ({ concentration, included })));
  expect(axial.standards.every(row => row.readings.length === 0)).toBe(true);
  await expect(page.locator('.equation')).toContainText('measure at least 3');
  await expect(page.locator('.standards-table').getByText('Saturation', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(view).toHaveValue('Axial');
  await expect(page.getByRole('button', { name: 'Mg 279.553 Axial iFR', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Mg 279.079 Axial iFR', exact: true }).click();
  await expect(view).toHaveValue('Axial');
  await page.getByLabel('Analyte', { exact: true }).selectOption('As');
  await expect(view).toHaveValue('Axial');
  await page.getByRole('button', { name: 'As 193.759 Axial eUV', exact: true }).click();
  await view.selectOption('Radial');
  await expect(page.getByRole('button', { name: 'As 193.759 Radial eUV', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('observation view scales low-level net intensity approximately 5.5 times and is recorded in CSV', async ({ page }) => {
  const netAtPoint = async () => {
    const rows = (await session(page)).standards;
    const average = (c: number) => {
      const readings = rows.find(row => row.concentration === c)!.readings;
      return readings.reduce((sum, value) => sum + value, 0) / readings.length;
    };
    return average(0.1) - average(0);
  };
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const radial = await netAtPoint();
  await page.getByLabel('Observation view', { exact: true }).selectOption('Axial');
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const ratio = await netAtPoint() / radial;
  expect(ratio).toBeGreaterThan(5.2);
  expect(ratio).toBeLessThan(5.7);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await readFile((await (await downloading).path())!, 'utf8');
  expect(csv).toContain('"Plasma view","Axial"');
  expect(csv).toContain('"Saturation comment"');
  expect(csv).not.toMatch(/near.linear response|compressed response/i);
  await page.reload();
  await expect(page.getByLabel('Observation view', { exact: true })).toHaveValue('Axial');
  await expect(page.getByText('4/4 measured', { exact: true })).toBeVisible();
});

test('saturation appears only when a saturated standard acquisition is completed', async ({ page }) => {
  await plan(page, 'high');
  await page.getByLabel('Replicates', { exact: true }).selectOption('10');
  const row = page.locator('.standards-table tbody tr').last();
  const badge = row.getByText('Saturation', { exact: true });
  await expect(badge).toHaveCount(0);
  await page.getByRole('button', { name: 'Measure Standard 4', exact: true }).click();
  await expect(page.getByLabel('Observation view', { exact: true })).toBeDisabled();
  await expect.poll(async () => (await session(page)).standards.at(-1)!.readings.length).toBeGreaterThanOrEqual(3);
  await expect(badge).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop acquisition', exact: true }).click();
  expect((await session(page)).standards.at(-1)!.readings.length).toBeLessThan(10);
  await expect(badge).toHaveCount(0);
  await page.getByRole('button', { name: 'Measure Standard 4', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run calibration', exact: true })).toBeVisible();
  expect((await session(page)).standards.at(-1)!.readings).toHaveLength(10);
  await expect(badge).toBeVisible();
  await page.getByLabel('Replicates', { exact: true }).selectOption('3');
  await expect(badge).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const csv = await readFile((await (await downloading).path())!, 'utf8');
  expect(csv).toContain('"Saturation (modeled)"');
  await page.getByRole('button', { name: 'Clear readings', exact: true }).click();
  await expect(badge).toHaveCount(0);
});
