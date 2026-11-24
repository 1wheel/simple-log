var test = require('node:test')
var assert = require('node:assert')
var media = require('../lib/media')
var {start} = require('./helpers')

// a JPEG's segments: FF <marker> <length, which counts itself> <data>
var seg = (m, data) => { var d = Buffer.from(data, 'latin1'), h = Buffer.from([0xff, m, 0, 0]); h.writeUInt16BE(d.length + 2, 2); return Buffer.concat([h, d]) }
var SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9])
var scan = Buffer.concat([seg(0xda, '\x00\x01\x01\x00\x00\x3f\x00'), Buffer.from('pixel data FF00\xff\x00 more', 'latin1'), EOI])
var jpeg = Buffer.concat([SOI,
  seg(0xe0, 'JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'),
  seg(0xe1, 'Exif\x00\x00GPSLatitude 40.7128 N camera serial 12345'),
  seg(0xe1, 'http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>Creator: Someone</x:xmpmeta>'),
  seg(0xe2, 'ICC_PROFILE\x00\x01\x01sRGB profile bytes'),
  seg(0xe2, 'MPF\x00 other app2'),
  seg(0xed, 'Photoshop 3.0\x008BIM IPTC caption: home address'),
  seg(0xfe, 'a secret comment'),
  seg(0xdb, '\x00' + 'q'.repeat(64)),
  seg(0xc0, '\x08\x00\x10\x00\x10\x01\x01\x11\x00'),
  scan])

test('strip drops EXIF, XMP, IPTC and comments, keeps the picture', () => {
  var out = media.strip(jpeg).toString('latin1')
  for (var gone of ['Exif', 'GPS', 'serial', 'xmpmeta', 'Photoshop', 'IPTC', 'secret', 'MPF']) assert.ok(!out.includes(gone), gone + ' is still in it')
  for (var kept of ['JFIF', 'ICC_PROFILE', 'qqqq', 'pixel data FF00']) assert.ok(out.includes(kept), kept + ' was lost')
  assert.ok(media.strip(jpeg).subarray(-scan.length).equals(scan), 'the image data is untouched')
})

test('strip drops whatever comes after the end of the image', () => {
  var extra = Buffer.from('\xff\xd8\xff\xe1 Exif GPS 51.5N <script>alert(1)</script>', 'latin1')
  var out = media.strip(Buffer.concat([jpeg, extra]))
  assert.ok(out.equals(media.strip(jpeg)))
  assert.ok(!out.toString('latin1').includes('GPS'))
})

test('strip keeps every scan of a progressive JPEG', () => {
  var scan2 = Buffer.concat([seg(0xc4, '\x10' + 'h'.repeat(20)), seg(0xda, '\x00\x01\x01\x00\x00\x3f\x00'), Buffer.from('second scan \xff\xd3 restart', 'latin1')])
  var prog = Buffer.concat([jpeg.subarray(0, -2), scan2, EOI])
  var out = media.strip(prog).toString('latin1')
  assert.ok(out.includes('pixel data') && out.includes('hhhh') && out.includes('second scan \xff\xd3 restart'))
  assert.ok(out.endsWith('\xff\xd9'))
})

test('strip refuses what is not a JPEG', () => {
  assert.equal(media.strip(Buffer.from('GIF89a....')), null)
  assert.equal(media.strip(Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0xff, 0xff, 1, 2])])), null, 'a length past the end')
  assert.equal(media.strip(Buffer.concat([SOI, seg(0xe0, 'JFIF')])), null, 'no image data')
})

test('upload and serve', async t => {
  var s = await start()
  t.after(s.stop)
  var name = 'abcdefghij0123456789xyz-1280.jpg'
  var put = (n, body, type, cookie) => s.fetch('/api/media/' + n, {method: 'PUT', headers: {Cookie: cookie == null ? s.cookie : cookie, 'Content-Type': type || 'image/jpeg'}, body})

  assert.equal((await put(name, jpeg)).status, 401, 'signed out')
  await s.login()
  assert.equal((await put(name, jpeg, 'text/plain')).status, 415)
  assert.equal((await put(name, Buffer.from('<svg onload=alert(1)>'))).status, 415)
  assert.equal((await put('short-1280.jpg', jpeg)).status, 404, 'a guessable name')
  assert.equal((await put('abcdefghij0123456789xyz-999.jpg', jpeg)).status, 404, 'not one of the sizes')
  var r = await put(name, jpeg)
  assert.equal(r.status, 200)
  assert.equal((await r.json()).url, '/media/' + name)

  assert.equal((await s.fetch('/media/' + name)).status, 404, 'a picture in no public post is hidden from strangers')
  var got = await s.fetch('/media/' + name, {headers: {Cookie: s.cookie}})
  assert.equal(got.status, 200)
  assert.match(got.headers.get('cache-control'), /private/)
  assert.equal(got.headers.get('content-type'), 'image/jpeg')
  var buf = Buffer.from(await got.arrayBuffer())
  assert.ok(buf.equals(media.strip(jpeg)))
  assert.ok(!buf.toString('latin1').includes('GPS'))
  assert.equal((await s.fetch('/media/abcdefghij0123456789xyz-640.jpg', {headers: {Cookie: s.cookie}})).status, 404)

  // in a public post, anyone can see it; private again, strangers can't
  var id = 'mediatest01'
  assert.equal((await s.post('/api/posts/' + id, {base: 0, bid: 'm1', ops: [{t: 1, pos: 0, del: '', ins: 'Pics\n\n![](/media/' + name + ')'}]})).status, 200)
  assert.equal((await s.post('/api/posts/' + id + '/public', {public: true})).status, 200)
  got = await s.fetch('/media/' + name)
  assert.equal(got.status, 200)
  assert.match(got.headers.get('cache-control'), /public/)
  assert.equal((await s.post('/api/posts/' + id + '/public', {public: false})).status, 200)
  assert.equal((await s.fetch('/media/' + name)).status, 404)
})
