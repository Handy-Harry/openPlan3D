import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('a wall dimension can be placed and moved perpendicular to the wall', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('o3d_locale', 'en'));
  const plan = JSON.parse(await readFile('tests/fixtures/connected-dimensions.openplan.json', 'utf8'));
  const floor = plan.floors[0];
  floor.walls = [{ ...floor.walls[0], start: { x: -100, y: 0 }, end: { x: 100, y: 0 } }];
  for (const key of ['doors', 'windows', 'furniture', 'stairs', 'columns', 'entourage', 'rooms', 'guides', 'measurements', 'annotations']) floor[key] = [];

  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await chooser).setFiles({ name: 'dimension-wall.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await expect(page.getByRole('button', { name: plan.name, exact: true })).toBeVisible();

  async function annotations() {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    return JSON.parse(await readFile((await (await pending).path())!, 'utf8')).floors[0].annotations;
  }

  await page.getByRole('button', { name: /^Dimension Add dimension annotations/ }).click();
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await expect(page.getByText('Move the dimension and click to place it')).toBeVisible();
  await page.mouse.move(x, y + 60);
  await page.mouse.click(x, y + 60);
  const placed = await annotations();
  expect(placed).toHaveLength(1);
  expect([placed[0].x1, placed[0].y1, placed[0].x2, placed[0].y2]).toEqual([-100, 0, 100, 0]);
  expect(placed[0].offset).toBeGreaterThan(0);

  await page.getByRole('button', { name: /^Select V/ }).click();
  await page.mouse.move(x, y + 60);
  await page.mouse.down();
  await page.mouse.move(x, y + 90, { steps: 5 });
  await page.mouse.up();
  const moved = await annotations();
  expect(moved[0].offset).toBeGreaterThan(placed[0].offset);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await annotations())[0].offset).toBeCloseTo(placed[0].offset);
});
