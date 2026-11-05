import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const methodData = JSON.parse(readFileSync(new URL('../src/data/calibration-profiles.json', import.meta.url), 'utf8')) as { source: { sha256: string }; profiles: { id: string; element: string; wavelength: number; view: string; mode: string; points: { concentration: number; mean: number; sd: number }[] }[] };

const KEY = 'rosen-calibration-v2-measured';
type Session = {
  sourceHash: string;
  lineId: string;
  mode: string;
  integration: number;
  standards: { concentration: number; readings: number[] }[];
};
const session = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY) as Promise<Session>;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Calibration workspace.' })).toBeVisible();
});

test('uses all measured channels with their native viewing geometry and acquisition mode', async ({ page }) => {
  const analyte = page.getByLabel('Analyte', { exact: true });
  const elements = await analyte.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  expect(elements.slice().sort()).toEqual(['Ca', 'Cd', 'Cu', 'Fe', 'Mg', 'P', 'Pb', 'Sb', 'Ti', 'Zn'].sort());
  expect(methodData.profiles).toHaveLength(25);
  let channelCount = 0;
  for (const element of elements) {
    await analyte.selectOption(element);
    const channels = methodData.profiles.filter(profile => profile.element === element);
    const group = page.getByRole('group', { name: 'Analytical line', exact: true });
    await expect(group.getByRole('button')).toHaveCount(channels.length);
    channelCount += channels.length;
    for (const channel of channels) {
      const label = `${element} ${channel.wavelength.toFixed(3)} ${channel.view} ${channel.mode}`;
      await expect(group.getByRole('button', { name: label, exact: true })).toContainText(`${channel.view} · ${channel.mode}`);
    }
  }
  expect(channelCount).toBe(25);
  await analyte.selectOption('Mg');
  const magnesium = page.getByRole('group', { name: 'Analytical line', exact: true });
  expect(await magnesium.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual([
    'Mg 279.079 Radial iFR',
    'Mg 279.553 Radial iFR',
    'Mg 280.270 Axial iFR',
    'Mg 280.270 Radial iFR',
    'Mg 285.213 Axial iFR',
    'Mg 285.213 Radial iFR',
  ]);
});

test('keeps the 5-second source exposure and generates new readings around recorded references', async ({ page }) => {
  await expect(page.getByLabel('Response model', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Integration', { exact: true })).toHaveCount(0);
  const exposure = page.getByLabel('Reference exposure', { exact: true });
  await expect(exposure).toHaveValue('5 s');
  await expect(exposure).toHaveAttribute('readonly', '');
  await expect(page.getByText('Reference means and SDs are measured; new replicates are simulated. Exposure is fixed to your source method. Playback is accelerated.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const state = await session(page);
  expect(state).toMatchObject({ sourceHash: methodData.source.sha256, lineId: 'cu-324754-axial-ifr', mode: 'measured', integration: 5 });
  const source = methodData.profiles.find(profile => profile.id === state.lineId)!;
  expect(state.standards.map(row => row.concentration)).toEqual(source.points.map(point => point.concentration));
  for (const row of state.standards) {
    const reference = source.points.find(point => point.concentration === row.concentration)!;
    const average = row.readings.reduce((sum, value) => sum + value, 0) / row.readings.length;
    expect(Math.abs(average - reference.mean)).toBeLessThan(6 * reference.sd);
    expect(row.readings).not.toEqual(Array(row.readings.length).fill(reference.mean));
  }
  await page.getByRole('button', { name: 'Lab guide', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('new replicate readings are simulated, not the original instrument replicates');
});

test('separates measured levels, interpolation, and extrapolation from verified response', async ({ page }) => {
  await expect(page.locator('.standards-table .support-label')).toHaveText(Array(4).fill('Reference level'));
  await page.getByRole('button', { name: 'Add standard', exact: true }).click();
  const newRow = page.locator('.standards-table tbody tr').filter({ has: page.getByRole('spinbutton', { name: 'Standard 4 concentration', exact: true }) });
  await expect(newRow.getByText('Interpolated', { exact: true })).toBeVisible();
  const concentration = newRow.getByRole('spinbutton', { name: 'Standard 4 concentration', exact: true });
  await concentration.fill('5');
  await concentration.press('Tab');
  await expect(newRow.getByText('Extrapolated', { exact: true })).toBeVisible();
  await expect(page.locator('.source-warning')).toContainText('measured maximum of 1 ppm');
  await expect(page.locator('.source-warning')).toContainText('not verified responses or saturation limits');
  await page.getByLabel('Analyte', { exact: true }).selectOption('Ti');
  expect((await session(page)).standards.map(row => row.concentration)).toEqual([0, 0.05, 0.1]);
  await expect(page.locator('.standards-table .support-label')).toHaveText(Array(3).fill('Reference level'));
  await expect(page.locator('.source-warning')).toHaveCount(0);
});

test('explains the calibration equation, units, and inverse calculation', async ({ page }) => {
  const formula = page.locator('[aria-label="Calibration equation and variable definitions"]');
  await expect(formula).toContainText('I = b + m × C');
  await expect(formula).toContainText('Mean intensity (cps)');
  await expect(formula).toContainText('Standard concentration (ppm)');
  await expect(formula).toContainText('Slope / sensitivity (cps per ppm)');
  await expect(formula).toContainText('Intercept (cps)');
  await expect(formula).toContainText('C = (I − b) / m');
  await expect(formula).toContainText('weighting cannot remove physical response compression');
});

test('preserves old synthetic sessions separately and rejects stale measured source data', async ({ page }) => {
  const oldKey = 'rosen-calibration-v1';
  const synthetic = { lineId: 'cu-324754', mode: 'saturation', standards: [{ concentration: 100, readings: [123, 124, 125] }] };
  await page.evaluate(({ key, oldKey, synthetic }) => {
    localStorage.removeItem(key);
    localStorage.setItem(oldKey, JSON.stringify(synthetic));
  }, { key: KEY, oldKey, synthetic });
  await page.reload();
  await expect(page.getByText('0/4 measured', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('previous synthetic session remains stored separately');
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), oldKey)).toEqual(synthetic);
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  const stale = await session(page);
  stale.sourceHash = 'stale-reference-file';
  await page.evaluate(({ key, stale }) => localStorage.setItem(key, JSON.stringify(stale)), { key: KEY, stale });
  await page.reload();
  await expect(page.getByText('0/4 measured', { exact: true })).toBeVisible();
  expect((await session(page)).sourceHash).toBe(methodData.source.sha256);
  expect((await session(page)).standards.every(row => row.readings.length === 0)).toBe(true);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), oldKey)).toEqual(synthetic);
});
