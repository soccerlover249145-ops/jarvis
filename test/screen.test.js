'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shotSize, toScreen, toShot, zoomCrop, makeScreen } = require('../src/main/screen');

test('pictures fit the image limits and keep the aspect', () => {
  assert.deepEqual(shotSize(1440, 900), { width: 1440, height: 900, scale: 1 });
  const big = shotSize(1728, 1117); assert.equal(big.width, 1568); assert.equal(big.height, 1014);
  const wide = shotSize(3440, 1440); assert.ok(wide.width <= 1568 && wide.height <= 1568);
  assert.ok(Math.ceil(wide.width / 28) * Math.ceil(wide.height / 28) <= 4784);
});
test('clicks map from picture pixels to screen points and back', () => {
  const geo = { bounds: { x: 0, y: 0, width: 1728, height: 1117 }, shot: { width: 1568, height: 1014 } };
  const p = toScreen([784, 507], geo);
  assert.ok(Math.abs(p.x - 864) < 1 && Math.abs(p.y - 558.5) < 1.2);
  assert.deepEqual(toShot(p, geo), { x: 784, y: 507 });
  const g2 = { bounds: { x: -1440, y: 0, width: 1440, height: 900 }, shot: { width: 1440, height: 900 } };
  assert.deepEqual(toScreen([10, 20], g2), { x: -1430, y: 20 });
  assert.throws(() => toScreen([2000, 10], geo), /outside/);
  assert.throws(() => toScreen(['a', 1], geo), /numbers/);
  assert.throws(() => toScreen([-1, 5], geo), /outside/);
});
test('zoom regions map to the full-resolution capture', () => {
  const geo = { shot: { width: 1440, height: 900 } };
  assert.deepEqual(zoomCrop([100, 100, 400, 300], geo, 2880, 1800), { x: 200, y: 200, width: 600, height: 400 });
  assert.deepEqual(zoomCrop([400, 300, 100, 100], geo, 2880, 1800), { x: 200, y: 200, width: 600, height: 400 });
  assert.throws(() => zoomCrop([1, 1, 2, 2], geo, 2880, 1800), /too small/);
});
test('capture asks macOS for a picture of the display at picture size', async () => {
  let asked;
  const img = { isEmpty: () => false, getSize: () => ({ width: 1440, height: 900 }), resize: () => img, toJPEG: () => Buffer.from('jpg') };
  const s = makeScreen({
    desktopCapturer: { getSources: async (o) => { asked = o; return [{ display_id: '7', thumbnail: img }]; } },
    screen: { getPrimaryDisplay: () => ({ id: 7, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }) },
    systemPreferences: { getMediaAccessStatus: () => 'granted' }
  });
  const c = await s.capture();
  assert.deepEqual(asked, { types: ['screen'], thumbnailSize: { width: 1440, height: 900 } });
  assert.equal(c.media_type, 'image/jpeg'); assert.equal(c.data, Buffer.from('jpg').toString('base64'));
  assert.deepEqual(c.geo.shot, { width: 1440, height: 900 });
});
