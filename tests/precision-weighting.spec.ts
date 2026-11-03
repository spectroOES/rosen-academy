import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const KEY = 'rosen-calibration-v1';
type Session = { weighting: string; standards: { name: string; concentration: number; readings: number[] }[] };
const session = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), KEY) as Promise<Session>;
const readings = async (page: Page) => (await session(page)).standards.map(row => row.readings);
const fields = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map(match => match[1].replaceAll('""', '"'));

async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load demo', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Demo acquired');
  expect((await readings(page)).filter(values => values.length > 0)).toHaveLength(6);
}

test('precision weighting refits retained data, exports literal coefficients, and survives reload', async ({ page }) => {
  await demo(page);
  const raw = await readings(page);
  for (const mode of ['1/SD', '1/RSD']) {
    await page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: mode, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.equation')).not.toContainText('measure at least');
    expect(await readings(page)).toEqual(raw);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const csv = await readFile((await (await downloading).path())!, 'utf8');
    expect(csv).toContain('"Regression weight"');
    const exported = csv.split('\r\n').filter(line => line.startsWith('"Cu",')).map(fields);
    expect(exported).toHaveLength(25);
    for (const row of (await session(page)).standards) {
      const avg = row.readings.reduce((sum, value) => sum + value, 0) / row.readings.length;
      const sd = Math.sqrt(row.readings.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (row.readings.length - 1));
      const expectedWeight = mode === '1/SD' ? 1 / sd : Math.abs(avg) / (100 * sd);
      const actual = Number(exported.find(values => values[5] === row.name)!.at(-1));
      expect(actual / expectedWeight).toBeCloseTo(1, 12);
    }
  }
  await expect(page.locator('.standards-table tbody tr').first().locator('td').nth(4)).toContainText('†');
  await expect(page.getByText(/Blank RSD and its weight are unstable near zero/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('group', { name: 'Regression weighting' }).getByRole('button', { name: '1/RSD', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await readings(page)).toEqual(raw);
});

test('invalid replicate precision is explained without dropping a standard or falling back', async ({ page }) => {
  await demo(page);
  const original = await session(page);
  const cases = [
    { mode: '1/SD', values: [4], message: 'at least 2 replicate readings' },
    { mode: '1/SD', values: [4, 4, 4], message: 'positive replicate SD' },
    { mode: '1/RSD', values: [-1, 0, 1], message: 'nonzero mean net intensity' },
  ];
  for (const sample of cases) {
    const fixture = structuredClone(original);
    fixture.weighting = sample.mode;
    fixture.standards[0].readings = sample.values;
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: KEY, value: fixture });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText(sample.message);
    await expect(page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true })).toBeChecked();
    await expect(page.locator('.fit-status')).toHaveText('Weighting needs data');
    expect((await session(page)).standards[0].readings).toEqual(sample.values);
  }
  await page.getByRole('checkbox', { name: 'Include Calibration blank', exact: true }).uncheck();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.equation')).not.toContainText('measure at least');
});

test('larger typography and all five weighting controls fit a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page);
  const group = page.getByRole('group', { name: 'Regression weighting' });
  await expect(group.getByRole('button')).toHaveCount(5);
  for (const label of ['None', '1/x', '1/x²', '1/SD', '1/RSD']) {
    const button = group.getByRole('button', { name: label, exact: true });
    await button.click();
    const rect = await button.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  }
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: document.documentElement.scrollWidth,
    table: parseFloat(getComputedStyle(document.querySelector('.standards-table')!).fontSize),
    field: parseFloat(getComputedStyle(document.querySelector('.field-label')!).fontSize),
    chart: parseFloat(getComputedStyle(document.querySelector('.chart-svg text')!).fontSize),
  }));
  expect(sizes.width).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.table).toBeGreaterThanOrEqual(14);
  expect(sizes.field).toBeGreaterThanOrEqual(14);
  expect(sizes.chart).toBeGreaterThanOrEqual(14);
  const values = await page.locator('.fit-metrics strong').evaluateAll(elements => elements.map(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    return { lines: range.getClientRects().length, width: el.clientWidth, scroll: el.scrollWidth };
  }));
  for (const value of values) { expect(value.lines).toBe(1); expect(value.scroll).toBeLessThanOrEqual(value.width); }
});
