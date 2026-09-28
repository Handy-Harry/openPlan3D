import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('a wall dimension can be placed and moved perpendicular to the wall', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('o3d_locale', 'en'));
  const plan = JSON.parse(await readFile('tests/fixtures/connected-dimensions.openplan.json', 'utf8'));
  const floor = plan.floors[0];
  floor.walls = [
    { ...floor.walls[0], start: { x: -100, y: 0 }, end: { x: 100, y: 0 } },
    { ...floor.walls[0], id: 'left', start: { x: -100, y: -100 }, end: { x: -100, y: 100 } },
    { ...floor.walls[0], id: 'right', start: { x: 100, y: -100 }, end: { x: 100, y: 100 } }
  ];
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
  expect([placed[0].x1, placed[0].y1, placed[0].x2, placed[0].y2]).toEqual([-90, 10, 90, 10]);
  expect(Math.hypot(placed[0].x2 - placed[0].x1, placed[0].y2 - placed[0].y1)).toBe(180);
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

  await page.getByRole('button', { name: /^Dimension Add dimension annotations/ }).click();
  await page.mouse.click(x - 40, y + 130);
  await expect(page.getByText('Click the second point')).toBeVisible();
  await page.mouse.click(x + 40, y + 130);
  await expect(page.getByText('Move the dimension and click to place it')).toBeVisible();
  expect(await annotations()).toHaveLength(1);
  await page.mouse.move(x + 40, y + 180);
  await page.mouse.click(x + 40, y + 180);
  const freeDimensions = await annotations();
  expect(freeDimensions).toHaveLength(2);
  expect(freeDimensions[1].x2).toBeGreaterThan(freeDimensions[1].x1);
  expect(freeDimensions[1].offset).toBeGreaterThan(0);

  // Near a wall endpoint, the first click chooses that point rather than the whole wall.
  const zoomText = await page.locator('body').innerText();
  const zoom = Number(zoomText.match(/Zoom:\s*(\d+)%/)?.[1]) / 100;
  expect(zoom).toBeGreaterThan(0);
  await page.mouse.click(x - 100 * zoom + 4, y + 3);
  await expect(page.getByText('Click the second point')).toBeVisible();
  await page.mouse.click(x + 100 * zoom - 4, y + 3);
  await expect(page.getByText('Move the dimension and click to place it')).toBeVisible();
  await page.mouse.click(x, y - 60);
  const snappedDimensions = await annotations();
  expect(snappedDimensions).toHaveLength(3);
  expect([snappedDimensions[2].x1, snappedDimensions[2].y1, snappedDimensions[2].x2, snappedDimensions[2].y2])
    .toEqual([-100, 0, 100, 0]);
});
