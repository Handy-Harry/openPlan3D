import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const mode of ['mouse', 'keyboard', 'invalid'] as const) test(`Draw Room: ${mode} placement, cancel, undo and reload`, async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('o3d_locale', 'en'));
  await page.goto('/editor');
  const drawRoom = page.getByRole('button', { name: /^Draw Room/ });
  await drawRoom.click();
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const box = (await canvas.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  async function exported() {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
    return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  }
  // Cancellation must leave no walls behind.
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(start.x - 200, start.y - 150);
  const widthLabel = page.getByLabel('Width (cm)', { exact: true });
  const lengthLabel = page.getByLabel('Length (cm)', { exact: true });
  await expect(widthLabel).toBeVisible();
  await expect(widthLabel).toHaveText('2.00 m');
  await expect(lengthLabel).toHaveText('1.50 m');
  await expect(widthLabel).toHaveAttribute('data-active', 'true');
  await expect(page.getByRole('textbox', { name: 'Width (cm)', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect((await exported()).floors[0].walls).toHaveLength(0);
  await drawRoom.click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.move(start.x - 200, start.y - 150);
  if (mode === 'mouse') await page.mouse.click(start.x - 200, start.y - 150);
  else if (mode === 'keyboard') {
    await page.keyboard.type('525');
    await expect(widthLabel).toHaveText('5.25 m ⏎');
    await page.keyboard.press('Tab');
    await expect(canvas).toBeVisible();
    await expect(canvas).toBeFocused();
    await expect(lengthLabel).toHaveAttribute('data-active', 'true');
    await page.keyboard.type('650');
    await expect(lengthLabel).toHaveText('6.50 m ⏎');
    await page.screenshot({ path: testInfo.outputPath('room-dimension-labels.png') });
    await page.keyboard.press('Tab');
    await expect(widthLabel).toHaveAttribute('data-active', 'true');
    await page.keyboard.type('525');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  } else {
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Backspace');
    await page.keyboard.type('525');
    await page.keyboard.press('Tab');
    await page.keyboard.type('650');
    await page.keyboard.press('Enter');
  }
  await expect(widthLabel).toHaveCount(0);
  const placed = await exported();
  const walls = placed.floors[0].walls;
  expect(walls).toHaveLength(4);
  const points = walls.flatMap((wall: any) => [wall.start, wall.end]);
  const span = (axis: 'x' | 'y') => Math.max(...points.map((p: any) => p[axis])) - Math.min(...points.map((p: any) => p[axis]));
  const thickness = walls[0].thickness;
  expect(walls.every((wall: any) => wall.thickness === thickness)).toBe(true);
  // The free space between the actual wall faces must match the entered dimensions.
  expect(span('x') - thickness).toBe(mode === 'mouse' ? 200 : 525);
  expect(span('y') - thickness).toBe(mode === 'mouse' ? 150 : 650);
  // The first clicked corner is the interior bottom-right corner, not a wall centerline.
  expect(Math.max(...points.map((p: any) => p.x)) - thickness / 2).toBe(0);
  expect(Math.max(...points.map((p: any) => p.y)) - thickness / 2).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await exported()).floors[0].walls).toHaveLength(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await exported()).floors[0].walls).toEqual(walls);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved ✓', { exact: true })).toBeVisible();
  await page.goto(`/editor?id=${placed.id}`);
  expect((await exported()).floors[0].walls).toEqual(walls);
  // Outside an active room draft, Tab still switches to 3D.
  await canvas.focus();
  await page.keyboard.press('Tab');
  await expect(canvas).not.toBeVisible();
});
