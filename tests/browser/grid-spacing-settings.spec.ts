import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('legacy 25 cm grid default becomes 10 cm and an explicit spacing persists', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('o3d_locale', 'en');
    if (!sessionStorage.getItem('grid-spacing-seeded')) {
      localStorage.setItem('o3d_settings', JSON.stringify({ gridSize: 25, snapToGrid: true }));
      sessionStorage.setItem('grid-spacing-seeded', '1');
    }
  });
  await page.goto('/editor');

  async function spacingControl() {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('button', { name: 'Dimensions', exact: true }).click();
    return { dialog, input: dialog.getByRole('spinbutton', { name: /Grid spacing/ }) };
  }

  let { dialog, input } = await spacingControl();
  await expect(input).toHaveValue('10');
  await expect(dialog.getByRole('checkbox', { name: 'Snap to grid' })).toBeChecked();
  await input.fill('25');
  await input.press('Tab');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('o3d_settings')!).gridSize)).toBe(25);

  await page.reload();
  ({ dialog, input } = await spacingControl());
  await expect(input).toHaveValue('25');
  await input.fill('10');
  await input.press('Tab');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('o3d_settings')!).gridSize)).toBe(10);

  await dialog.getByRole('button', { name: 'Close settings' }).click();
  await page.getByRole('button', { name: /^Draw Wall/ }).click();
  const canvas = page.getByLabel('Floor plan editor canvas', { exact: true });
  const box = (await canvas.boundingBox())!;
  const zoom = Number((await page.locator('body').innerText()).match(/Zoom:\s*(\d+)%/)?.[1]) / 100;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.click(x + 13 * zoom, y + 17 * zoom);
  await page.mouse.click(x + 123 * zoom, y + 17 * zoom);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const exported = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  expect(exported.floors[0].walls[0].start).toEqual({ x: 10, y: 20 });
  expect(exported.floors[0].walls[0].end).toEqual({ x: 120, y: 20 });
});
