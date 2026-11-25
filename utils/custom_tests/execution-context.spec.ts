/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { expect, contextTest as it } from '../../config/browserTest';

it('should expose page APIs in the main execution context @patchwright', async ({ page, server }) => {
  server.setRoute('/patchwright-context.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><button id="target">target</button><iframe src="/patchwright-context-frame.html"></iframe><script>window.mainMarker = "main"</script>');
  });
  server.setRoute('/patchwright-context-frame.html', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><script>window.frameMarker = "frame-main"</script>');
  });

  await page.goto(server.PREFIX + '/patchwright-context.html');
  // Patchwright runs page JavaScript in the main world so that no isolated-world
  // marker is observable to page scripts.
  expect(await page.evaluate(() => window['mainMarker'])).toBe('main');
  expect(await page.evaluate(() => window['mainMarker'], undefined, undefined, false)).toBe('main');

  await page.evaluate(() => window['isolatedMarker'] = 'isolated');
  expect(await page.evaluate(() => window['isolatedMarker'], undefined, undefined, false)).toBe('isolated');

  const frame = page.frames()[1];
  expect(await frame.evaluate(() => window['frameMarker'])).toBe('frame-main');
  expect(await frame.evaluate(() => window['frameMarker'], undefined, undefined, false)).toBe('frame-main');

  const target = page.locator('#target');
  expect(await target.evaluate(() => window['mainMarker'])).toBe('main');
  expect(await target.evaluate(() => window['mainMarker'], undefined, undefined, false)).toBe('main');
  expect(await page.locator('button').evaluateAll(() => window['mainMarker'], undefined, false)).toBe('main');

  await page.reload();
  expect(await page.evaluate(() => window['mainMarker'], undefined, undefined, false)).toBe('main');
  expect(await page.evaluate(() => window['mainMarker'])).toBe('main');
});

it('should preserve main-world handles and accept context selection for workers @patchwright', async ({ page, server }) => {
  await page.goto(server.PREFIX + '/drag-n-drop.html');
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer(), undefined, undefined, false);
  await page.locator('#source').dispatchEvent('dragstart', { dataTransfer });
  await page.locator('#target').dispatchEvent('drop', { dataTransfer });
  await expect(page.locator('#target > #source')).toHaveCount(1);

  const workerPromise = page.waitForEvent('worker');
  await page.evaluate(() => {
    new Worker(URL.createObjectURL(new Blob(['self.answer = 42'], { type: 'text/javascript' })));
  }, undefined, undefined, false);
  const worker = await workerPromise;
  expect(await worker.evaluate(() => self['answer'])).toBe(42);
  expect(await worker.evaluate(() => self['answer'], undefined, false)).toBe(42);
});
