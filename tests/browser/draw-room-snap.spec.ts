import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('Draw Room snaps off-grid corner and reuses the shared wall in one undo', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('o3d_locale', 'en');
    localStorage.setItem('o3d_settings', JSON.stringify({ showDimensions: false }));
  });
  await page.goto('/editor');
  await page.getByRole('button', { name: /^Draw Room/ }).click();
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.move(x + 100, y + 100);
  await page.keyboard.type('200'); await page.keyboard.press('Tab');
  await page.keyboard.type('150'); await page.keyboard.press('Enter');
  async function exported() {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  }
  const before = await exported();
  expect(before.floors[0].walls).toHaveLength(4);
  // The editor fits the first room automatically, centering it at (100, 75).
  await page.getByRole('button', { name: 'Zoom to 100%', exact: true }).click();
  // Existing corner is (207.5, -7.5), deliberately not a grid point.
  await page.mouse.click(x + 111, y - 79);
  await page.mouse.move(x + 300, y + 100);
  await page.keyboard.type('200'); await page.keyboard.press('Tab');
  await page.keyboard.type('150'); await page.keyboard.press('Enter');
  const placed = await exported();
  const walls = placed.floors[0].walls;
  expect(walls).toHaveLength(7);
  expect(walls.slice(0, 4)).toEqual(before.floors[0].walls);
  const verticals = walls.filter((w: any) => w.start.x === w.end.x);
  expect(verticals.map((w: any) => w.start.x).sort((a: number, b: number) => a - b)).toEqual([-7.5, 207.5, 422.5]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await exported()).floors[0].walls).toEqual(before.floors[0].walls);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await exported()).floors[0].walls).toEqual(walls);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved ✓', { exact: true })).toBeVisible();
  await page.goto(`/editor?id=${placed.id}`);
  expect((await exported()).floors[0].walls).toEqual(walls);
});

test('Draw Room snaps the opposite corner to an existing off-grid corner', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('o3d_locale', 'en');
    localStorage.setItem('o3d_settings', JSON.stringify({ showDimensions: false }));
  });
  await page.goto('/editor');
  await page.getByRole('button', { name: /^Draw Room/ }).click();
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.move(x + 100, y + 100);
  await page.keyboard.type('200'); await page.keyboard.press('Tab');
  await page.keyboard.type('150'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Zoom to 100%', exact: true }).click();
  async function walls() {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    return JSON.parse(await readFile((await (await pending).path())!, 'utf8')).floors[0].walls;
  }
  const before = await walls();
  // After the initial fit the camera is centered at (100, 75).
  await page.mouse.click(x + 300, y + 225); // world (400, 300), on the grid
  await page.mouse.move(x + 111, y + 86); // near existing wall corner (207.5, 157.5)
  await page.mouse.click(x + 111, y + 86);
  const placed = await walls();
  expect(placed).toHaveLength(8);
  expect(placed.slice(0, 4)).toEqual(before);
  const newWalls = placed.slice(4);
  expect(newWalls.some((w: any) =>
    [w.start, w.end].some((p: any) => p.x === 207.5 && p.y === 157.5))).toBe(true);
  const xs = newWalls.flatMap((w: any) => [w.start.x, w.end.x]);
  const ys = newWalls.flatMap((w: any) => [w.start.y, w.end.y]);
  expect(Math.max(...xs) - Math.min(...xs) - 15).toBe(185);
  expect(Math.max(...ys) - Math.min(...ys) - 15).toBe(135);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await walls()).toEqual(before);
});

test('Draw Room aligns its top-right corner while drawing toward bottom-right', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('o3d_locale', 'en');
    localStorage.setItem('o3d_settings', JSON.stringify({ showDimensions: false }));
  });
  await page.goto('/editor');
  await page.getByRole('button', { name: /^Draw Room/ }).click();
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  await page.mouse.move(x + 100, y + 100);
  await page.keyboard.type('200'); await page.keyboard.press('Tab');
  await page.keyboard.type('150'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Zoom to 100%', exact: true }).click();
  async function walls() {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    return JSON.parse(await readFile((await (await pending).path())!, 'utf8')).floors[0].walls;
  }
  const before = await walls();
  // Start at the first room's bottom-left corner. The pointer is far below its
  // bottom-right corner, while the new room's top-right corner is near it.
  await page.mouse.click(x - 104, y + 86);
  await page.mouse.move(x + 103, y + 225);
  await page.screenshot({ path: testInfo.outputPath('aligned-top-right-corner.png') });
  await page.mouse.click(x + 103, y + 225);
  const placed = await walls();
  expect(placed).toHaveLength(7);
  expect(placed.slice(0, 4)).toEqual(before);
  const added = placed.slice(4);
  const xs = added.flatMap((w: any) => [w.start.x, w.end.x]);
  expect(Math.max(...xs)).toBe(207.5);
  expect(Math.min(...xs)).toBe(-7.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await walls()).toEqual(before);
});
