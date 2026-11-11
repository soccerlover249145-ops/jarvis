'use strict';
/* screen.js: a picture of the screen, only when asked.

   Claude's coordinates are in the pixel space of the picture it was sent, so the picture's size and
   the screen's size are kept together here, and every click is mapped back to real screen points.
   The picture is the display's size in points (half a Retina screen's pixels), shrunk further if
   its long side is over MAX_EDGE: that keeps each picture under the model's image limits, including
   the stricter per-side limit once a conversation holds more than 20 pictures. */

const MAX_EDGE = 1568;      /* long side of every picture sent to Claude, at most */

/** the picture size for a display of w x h points */
function shotSize(w, h, maxEdge) {
  maxEdge = maxEdge || MAX_EDGE;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), scale: s };
}

/** a point in the picture -> global screen points (what macOS input events use) */
function toScreen(pt, geo) {
  const x = Number(pt && pt[0]), y = Number(pt && pt[1]);
  if (!isFinite(x) || !isFinite(y)) throw new Error('coordinate must be [x, y] numbers');
  if (x < 0 || y < 0 || x > geo.shot.width || y > geo.shot.height) throw new Error('coordinate [' + x + ', ' + y + '] is outside the ' + geo.shot.width + 'x' + geo.shot.height + ' screenshot');
  return {
    x: geo.bounds.x + Math.min(geo.bounds.width - 1, x * geo.bounds.width / geo.shot.width),
    y: geo.bounds.y + Math.min(geo.bounds.height - 1, y * geo.bounds.height / geo.shot.height)
  };
}
/** global screen points -> a point in the picture (for cursor_position) */
function toShot(p, geo) {
  return {
    x: Math.round((p.x - geo.bounds.x) * geo.shot.width / geo.bounds.width),
    y: Math.round((p.y - geo.bounds.y) * geo.shot.height / geo.bounds.height)
  };
}
/** a zoom region in picture space -> the matching crop in the full-resolution capture */
function zoomCrop(region, geo, capW, capH) {
  if (!Array.isArray(region) || region.length !== 4) throw new Error('region must be [x0, y0, x1, y1]');
  let [x0, y0, x1, y1] = region.map(Number);
  if (![x0, y0, x1, y1].every(isFinite)) throw new Error('region must be numbers');
  if (x1 < x0) [x0, x1] = [x1, x0];
  if (y1 < y0) [y0, y1] = [y1, y0];
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(geo.shot.width, x1); y1 = Math.min(geo.shot.height, y1);
  if (x1 - x0 < 4 || y1 - y0 < 4) throw new Error('region is too small');
  const sx = capW / geo.shot.width, sy = capH / geo.shot.height;
  return { x: Math.round(x0 * sx), y: Math.round(y0 * sy), width: Math.max(1, Math.round((x1 - x0) * sx)), height: Math.max(1, Math.round((y1 - y0) * sy)) };
}

/**
 * Make the capturer. electron: { desktopCapturer, screen, systemPreferences }.
 * capture() resolves { data (base64 jpeg), media_type, geo } for the chosen display.
 */
function makeScreen(electron) {
  const { desktopCapturer, screen, systemPreferences } = electron;
  function display() { return screen.getPrimaryDisplay(); }
  function geometry(d) {
    d = d || display();
    const shot = shotSize(d.bounds.width, d.bounds.height);
    return { displayId: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor || 1, shot: { width: shot.width, height: shot.height } };
  }
  function permission() {
    try { return systemPreferences.getMediaAccessStatus('screen'); } catch (e) { return 'unknown'; }
  }
  async function grab(d, w, h) {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
    const src = sources.find(function (s) { return String(s.display_id) === String(d.id); }) || sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('macOS returned no picture. Allow Screen Recording for Jarvis in System Settings, Privacy and Security.');
    return src.thumbnail;
  }
  return {
    geometry, permission,
    /** the picture Claude sees: display size in points, shrunk to MAX_EDGE */
    async capture() {
      const d = display(), geo = geometry(d);
      let img = await grab(d, geo.shot.width, geo.shot.height);
      const sz = img.getSize();
      if (sz.width !== geo.shot.width || sz.height !== geo.shot.height) img = img.resize({ width: geo.shot.width, height: geo.shot.height, quality: 'best' });
      return { data: img.toJPEG(82).toString('base64'), media_type: 'image/jpeg', geo };
    },
    /** zoom: a region of the picture, captured at full resolution, scaled to fit the usual size */
    async zoom(region, geo) {
      const d = display();
      const capW = Math.round(d.bounds.width * (d.scaleFactor || 1)), capH = Math.round(d.bounds.height * (d.scaleFactor || 1));
      const full = await grab(d, capW, capH);
      const fs = full.getSize();
      const crop = zoomCrop(region, geo, fs.width, fs.height);
      let img = full.crop(crop);
      const fit = shotSize(crop.width, crop.height, Math.max(geo.shot.width, geo.shot.height));
      if (fit.width !== crop.width) img = img.resize({ width: fit.width, height: fit.height, quality: 'best' });
      return { data: img.toJPEG(85).toString('base64'), media_type: 'image/jpeg' };
    }
  };
}

module.exports = { makeScreen, shotSize, toScreen, toShot, zoomCrop, MAX_EDGE };
