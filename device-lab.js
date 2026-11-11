/* device-lab.js: Jarvis talks to Bluetooth and USB devices, in Chrome or Edge (and the Mac app).

   Say "connect my heart rate strap", "pair a Bluetooth device" or "open the device lab". The lab shows:
     - Bluetooth (Web Bluetooth): pairs with one tap through the browser's own chooser. Standard devices are
       read and decoded live: battery, heart rate, temperature/humidity/pressure sensors, thermometers,
       scales, bike power meters, speed and cadence sensors, running pods, and device information. Devices
       that speak the common "UART over Bluetooth" (most DIY ESP32 and Arduino gadgets) stream text lines,
       read like the serial console below. Anything else can be explored: its services and values in hex.
     - USB serial (Web Serial): an Arduino, ESP32, scale, meter or GPS on a cable. A console, a baud picker,
       and numbers in the lines ("weight: 412.3 g", "21.5,48") become live tiles with a sparkline.
     - USB (WebUSB): identifies a plugged-in device (maker, product, ids). Read only.

   It is read-first. Kin never writes to a device by itself: the only writes are lines the founder types
   into a console and sends. Flashing firmware is designed but not built (see INTEGRATION.md).

   Public surface (window.Kin.devices):
     isRequest(text)  -> true for "connect my scale", "bluetooth", "device lab", "serial", ...
     support()        -> { bluetooth, serial, usb, why: { bluetooth, serial, usb } }
     open(opts)       -> the panel. opts: { onSay(line), onClose, test }
     close()
     latest()         -> [{ device, metric, value, unit, at }] the newest reading of everything connected
     summary()        -> one spoken sentence of the latest readings, or ''
     exportCSV()      -> every reading this session as CSV text
     _                -> the pure decoders, for tests.

   Privacy: nothing leaves the device from here. The serial number characteristic is never read. Only
   device names, the baud rate and custom service ids the founder adds are remembered (localStorage). */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var Kin = root.Kin = root.Kin || {};

  /* ------------------------------------------------------------ decoders (pure, tested in node) */
  function u16(v, o) { return v.getUint16(o, true); }
  function s16(v, o) { return v.getInt16(o, true); }
  function u24(v, o) { return v.getUint8(o) | v.getUint8(o + 1) << 8 | v.getUint8(o + 2) << 16; }
  /** IEEE-11073 32-bit FLOAT: 8-bit exponent, 24-bit mantissa */
  function float32(v, o) {
    var raw = v.getUint32(o, true), m = raw & 0xFFFFFF, e = raw >>> 24;
    if (m === 0x7FFFFF || m === 0x800000 || m === 0x7FFFFE || m === 0x800002) return NaN;
    if (m & 0x800000) m -= 0x1000000; if (e & 0x80) e -= 0x100;
    return m * Math.pow(10, e);
  }
  /** IEEE-11073 16-bit SFLOAT: 4-bit exponent, 12-bit mantissa */
  function sfloat(v, o) {
    var raw = u16(v, o), m = raw & 0x0FFF, e = raw >> 12;
    if (m === 0x07FF || m === 0x0800 || m === 0x07FE || m === 0x0802) return NaN;
    if (m & 0x0800) m -= 0x1000; if (e & 0x8) e -= 0x10;
    return m * Math.pow(10, e);
  }
  function round(x, d) { var p = Math.pow(10, d); return Math.round(x * p) / p; }
  var dec = {
    battery: function (v) { return [{ metric: 'Battery', value: v.getUint8(0), unit: '%' }]; },
    heartRate: function (v) {
      var f = v.getUint8(0), o = 1, out = [];
      var bpm = f & 1 ? u16(v, o) : v.getUint8(o); o += f & 1 ? 2 : 1;
      out.push({ metric: 'Heart rate', value: bpm, unit: 'bpm' });
      if ((f & 6) === 4) out.push({ metric: 'Skin contact', value: 0, unit: '', text: 'No contact' });
      if (f & 8) { out.push({ metric: 'Energy', value: u16(v, o), unit: 'kJ' }); o += 2; }
      if (f & 16 && v.byteLength >= o + 2) { var rr = []; for (; o + 1 < v.byteLength; o += 2) rr.push(Math.round(u16(v, o) / 1024 * 1000)); out.push({ metric: 'Beat gap', value: rr[rr.length - 1], unit: 'ms' }); }
      return out;
    },
    temperature: function (v) { return [{ metric: 'Temperature', value: round(s16(v, 0) / 100, 2), unit: '°C' }]; },
    humidity: function (v) { return [{ metric: 'Humidity', value: round(u16(v, 0) / 100, 2), unit: '%' }]; },
    pressure: function (v) { return [{ metric: 'Pressure', value: round(v.getUint32(0, true) / 10 / 100, 1), unit: 'hPa' }]; },
    thermometer: function (v) { var f = v.getUint8(0); return [{ metric: 'Body temperature', value: round(float32(v, 1), 2), unit: f & 1 ? '°F' : '°C' }]; },
    weight: function (v) { var f = v.getUint8(0), raw = u16(v, 1); return raw === 0xFFFF ? [] : [f & 1 ? { metric: 'Weight', value: round(raw * 0.01, 2), unit: 'lb' } : { metric: 'Weight', value: round(raw * 0.005, 3), unit: 'kg' }]; },
    power: function (v) { return [{ metric: 'Power', value: s16(v, 2), unit: 'W' }]; },
    /* speed and cadence come as running totals; the rate needs the previous message (state) */
    csc: function (v, state) {
      var f = v.getUint8(0), o = 1, out = []; state = state || {};
      if (f & 1) {
        var wr = v.getUint32(o, true), wt = u16(v, o + 4); o += 6;
        if (state.wr != null) { var dt = ((wt - state.wt + 65536) % 65536) / 1024, dr = wr - state.wr; if (dt > 0 && dr >= 0) out.push({ metric: 'Wheel', value: round(dr / dt * 60, 1), unit: 'rpm' }); }
        state.wr = wr; state.wt = wt;
      }
      if (f & 2) {
        var cr = u16(v, o), ct = u16(v, o + 2);
        if (state.cr != null) { var dc = ((ct - state.ct + 65536) % 65536) / 1024, n = (cr - state.cr + 65536) % 65536; if (dc > 0) out.push({ metric: 'Cadence', value: Math.round(n / dc * 60), unit: 'rpm' }); }
        state.cr = cr; state.ct = ct;
      }
      return out;
    },
    rsc: function (v) { var out = [{ metric: 'Speed', value: round(u16(v, 1) / 256 * 3.6, 2), unit: 'km/h' }, { metric: 'Cadence', value: v.getUint8(3), unit: 'spm' }]; return out; },
    text: function (v) { return [{ metric: null, text: new TextDecoder().decode(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)).replace(/\0+$/, '').trim() }]; }
  };
  var SVC = [
    { id: 0x180F, name: 'Battery', chars: [{ id: 0x2A19, dec: 'battery', read: true, notify: true }] },
    { id: 0x180D, name: 'Heart rate', chars: [{ id: 0x2A37, dec: 'heartRate', notify: true }] },
    { id: 0x181A, name: 'Environment', chars: [{ id: 0x2A6E, dec: 'temperature', read: true, notify: true }, { id: 0x2A6F, dec: 'humidity', read: true, notify: true }, { id: 0x2A6D, dec: 'pressure', read: true, notify: true }] },
    { id: 0x1809, name: 'Thermometer', chars: [{ id: 0x2A1C, dec: 'thermometer', notify: true }] },
    { id: 0x181D, name: 'Scale', chars: [{ id: 0x2A9D, dec: 'weight', notify: true }] },
    { id: 0x1818, name: 'Bike power', chars: [{ id: 0x2A63, dec: 'power', notify: true }] },
    { id: 0x1816, name: 'Speed and cadence', chars: [{ id: 0x2A5B, dec: 'csc', notify: true }] },
    { id: 0x1814, name: 'Running pod', chars: [{ id: 0x2A53, dec: 'rsc', notify: true }] },
    /* the serial number (0x2A25) is left out on purpose */
    { id: 0x180A, name: 'Device information', info: true, chars: [{ id: 0x2A29, label: 'Maker', dec: 'text', read: true }, { id: 0x2A24, label: 'Model', dec: 'text', read: true }, { id: 0x2A26, label: 'Firmware', dec: 'text', read: true }, { id: 0x2A27, label: 'Hardware', dec: 'text', read: true }] },
    { id: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', name: 'UART', uart: true, chars: [{ id: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', dec: 'lines', notify: true }, { id: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', write: true }] }
  ];
  function uuid(x) { if (typeof x === 'number') return ('0000' + x.toString(16).padStart(4, '0') + '-0000-1000-8000-00805f9b34fb').toLowerCase(); return String(x).toLowerCase(); }
  function short(u) { var m = String(u).match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/i); return m ? '0x' + m[1].toUpperCase() : String(u); }
  function validUuid(u) { u = String(u || '').trim().toLowerCase(); if (/^0x[0-9a-f]{4}$/.test(u)) return uuid(parseInt(u, 16)); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u) ? u : ''; }
  function hex(v) { var a = []; for (var i = 0; i < v.byteLength; i++) a.push(v.getUint8(i).toString(16).padStart(2, '0')); return a.join(' '); }

  /** numbers in a line of text: "weight: 412.3 g", "t=21.5C h=48%", "21.5,48,1013". Returns [{ metric, value, unit }] */
  var UNITS = 'kg|g|lbs?|oz|mm|cm|m|km\\/h|mph|m\\/s|°?[CF]|%|hPa|Pa|psi|bar|V|mV|A|mA|W|kW|Wh|rpm|bpm|ppm|lux|lx|dB|s|ms|Hz|pH|°';
  var LABELED = new RegExp('([A-Za-z][A-Za-z0-9 _\\-]{0,24}?)\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)\\s*(' + UNITS + ')?(?![A-Za-z0-9])', 'g');
  function parseLine(line) {
    var t = String(line || '').trim(), out = [], m;
    if (!t || t.length > 300) return out;
    LABELED.lastIndex = 0;
    while ((m = LABELED.exec(t))) out.push({ metric: tidy(m[1]), value: +m[2], unit: (m[3] || '').replace(/^°?([CF])$/, '°$1') });
    if (out.length) return out;
    if (/^-?\d+(\.\d+)?(\s*[,;\t ]\s*-?\d+(\.\d+)?)*$/.test(t)) return t.split(/\s*[,;\t ]\s*/).map(function (x, i) { return { metric: 'Value ' + (i + 1), value: +x, unit: '' }; }).slice(0, 8);
    var one = t.match(new RegExp('^(-?\\d+(?:\\.\\d+)?)\\s*(' + UNITS + ')$'));
    if (one) return [{ metric: 'Value', value: +one[1], unit: one[2].replace(/^°?([CF])$/, '°$1') }];
    return out;
  }
  function tidy(s) { s = String(s).replace(/[_\-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  /** split a stream of text into whole lines; keeps the unfinished tail */
  function lineSplitter(onLine) { var buf = ''; return function (chunk) { buf += chunk; var parts = buf.split(/\r?\n|\r/); buf = parts.pop(); if (buf.length > 4000) { parts.push(buf); buf = ''; } parts.forEach(function (l) { if (l.trim()) onLine(l); }); }; }
  function spoken(list) {
    var bits = list.filter(function (r) { return isFinite(r.value) && !/^(Beat gap|Energy|Skin contact)$/.test(r.metric); }).slice(0, 4).map(function (r) {
      var u = { '%': ' percent', bpm: ' beats a minute', '°C': ' degrees', '°F': ' degrees Fahrenheit', kg: ' kilos', g: ' grams', lb: ' pounds', W: ' watts', rpm: ' r p m', hPa: ' hectopascals', 'km/h': ' kilometres an hour', spm: ' steps a minute', ms: ' milliseconds' }[r.unit] || (r.unit ? ' ' + r.unit : '');
      return r.metric.toLowerCase() + ' ' + r.value + u;
    });
    if (!bits.length) return '';
    var s = bits.length > 1 ? bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1] : bits[0];
    return s.charAt(0).toUpperCase() + s.slice(1) + ', sir.';
  }
  function csv(rows) {
    var q = function (x) { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    return ['time,device,metric,value,unit'].concat(rows.map(function (r) { return [new Date(r.at).toISOString(), r.device, r.metric, r.value, r.unit].map(q).join(','); })).join('\n');
  }
  /* only asks to connect, pair, open or read a named device: "write an Arduino sketch to read a sensor",
     "connect with investors at scale" or "talk to my cofounder about the sensor" go to the conversation */
  var DEV = '(?:scale|kitchen scale|sensor|thermometer|heart ?rate (?:strap|monitor|sensor)|chest strap|strap|calipers?|arduino|esp ?32|esp8266|pico|power meter|cadence sensor|speed sensor|bluetooth (?:device|gadget|sensor)|usb (?:device|gadget)|serial (?:device|port))';
  var DLEAD = '^\\s*(?:(?:hey |ok |okay )?(?:jarvis|kin)[,.!]*\\s*)?(?:(?:can|could|would|will) you |please |go |now |let\'s |lets )*';
  var DEND = '(?=\\s*(?:$|[.,!?;:]|(?:for|and|then|so|now|please|over|via|by)\\b))';
  var REQ = new RegExp(
    '\\bdevice lab\\b' +
    '|' + DLEAD + '(?:connect|pair|plug in|hook up|link)(?: up)?(?: to| with)?\\s+(?:my|the|this|a|an)\\s+(?:[a-z0-9-]+\\s+)?' + DEV + DEND +
    '|' + DLEAD + '(?:open|show|start)(?: up)? (?:the |my )?(?:bluetooth|usb|serial(?: monitor| console)?|devices?)(?: lab| panel)?\\s*[.!?]*\\s*$' +
    '|' + DLEAD + 'read (?:my|the|this)\\s+(?:[a-z0-9-]+\\s+)?' + DEV + '(?: readings?| values?)?\\s*[.!?]*\\s*$', 'i');
  function isRequest(t) { return REQ.test(String(t || '')); }

  /* ------------------------------------------------------------ live state */
  var ls = { get: function (k, d) { if (Kin.shared) return d; try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: function (k, v) { if (Kin.shared) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };  /* a shared address keeps nothing */
  var devices = [], log = [], subs = [], nextId = 1;
  function emit() { subs.forEach(function (f) { try { f(); } catch (e) {} }); }
  function record(dev, r) {
    if (r.metric == null) return;
    var key = r.metric + '|' + (r.unit || ''), m = dev.metrics[key];
    if (!m) { m = dev.metrics[key] = { metric: r.metric, unit: r.unit || '', series: [], text: '' }; dev.order.push(key); }
    m.value = r.value; m.text = r.text || ''; m.at = Date.now();
    if (isFinite(r.value)) { m.series.push(r.value); if (m.series.length > 120) m.series.shift(); log.push({ at: m.at, device: dev.name, metric: r.metric, value: r.value, unit: r.unit || '' }); if (log.length > 20000) log.splice(0, 5000); }
    dev.dirty = true;
  }
  function console_(dev, dir, text) { dev.lines.push({ dir: dir, text: String(text).slice(0, 400), at: Date.now() }); if (dev.lines.length > 400) dev.lines.splice(0, 100); dev.dirty = true; }
  function support() {
    var n = root.navigator || {}, secure = root.isSecureContext !== false, ios = /iPhone|iPad/.test(n.userAgent || ''), safari = /Safari/.test(n.userAgent || '') && !/Chrome|Chromium|Edg/.test(n.userAgent || '');
    var not = ios ? 'An iPhone browser cannot do this. Use Chrome on the Mac.' : safari ? 'Safari cannot do this. Open Jarvis in Chrome or Edge, or the Mac app.' : !secure ? 'Only works on the https address.' : 'This browser cannot do this. Chrome or Edge can.';
    return {
      bluetooth: !!n.bluetooth && secure, serial: !!n.serial && secure, usb: !!n.usb && secure,
      why: { bluetooth: n.bluetooth && secure ? '' : not, serial: n.serial && secure ? '' : not, usb: n.usb && secure ? '' : not }
    };
  }

  /* ------------------------------------------------------------ Bluetooth */
  function customIds() { return (ls.get('kin.dl.uuids', []) || []).map(validUuid).filter(Boolean).slice(0, 12); }
  function pairBluetooth() {
    var nav = root.navigator, opt = SVC.map(function (s) { return uuid(s.id); }).concat(customIds());
    return nav.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: opt }).then(function (bt) {
      var dev = { id: nextId++, kind: 'bluetooth', name: bt.name || 'Bluetooth device', bt: bt, metrics: {}, order: [], info: {}, lines: [], services: [], status: 'Connecting', state: {}, dirty: true };
      devices.push(dev); emit();
      bt.addEventListener('gattserverdisconnected', function () { if (dev.closed) return; dev.status = 'Lost the connection'; dev.lost = true; dev.dirty = true; emit(); });
      return connectGatt(dev).then(function () { return dev; });
    });
  }
  function connectGatt(dev) {
    dev.status = 'Connecting'; dev.lost = false; dev.dirty = true; emit();
    return dev.bt.gatt.connect().then(function (server) {
      dev.server = server;
      return server.getPrimaryServices().catch(function () { return []; });
    }).then(function (list) {
      dev.services = list.map(function (s) { return { uuid: s.uuid, svc: s, known: SVC.filter(function (k) { return uuid(k.id) === s.uuid; })[0] || null }; });
      if (dev.services.some(function (s) { return s.known && s.known.uart; })) { dev.uart = true; dev.split = lineSplitter(function (l) { console_(dev, 'in', l); parseLine(l).forEach(function (r) { record(dev, r); }); emit(); }); }
      var jobs = dev.services.filter(function (s) { return s.known; }).map(function (s) {
        return Promise.all(s.known.chars.map(function (k) {
          return s.svc.getCharacteristic(uuid(k.id)).then(function (ch) {
            if (k.write) { dev.tx = ch; return; }
            var handle = function (v) {
              if (k.dec === 'lines') { dev.split(new TextDecoder().decode(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))); return; }
              var rs = dec[k.dec](v, dev.state);
              if (s.known.info) { if (rs[0] && rs[0].text) { dev.info[k.label] = rs[0].text.slice(0, 60); dev.dirty = true; } return; }
              rs.forEach(function (r) { record(dev, r); });
            };
            var p = Promise.resolve();
            if (k.read && ch.properties.read) p = p.then(function () { return ch.readValue().then(handle, function () {}); });
            if (k.notify && (ch.properties.notify || ch.properties.indicate)) p = p.then(function () { ch.addEventListener('characteristicvaluechanged', function (e) { handle(e.target.value); emit(); }); return ch.startNotifications().catch(function () {}); });
            return p;
          }, function () {});
        }));
      });
      return Promise.all(jobs);
    }).then(function () {
      dev.status = 'Connected'; dev.dirty = true;
      if (dev.info.Model && dev.name === 'Bluetooth device') dev.name = dev.info.Model;
      remember(dev); emit();
    }, function (e) { dev.status = 'Could not connect: ' + (e && e.message || 'unknown'); dev.lost = true; dev.dirty = true; emit(); });
  }
  /** explore a service the lab does not know: list its characteristics, read what can be read */
  function explore(dev, s) {
    return s.svc.getCharacteristics().then(function (chs) {
      return Promise.all(chs.map(function (ch) {
        var row = { uuid: ch.uuid, props: Object.keys(ch.properties).filter(function (p) { try { return ch.properties[p] === true; } catch (e) { return false; } }), value: '' };
        var p = ch.properties.read ? ch.readValue().then(function (v) { row.value = hex(v); row.text = /^[\x20-\x7e]+$/.test(dec.text(v)[0].text) ? dec.text(v)[0].text : ''; }, function () { row.value = 'not readable'; }) : Promise.resolve();
        if (ch.properties.notify) { row.watch = function () { ch.addEventListener('characteristicvaluechanged', function (e) { row.value = hex(e.target.value); dev.dirty = true; emit(); }); return ch.startNotifications(); }; }
        return p.then(function () { return row; });
      }));
    }).then(function (rows) { s.rows = rows; dev.dirty = true; emit(); return rows; });
  }

  /* ------------------------------------------------------------ USB serial */
  function openSerial(baud) {
    var nav = root.navigator;
    return nav.serial.requestPort().then(function (port) {
      var i = port.getInfo ? port.getInfo() : {}, name = i.usbVendorId ? usbName(i.usbVendorId, i.usbProductId) : 'Serial device';
      var dev = { id: nextId++, kind: 'serial', name: name, port: port, baud: baud, metrics: {}, order: [], info: {}, lines: [], status: 'Opening', dirty: true };
      devices.push(dev); emit();
      return startSerial(dev).then(function () { return dev; });
    });
  }
  function startSerial(dev) {
    return dev.port.open({ baudRate: dev.baud }).then(function () {
      dev.status = 'Open at ' + dev.baud + ' baud'; dev.lost = false; dev.dirty = true; emit(); remember(dev);
      var split = lineSplitter(function (l) { console_(dev, 'in', l); parseLine(l).forEach(function (r) { record(dev, r); }); emit(); });
      var td = new TextDecoder();
      var fails = 0;
      (function loop() {
        if (!dev.port.readable || dev.closed) return;
        var reader = dev.reader = dev.port.readable.getReader();
        (function pump() {
          reader.read().then(function (r) {
            if (r.done) { reader.releaseLock(); return; }
            split(td.decode(r.value, { stream: true })); pump();
          }, function (e) {
            try { reader.releaseLock(); } catch (x) {}
            if (dev.closed) return;
            /* a framing or parity error leaves the port readable: carry on reading (a few times), else say so */
            if (dev.port.readable && ++fails <= 5) { console_(dev, 'in', '(read error: ' + (e && e.message || 'unknown') + '; reading on)'); emit(); setTimeout(loop, 200); return; }
            dev.status = 'Read error: ' + (e && e.message || 'unknown') + '. Unplugged?'; dev.lost = true; dev.dirty = true; emit();
          });
        })();
      })();
    }, function (e) { dev.status = /already open/i.test(e && e.message) ? 'Another app has this port open. Close the Arduino serial monitor first.' : 'Could not open: ' + (e && e.message || 'unknown'); dev.lost = true; dev.dirty = true; emit(); });
  }
  function closeSerial(dev) {
    var r = dev.reader; dev.reader = null;
    return (r ? r.cancel().catch(function () {}).then(function () { try { r.releaseLock(); } catch (e) {} }) : Promise.resolve()).then(function () { return dev.port.close().catch(function () {}); });
  }
  /** a line the founder typed, and only that */
  function send(dev, text) {
    var bytes = new TextEncoder().encode(String(text) + '\n');
    if (dev.kind === 'serial') {
      if (!dev.port.writable) return Promise.reject(new Error('The port is not open.'));
      var w; try { w = dev.port.writable.getWriter(); } catch (e) { return Promise.reject(new Error('The port is busy sending. Try again in a moment.')); }
      return w.write(bytes).then(function () { w.releaseLock(); console_(dev, 'out', text); emit(); }, function (e) { w.releaseLock(); throw e; });
    }
    if (dev.tx) {
      var p = Promise.resolve();
      for (var i = 0; i < bytes.length; i += 20) (function (part) { p = p.then(function () { return dev.tx.writeValueWithResponse ? dev.tx.writeValueWithResponse(part) : dev.tx.writeValue(part); }); })(bytes.slice(i, i + 20));
      return p.then(function () { console_(dev, 'out', text); emit(); });
    }
    return Promise.reject(new Error('This device does not take text.'));
  }
  var VENDORS = { 0x2341: 'Arduino', 0x2A03: 'Arduino', 0x1A86: 'CH340 USB serial', 0x10C4: 'Silicon Labs USB serial', 0x0403: 'FTDI USB serial', 0x303A: 'Espressif ESP32', 0x239A: 'Adafruit', 0x2E8A: 'Raspberry Pi Pico', 0x1366: 'SEGGER J-Link', 0x0483: 'STMicroelectronics', 0x16C0: 'Teensy' };
  function usbName(v, p) { return (VENDORS[v] || 'USB device') + ' (' + v.toString(16).padStart(4, '0') + ':' + (p || 0).toString(16).padStart(4, '0') + ')'; }

  /* ------------------------------------------------------------ USB identify */
  function identifyUsb() {
    return root.navigator.usb.requestDevice({ filters: [] }).then(function (d) {
      var dev = { id: nextId++, kind: 'usb', name: d.productName || usbName(d.vendorId, d.productId), metrics: {}, order: [], lines: [], status: 'Identified', dirty: true,
        info: { Maker: d.manufacturerName || VENDORS[d.vendorId] || 'Unknown', Product: d.productName || 'Unknown', Ids: d.vendorId.toString(16).padStart(4, '0') + ':' + d.productId.toString(16).padStart(4, '0'), USB: d.usbVersionMajor + '.' + d.usbVersionMinor } };
      devices.push(dev); emit(); return dev;
    });
  }
  function remember(dev) {
    var k = ls.get('kin.dl.known', []) || []; var e = { name: String(dev.name).slice(0, 60), kind: dev.kind, baud: dev.baud || undefined };
    k = k.filter(function (x) { return !(x.name === e.name && x.kind === e.kind); }); k.unshift(e); ls.set('kin.dl.known', k.slice(0, 12));
  }
  function drop(dev) {
    dev.closed = true;
    if (dev.kind === 'bluetooth' && dev.bt && dev.bt.gatt && dev.bt.gatt.connected) try { dev.bt.gatt.disconnect(); } catch (e) {}
    if (dev.kind === 'serial') closeSerial(dev);
    devices = devices.filter(function (d) { return d !== dev; }); emit();
  }
  function latest() { var out = []; devices.forEach(function (d) { d.order.forEach(function (k) { var m = d.metrics[k]; if (m.value != null) out.push({ device: d.name, metric: m.metric, value: m.value, unit: m.unit, at: m.at }); }); }); return out; }

  /* ------------------------------------------------------------ the panel */
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, a) { var e = document.createElementNS(SVGNS, tag); for (var k in a) e.setAttribute(k, a[k]); return e; }
  function icon(d) { var s = sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); d.split('|').forEach(function (p) { s.appendChild(sv('path', { d: p })); }); return s; }
  var I = { bt: 'M7 7l10 10-5 4V3l5 4L7 17', serial: 'M9 3v5|M15 3v5|M7 8h10v5a5 5 0 0 1-10 0z|M12 18v3', usb: 'M12 3v15|M9 6l3-3 3 3|M7 11v2l5 3|M17 9v3l-5 3|M12 18a2 2 0 1 0 0 .1', close: 'M6 6l12 12|M18 6L6 18', send: 'M5 12h13|M13 6l6 6-6 6', csv: 'M12 4v11|M7 10l5 5 5-5|M5 20h14' };
  function spark(series) {
    var w = 120, hh = 34, s = sv('svg', { viewBox: '0 0 ' + w + ' ' + hh, class: 'dl-spark', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    if (series.length < 2) return s;
    var lo = Math.min.apply(null, series), hi = Math.max.apply(null, series), span = hi - lo || 1;
    var pts = series.map(function (v, i) { return [i / (series.length - 1) * w, hh - 3 - (v - lo) / span * (hh - 6)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    s.appendChild(sv('path', { d: d + ' L' + w + ' ' + hh + ' L0 ' + hh + ' Z', class: 'dl-sparkfill' }));
    s.appendChild(sv('path', { d: d, class: 'dl-sparkline' }));
    var last = pts[pts.length - 1]; s.appendChild(sv('circle', { cx: last[0], cy: last[1], r: 2.4, class: 'dl-sparkdot' }));
    return s;
  }
  function fmtVal(v) { if (!isFinite(v)) return '–'; var a = Math.abs(v); return a >= 1000 ? Math.round(v).toLocaleString('en-US') : a >= 100 ? String(Math.round(v * 10) / 10) : String(Math.round(v * 100) / 100); }

  var cur = null;
  function live() { return devices.filter(function (d) { return d.kind !== 'usb' && !d.lost; }); }
  function dropAll() { devices.slice().forEach(drop); }
  if (root.addEventListener) root.addEventListener('pagehide', dropAll);
  /** close the lab; with devices still connected, first say so and offer to disconnect them */
  function close(force) {
    if (!cur) return;
    var n = live().length;
    if (n && force !== true && cur.ask) { cur.ask(n); return; }
    var c = cur; cur = null; subs = subs.filter(function (f) { return f !== c.paint; }); document.removeEventListener('keydown', c.key); clearInterval(c.tick); c.el.classList.add('dl-hide'); setTimeout(function () { c.el.remove(); }, 320); if (c.opts.onClose) c.opts.onClose(); }
  function open(opts) {
    close(true); opts = opts || {};
    var sup = support(), el = h('div', 'dl'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Device lab');
    var panel = h('div', 'dl-panel'); panel.tabIndex = -1; el.appendChild(panel);
    if (opts.test) panel.appendChild(h('span', 'dl-test', 'Test data'));
    var head = h('div', 'dl-head'), ht = h('div');
    ht.appendChild(h('div', 'dl-eyebrow', 'Device lab'));
    ht.appendChild(h('h2', 'dl-title', 'Pair it or plug it in, sir.'));
    ht.appendChild(h('div', 'dl-lede', 'Bluetooth and USB, read live. I only read; anything sent to a device is a line you type.'));
    head.appendChild(ht);
    var x = h('button', 'dl-pill dl-icon'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.appendChild(icon(I.close)); x.addEventListener('click', close); head.appendChild(x);
    panel.appendChild(head);

    var acts = h('div', 'dl-acts'), msg = h('div', 'dl-note'); msg.hidden = true; msg.setAttribute('aria-live', 'polite');
    function say(t, bad) { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('dl-bad', !!bad); }
    function act(ic, name, sub, ok, why, on) {
      var b = h('button', 'dl-act'); b.type = 'button'; b.disabled = !ok;
      var i = h('span', 'dl-acti'); i.appendChild(icon(ic)); b.appendChild(i);
      var t = h('span', 'dl-actt'); t.appendChild(h('b', null, name)); t.appendChild(h('span', null, ok ? sub : why)); b.appendChild(t);
      b.addEventListener('click', function () { say(''); on(b); }); acts.appendChild(b); return b;
    }
    function pickErr(e, what) { if (e && (e.name === 'NotFoundError' || /cancel/i.test(e.message || ''))) return; say(what + ' did not connect: ' + (e && e.message || 'unknown reason') + '.', true); }
    act(I.bt, 'Pair Bluetooth', 'Heart rate, scales, sensors, bike meters, ESP32 gadgets.', sup.bluetooth, sup.why.bluetooth, function () { pairBluetooth().catch(function (e) { pickErr(e, 'Bluetooth'); }); });
    var baudSel = h('select', 'dl-baud'); baudSel.setAttribute('aria-label', 'Baud rate');
    [9600, 19200, 38400, 57600, 115200, 230400].forEach(function (b) { var o = h('option', null, b + ' baud'); o.value = b; baudSel.appendChild(o); });
    baudSel.value = String(ls.get('kin.dl.baud', 115200));
    baudSel.addEventListener('change', function () { ls.set('kin.dl.baud', +baudSel.value); });
    act(I.serial, 'Connect USB serial', 'Arduino, ESP32, scales and meters on a cable.', sup.serial, sup.why.serial, function () { openSerial(+baudSel.value).catch(function (e) { pickErr(e, 'The port'); }); });
    act(I.usb, 'Identify USB device', 'Who made it and what it is. Read only.', sup.usb, sup.why.usb, function () { identifyUsb().catch(function (e) { pickErr(e, 'USB'); }); });
    panel.appendChild(acts);
    if (sup.serial) { var br = h('div', 'dl-baudrow'); br.appendChild(h('span', 'dl-label', 'Serial speed')); br.appendChild(baudSel); panel.appendChild(br); }
    panel.appendChild(msg);
    var grid = h('div', 'dl-grid'); panel.appendChild(grid);
    var empty = h('div', 'dl-empty');
    var known = (ls.get('kin.dl.known', []) || []).slice(0, 4);
    empty.appendChild(h('div', 'dl-emptyt', 'Nothing connected yet'));
    empty.appendChild(h('div', 'dl-emptys', known.length ? 'Last time: ' + known.map(function (k) { return k.name; }).join(', ') + '. The browser asks again each visit; that is its rule, not mine.' : 'Wake the device first (most only show up for a minute after a button press), then pair it.'));
    var foot = h('div', 'dl-foot');
    var ex = h('button', 'dl-pill'); ex.type = 'button'; ex.appendChild(icon(I.csv)); ex.appendChild(document.createTextNode('Readings as CSV'));
    ex.addEventListener('click', function () { var b = new Blob([csv(log)], { type: 'text/csv' }), a = h('a'); a.href = URL.createObjectURL(b); a.download = 'readings-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000); });
    var custom = h('details', 'dl-custom'); custom.appendChild(h('summary', null, 'A device with its own service id'));
    var cr = h('div', 'dl-row'); var ci = h('input', 'dl-in'); ci.placeholder = '0xFFE0 or a full 128-bit id'; ci.setAttribute('aria-label', 'Service id');
    var cb = h('button', 'dl-pill', 'Add'); cb.type = 'button';
    var clist = h('div', 'dl-chips');
    function paintIds() { clist.textContent = ''; customIds().forEach(function (u) { var c = h('button', 'dl-chip', short(u) + '  ×'); c.type = 'button'; c.title = 'Remove'; c.addEventListener('click', function () { ls.set('kin.dl.uuids', customIds().filter(function (x) { return x !== u; })); paintIds(); }); clist.appendChild(c); }); }
    cb.addEventListener('click', function () { var u = validUuid(ci.value); if (!u) { say('That is not a service id. Use 0xFFE0 or the long form with dashes.', true); return; } ls.set('kin.dl.uuids', customIds().concat([u]).filter(function (v, i, a) { return a.indexOf(v) === i; })); ci.value = ''; paintIds(); say('Added. Pair the device again so the browser lets me read that service.'); });
    cr.appendChild(ci); cr.appendChild(cb); custom.appendChild(h('p', 'dl-fine', 'Browsers only let a page read services named before pairing. Calipers, kitchen scales and tyre sensors often use their own; the maker\'s app or a tool like nRF Connect shows the id.')); custom.appendChild(cr); custom.appendChild(clist); paintIds();
    foot.appendChild(custom); foot.appendChild(ex);
    panel.appendChild(foot);

    var cards = {};
    function card(dev) {
      var c = h('div', 'dl-card'); c.dataset.kind = dev.kind;
      var ch = h('div', 'dl-ch'), nm = h('div', 'dl-name'); var ic = h('span', 'dl-kind'); ic.appendChild(icon(dev.kind === 'bluetooth' ? I.bt : dev.kind === 'serial' ? I.serial : I.usb)); nm.appendChild(ic);
      var nt = h('div'); var title = h('b', null, dev.name); var st = h('span', 'dl-status'); nt.appendChild(title); nt.appendChild(st); nm.appendChild(nt); ch.appendChild(nm);
      var btns = h('div', 'dl-btns');
      var re = h('button', 'dl-pill dl-small', 'Reconnect'); re.type = 'button'; re.hidden = true; re.addEventListener('click', function () { if (dev.kind === 'bluetooth') connectGatt(dev); else closeSerial(dev).then(function () { dev.closed = false; return startSerial(dev); }); });
      var rm = h('button', 'dl-pill dl-small dl-ghost', dev.kind === 'usb' ? 'Clear' : 'Disconnect'); rm.type = 'button'; rm.addEventListener('click', function () { drop(dev); });
      btns.appendChild(re); btns.appendChild(rm); ch.appendChild(btns); c.appendChild(ch);
      var info = h('div', 'dl-info'); c.appendChild(info);
      var tiles = h('div', 'dl-tiles'); c.appendChild(tiles);
      var con = null, lines = null;
      if (dev.kind === 'serial' || dev.uart) {
        con = h('div', 'dl-console'); lines = h('div', 'dl-lines'); lines.setAttribute('role', 'log'); lines.setAttribute('aria-label', 'Console'); con.appendChild(lines);
        var f = h('form', 'dl-row'); var inp = h('input', 'dl-in dl-mono'); inp.placeholder = 'Type a line to send'; inp.setAttribute('aria-label', 'Line to send'); inp.maxLength = 200;
        var sb2 = h('button', 'dl-pill dl-icon'); sb2.type = 'submit'; sb2.setAttribute('aria-label', 'Send'); sb2.appendChild(icon(I.send));
        f.appendChild(inp); f.appendChild(sb2); con.appendChild(f);
        f.addEventListener('submit', function (e) { e.preventDefault(); var t = inp.value; if (!t.trim()) return; send(dev, t).then(function () { inp.value = ''; }, function (err) { say('Not sent: ' + (err && err.message || 'unknown') + '.', true); }); });
        c.appendChild(con);
      }
      var ex2 = null;
      if (dev.kind === 'bluetooth') { ex2 = h('div', 'dl-explore'); c.appendChild(ex2); }
      var shownLines = 0;
      function paint() {
        title.textContent = dev.name; st.textContent = dev.status; c.classList.toggle('dl-lost', !!dev.lost); re.hidden = !dev.lost || dev.kind === 'usb';
        info.textContent = ''; Object.keys(dev.info).forEach(function (k) { var i = h('span', 'dl-chip'); i.appendChild(h('b', null, k)); i.appendChild(document.createTextNode(' ' + dev.info[k])); info.appendChild(i); });
        tiles.textContent = '';
        dev.order.forEach(function (k) {
          var m = dev.metrics[k], t = h('div', 'dl-tile');
          t.appendChild(h('div', 'dl-tl', m.metric));
          var v = h('div', 'dl-tv'); v.appendChild(document.createTextNode(m.text || fmtVal(m.value))); if (m.unit && !m.text) v.appendChild(h('small', null, m.unit)); t.appendChild(v);
          if (m.series.length > 1) t.appendChild(spark(m.series));
          tiles.appendChild(t);
        });
        tiles.hidden = !dev.order.length;
        if (lines) {
          if (dev.lines.length < shownLines) { lines.textContent = ''; shownLines = 0; }
          var stick = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 8;
          dev.lines.slice(shownLines).forEach(function (l) { var r = h('div', 'dl-l dl-' + (l.dir === 'out' ? 'tx' : 'rx')); r.appendChild(h('span', 'dl-lt', new Date(l.at).toTimeString().slice(0, 8))); r.appendChild(h('span', null, (l.dir === 'out' ? '→ ' : '') + l.text)); lines.appendChild(r); });
          shownLines = dev.lines.length; while (lines.childNodes.length > 300) lines.removeChild(lines.firstChild);
          if (stick) lines.scrollTop = lines.scrollHeight;
        }
        if (ex2) {
          ex2.textContent = '';
          var unknown = dev.services.filter(function (s) { return !s.known; });
          if (unknown.length) {
            var d = h('details', 'dl-svcs'); d.open = !!dev.openExplore; d.addEventListener('toggle', function () { dev.openExplore = d.open; });
            d.appendChild(h('summary', null, unknown.length + ' other service' + (unknown.length > 1 ? 's' : '') + ' to explore'));
            unknown.forEach(function (s) {
              var r = h('div', 'dl-svc'); var top = h('div', 'dl-row'); top.appendChild(h('code', null, short(s.uuid)));
              if (!s.rows) { var b = h('button', 'dl-pill dl-small', 'Look inside'); b.type = 'button'; b.addEventListener('click', function () { b.disabled = true; explore(dev, s).catch(function (e) { say('Could not read it: ' + (e && e.message) + '.', true); }); }); top.appendChild(b); }
              r.appendChild(top);
              (s.rows || []).forEach(function (row) { var rr = h('div', 'dl-char'); rr.appendChild(h('code', null, short(row.uuid))); rr.appendChild(h('span', 'dl-props', row.props.join(' · '))); rr.appendChild(h('code', 'dl-hex', row.text ? '"' + row.text + '"' : row.value || '–')); if (row.watch && !row.watching) { var w = h('button', 'dl-pill dl-small', 'Watch'); w.type = 'button'; w.addEventListener('click', function () { row.watching = true; row.watch().catch(function () {}); dev.dirty = true; emit(); }); rr.appendChild(w); } r.appendChild(rr); });
              d.appendChild(r);
            });
            ex2.appendChild(d);
          }
        }
        dev.dirty = false;
      }
      return { el: c, paint: paint, shape: dev.kind + (dev.uart ? '+uart' : '') };
    }
    function paintAll() {
      var ids = devices.map(function (d) { return d.id; });
      Object.keys(cards).forEach(function (id) { if (ids.indexOf(+id) < 0) { cards[id].el.remove(); delete cards[id]; } });
      devices.forEach(function (d) {
        /* a Bluetooth device turns out to speak text only after connecting: rebuild its card with a console */
        if (cards[d.id] && cards[d.id].shape !== d.kind + (d.uart ? '+uart' : '')) { var old = cards[d.id].el, nc = card(d); old.replaceWith(nc.el); cards[d.id] = nc; d.dirty = true; }
        if (!cards[d.id]) { cards[d.id] = card(d); grid.appendChild(cards[d.id].el); d.dirty = true; } if (d.dirty) cards[d.id].paint(); });
      if (!devices.length) { if (!empty.parentNode) grid.appendChild(empty); } else if (empty.parentNode) empty.remove();
      ex.disabled = !log.length;
    }
    /* readings can arrive many times a second; paint at most ~6 times a second */
    var pending = false; var paint = function () { if (pending) return; pending = true; requestAnimationFrame(function () { pending = false; if (cur) paintAll(); }); };
    subs.push(paint);
    var c = cur = { el: el, opts: opts, paint: paint };
    /* closing with devices still connected: say so, and let the founder disconnect them or leave them reading */
    c.ask = function (n) {
      if (c.asking) { c.asking.querySelector('button').focus(); return; }
      var bar = c.asking = h('div', 'dl-leave'); bar.setAttribute('role', 'alertdialog'); bar.setAttribute('aria-label', 'Devices still connected');
      bar.appendChild(h('span', 'dl-leavet', n + (n === 1 ? ' device is' : ' devices are') + ' still connected.'));
      var all = h('button', 'dl-pill dl-primary', 'Disconnect all'); all.type = 'button'; all.addEventListener('click', function () { dropAll(); close(true); });
      var keep = h('button', 'dl-pill dl-ghost', 'Keep them connected'); keep.type = 'button'; keep.addEventListener('click', function () { close(true); });
      bar.appendChild(all); bar.appendChild(keep); panel.insertBefore(bar, panel.children[1] || null); all.focus();
    };
    c.tick = setInterval(paint, 1000);
    c.key = function (e) { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', c.key);
    paintAll();
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('dl-show'); panel.focus({ preventScroll: true }); });
    if (opts.onSay) opts.onSay(devices.length ? summary() || 'The device lab is open, sir.' : 'The device lab is open, sir. Wake the device and pair it.');
    return { close: close, element: el };
  }
  function summary() { return spoken(latest()); }

  Kin.devices = {
    isRequest: isRequest, support: support, open: open, close: close, latest: latest, summary: summary, exportCSV: function () { return csv(log); },
    pairBluetooth: pairBluetooth, openSerial: openSerial, identifyUsb: identifyUsb, send: send, list: function () { return devices.slice(); },
    _: { dec: dec, float32: float32, sfloat: sfloat, parseLine: parseLine, lineSplitter: lineSplitter, spoken: spoken, csv: csv, uuid: uuid, short: short, validUuid: validUuid, hex: hex, isRequest: isRequest, SVC: SVC, usbName: usbName }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Kin.devices;
})();
