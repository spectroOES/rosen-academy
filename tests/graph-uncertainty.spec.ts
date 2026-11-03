import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const KEY = 'rosen-calibration-v1';
const fixture = {
  lineId: 'cu-324754', mode: 'linear', weighting: 'none', replicates: 3, integration: 5, sequence: 1,
  standards: [
    { id: 'b', name: 'Calibration blank', concentration: 0, included: true, readings: [-3, -2, -1] },
    { id: 's1', name: 'Standard 1', concentration: 1, included: true, readings: [4, 5, 6] },
    { id: 's2', name: 'Standard 2', concentration: 2, included: true, readings: [7, 8, 9] },
    { id: 's3', name: 'Standard 3', concentration: 4, included: true, readings: [10, 11, 12] },
  ],
};
async function seed(page: Page, state = fixture) {
  await page.goto('/');
  await page.evaluate(({ key, state }) => localStorage.setItem(key, JSON.stringify(state)), { key: KEY, state });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Calibration workspace.' })).toBeVisible();
}

test('gray graphs use black labels and red bars with sample-SD geometry rather than SEM', async ({ page }) => {
  await seed(page);
  const chart = page.getByRole('region', { name: 'Calibration curve', exact: true });
  const svg = chart.locator('.chart-svg');
  await expect(svg).toHaveCSS('background-color', 'rgb(217, 217, 217)');
  const textColors = await svg.locator('text').evaluateAll(elements => elements.map(el => getComputedStyle(el).fill));
  expect(textColors.every(color => color === 'rgb(0, 0, 0)')).toBe(true);
  await expect(chart.locator('.sd-error-bar')).toHaveCount(4);
  await expect(chart.locator('.sd-error-bar').first()).toHaveCSS('stroke', 'rgb(176, 0, 32)');
  const geometry = await chart.locator('.chart-svg').evaluate(el => {
    const cy = (name: string) => Number(el.querySelector(`g.chart-point[aria-label^="Select ${name},"] circle`)!.getAttribute('cy'));
    const meanY = cy('Standard 1');
    const units = Math.abs(cy('Standard 2') - meanY) / 3;
    const bar = el.querySelector('.sd-error-bar[data-standard-id="s1"]')!;
    const stem = bar.querySelector('line')!;
    const y1 = Number(stem.getAttribute('y1')), y2 = Number(stem.getAttribute('y2'));
    return { reported: Number(bar.getAttribute('data-sd')), height: Math.abs(y2 - y1), center: (y1 + y2) / 2, units, meanY };
  });
  expect(geometry.reported).toBe(1);
  expect(geometry.height / geometry.units).toBeCloseTo(2, 10);
  expect(geometry.center).toBeCloseTo(geometry.meanY, 10);
  await expect(chart.getByText(/not SEM or a confidence interval/)).toBeVisible();
  // Negative blank mean−SD must remain inside the plot instead of being clipped.
  const blank = chart.locator('.sd-error-bar[data-standard-id="b"] line').first();
  const maxY = Math.max(Number(await blank.getAttribute('y1')), Number(await blank.getAttribute('y2')));
  const clip = svg.locator('clipPath rect');
  expect(maxY).toBeLessThan(Number(await clip.getAttribute('y')) + Number(await clip.getAttribute('height')));
});

test('excluded readings retain SD bars, zero blanks hide only on log scale, and single readings have no SD', async ({ page }) => {
  await seed(page);
  const chart = page.getByRole('region', { name: 'Calibration curve', exact: true });
  await page.getByRole('checkbox', { name: 'Include Standard 1', exact: true }).uncheck();
  await expect(chart.locator('.sd-error-bar[data-standard-id="s1"]')).toHaveCount(1);
  await chart.getByRole('button', { name: 'Log x', exact: true }).click();
  await expect(chart.locator('.sd-error-bar[data-standard-id="b"]')).toHaveCount(0);
  await expect(chart.locator('.sd-error-bar')).toHaveCount(3);
  const state = structuredClone(fixture);
  state.standards[1].readings = [5];
  await seed(page, state);
  await expect(chart.locator('.sd-error-bar[data-standard-id="s1"]')).toHaveCount(0);
  await expect(chart.getByRole('button', { name: /^Select Standard 1,/ })).toHaveCount(1);
  await expect(chart.locator('.sd-error-bar')).toHaveCount(3);
});

test('concentration-error bars propagate replicate SD through the fitted slope', async ({ page }) => {
  await seed(page);
  const chart = page.getByRole('region', { name: 'Back-calculated concentration errors', exact: true });
  await expect(chart.locator('.residual-sd-error-bar')).toHaveCount(3);
  await expect(chart.locator('.chart-svg')).toHaveCSS('background-color', 'rgb(217, 217, 217)');
  // Independent ordinary least-squares slope for x=[0,1,2,4], y=[−2,5,8,11].
  const xs = [0, 1, 2, 4], ys = [-2, 5, 8, 11];
  const meanX = 7 / 4, meanY = 22 / 4;
  const referenceSlope = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0) / xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  for (const [id, concentration] of [['s1', 1], ['s2', 2], ['s3', 4]] as const) {
    const bar = chart.locator(`.residual-sd-error-bar[data-standard-id="${id}"]`);
    expect(Number(await bar.getAttribute('data-sd'))).toBe(1);
    expect(Number(await bar.getAttribute('data-propagated-sd'))).toBeCloseTo(100 / (referenceSlope * concentration), 12);
  }
  await expect(chart.getByText(/holding the fitted calibration fixed/)).toBeVisible();
});
