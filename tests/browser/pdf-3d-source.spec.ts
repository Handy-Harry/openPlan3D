import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { benchmarkProject } from '../fixtures/render-benchmark';

test('PDF stays one page when the 3D view is open', async ({ page }) => {
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  const project = benchmarkProject('small');
  project.floors[0].furniture = [];
  await (await chooser).setFiles({ name: 'pdf-source.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: '3D', exact: true }).click();
  const main = page.locator('canvas[data-plan3d-canvas="true"]');
  await expect(main).toBeVisible({ timeout: 60_000 });
  await main.evaluate(canvas => { (canvas as HTMLCanvasElement).toDataURL = () => { throw new Error('3D view must not be captured'); }; });

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  const content = (await readFile((await (await pending).path())!)).toString('latin1');
  expect((content.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  expect(content).not.toContain('(3D Perspective View)');
  expect(content).not.toContain('(Room Schedule)');
});
