import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { benchmarkProject } from '../fixtures/render-benchmark';

test('PDF fits tall plans on one page with room and window dimensions', async ({ page }, testInfo) => {
  const project = benchmarkProject('small');
  const floor = project.floors[0];
  for (const wall of floor.walls) { wall.start.y *= 2; wall.end.y *= 2; }
  floor.furniture = [];
  const tinyCorners = [{ x: 1050, y: 0 }, { x: 1185, y: 0 }, { x: 1185, y: 80 }, { x: 1050, y: 80 }];
  const tinyWalls = tinyCorners.map((start, index) => ({
    id: `tiny-wall-${index}`, start, end: tinyCorners[(index + 1) % tinyCorners.length],
    thickness: 15, height: 280, color: '#dddddd',
  }));
  floor.walls.push(...tinyWalls);
  floor.rooms.push({ id: 'tiny-room', name: 'WC', walls: tinyWalls.map(wall => wall.id),
    area: 1.08, floorTexture: 'none', color: '#ddd8d0' });
  project.name = 'Room dimension PDF sample';

  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).click();
  await (await chooser).setFiles({ name: 'rooms.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export as PDF', exact: true }).click();
  const pdf = await readFile((await (await pending).path())!);
  expect(pdf.length).toBeGreaterThan(10_000);
  const content = pdf.toString('latin1');
  expect((content.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  expect(content).not.toContain('(Room Schedule)');
  expect(content).toContain('(Expertisebureau Peeters & Partners)');
  expect(content).toContain('(Stalkerweg 26)');
  expect(content).toContain('(3690 Zutendaal)');
  const output = testInfo.outputPath('room-dimensions.pdf');
  await writeFile(output, pdf);
  await testInfo.attach('room-dimensions.pdf', { path: output, contentType: 'application/pdf' });
});
