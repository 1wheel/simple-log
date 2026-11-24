// Pictures. The browser makes the sizes (640, 1280, 2400 pixels on the long side) and PUTs
// each one as image/jpeg to /api/media/<id>-<size>.jpg. <id> is 20 random letters and digits
// made in the browser, so a picture can go into the text offline. The server shows a picture
// to strangers only while a public post uses it. Before saving, the camera's metadata (GPS,
// serial numbers, captions) is cut out of the file: no image library, just the JPEG's segment list.

var fs = require('fs')
var path = require('path')

var NAME = /^\/media\/([0-9a-z]{20,40}-(?:640|1280|2400)\.jpg)$/
var NAME_API = /^\/api\/media\/([0-9a-z]{20,40}-(?:640|1280|2400)\.jpg)$/
var MAX = 15 * 1024 * 1024

// A JPEG is FF D8, then segments (FF <marker> <2-byte length> <data>); each SOS (FF DA) segment
// is followed by image data, which ends at the next FF that isn't FF 00 or a restart FF D0-D7.
// The end is FF D9. Dropped: APP1 (EXIF, XMP), APP2 unless it's the color profile, APP3-APP13
// (IPTC, Photoshop, maker notes), APP15, COM (comments), and anything after FF D9 (phones put
// extra images there, with their own GPS). Kept: APP0 (JFIF), APP14 (Adobe color), tables,
// frame headers and the image data. null if it isn't a JPEG whose segments add up.
function strip(b){
  if (!(b.length > 4 && b[0] == 0xff && b[1] == 0xd8)) return null
  var out = [b.subarray(0, 2)], i = 2
  while (i + 2 <= b.length){
    if (b[i] != 0xff) return null
    var m = b[i + 1]
    if (m == 0xff){ i++; continue }   // padding
    if (m == 0xd9) return Buffer.concat(out.concat(b.subarray(i, i + 2)))
    if (m == 0x01 || (m >= 0xd0 && m <= 0xd8)){ out.push(b.subarray(i, i + 2)); i += 2; continue }   // no length
    if (i + 4 > b.length) return null
    var end = i + 2 + b.readUInt16BE(i + 2)
    if (end > b.length) return null
    var icc = m == 0xe2 && b.toString('latin1', i + 4, i + 16) == 'ICC_PROFILE\0'
    var drop = m == 0xfe || (m >= 0xe1 && m <= 0xef && m != 0xee && !icc)
    if (!drop) out.push(b.subarray(i, end))
    i = end
    if (m == 0xda){
      var j = i
      while (j + 1 < b.length && !(b[j] == 0xff && b[j + 1] != 0 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++
      if (j + 1 >= b.length) return Buffer.concat(out.concat(b.subarray(i)))   // cut short, no FF D9: keep what's there
      out.push(b.subarray(i, j))
      i = j
    }
  }
  return null
}

function put(req, res, name, dir, send, body, done){
  body(req, MAX, buf => {
    if (!buf) return send(res, 413, {error: 'too big'})
    var clean = strip(buf)
    if (!clean) return send(res, 415, {error: 'not a jpeg'})
    var file = path.join(dir, name)
    try { fs.writeFileSync(file + '.tmp', clean); fs.renameSync(file + '.tmp', file) } catch (e){
      console.error(e); return send(res, 500, {error: 'could not save'})
    }
    send(res, 200, {url: '/media/' + name})
    if (done) done()
  })
}

module.exports = {strip, put, NAME, NAME_API}
