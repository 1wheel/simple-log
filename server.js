// simple-log: one small server for one writer. No framework, no npm packages.
//
//   data/config.json          title, site url, the passphrase's scrypt hash, the cookie secret
//   data/posts/<id>.jsonl     each post, one line per batch of edits, appended, never rewritten
//   data/media/<name>.jpg     pictures, metadata stripped
//   data/site/                the public pages, rendered from the logs: index.html, feed.xml, p/<slug>.html
//
// Run: node server.js  (PORT, default 8090; DATA_DIR, default ./data)

var http = require('http')
var fs = require('fs')
var path = require('path')
var crypto = require('crypto')
var ot = require('./public/ot')
var auth = require('./lib/auth')
var media = require('./lib/media')
var render = require('./lib/render')

var PORT = +process.env.PORT || 8090
var DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'))
var PUBLIC = path.join(__dirname, 'public')
var POSTS = path.join(DATA, 'posts'), MEDIA = path.join(DATA, 'media'), SITE = path.join(DATA, 'site')

var config
try { config = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')) } catch (e){
  console.error('No ' + path.join(DATA, 'config.json') + ' yet. Run: node bin/passphrase.js')
  process.exit(1)
}
;[POSTS, MEDIA, SITE, path.join(SITE, 'p')].forEach(d => fs.mkdirSync(d, {recursive: true}))

// the app's version: a hash of its files, so any change to them reaches phones by itself
var SHELL = ['index.html', 'app.js', 'app.css', 'ot.js', 'sync.js', 'sw.js', 'manifest.json', 'manifest-eink.json', 'icon-192.png', 'icon-512.png']
var VERSION = crypto.createHash('sha256').update(SHELL.map(f => fs.readFileSync(path.join(PUBLIC, f))).join('')).digest('hex').slice(0, 8)

// ---- posts: all of them in memory, each one's log on disk

var ID = /^[0-9a-z]{8,40}$/
var posts = new Map()   // id -> {id, batches, text, head, created, edited, public, slug, published}

function fold(p, b){
  p.text = ot.applyAll(p.text, b.ops)
  p.head = b.seq
  if (!p.created) p.created = b.at
  b.ops.forEach(o => {
    if (!o.meta){ p.edited = Math.max(p.edited, o.t); return }
    if ('public' in o.meta){ p.public = o.meta.public; if (p.public && !p.published) p.published = b.at }
    if ('slug' in o.meta) p.slug = o.meta.slug
  })
  p.batches.push(b)
}

function load(id){
  var p = {id, batches: [], text: '', head: 0, created: 0, edited: 0, public: false, slug: '', published: 0}
  var file = path.join(POSTS, id + '.jsonl'), raw = fs.readFileSync(file, 'utf8')
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return
    // a line torn by a crash, or one that doesn't follow on, is skipped (and kept in the file)
    try { var b = JSON.parse(line); if (b.seq != p.head + 1) throw new Error('out of order'); fold(p, b) }
    catch (e){ console.error('skipping', file + ':' + (i + 1), e.message) }
  })
  if (raw && !raw.endsWith('\n')) fs.appendFileSync(file, '\n')
  return p
}

fs.readdirSync(POSTS).filter(f => f.endsWith('.jsonl')).forEach(f => {
  var id = f.slice(0, -6)
  if (ID.test(id)) posts.set(id, load(id))
})

function append(id, bid, ops){
  var p = posts.get(id) || {id, batches: [], text: '', head: 0, created: 0, edited: 0, public: false, slug: '', published: 0}
  var b = {seq: p.head + 1, at: Date.now(), bid, ops}
  ot.applyAll(p.text, ops)   // throws, before anything is written, if the ops don't fit
  var fd = fs.openSync(path.join(POSTS, id + '.jsonl'), 'a')
  try { fs.writeSync(fd, JSON.stringify(b) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fold(p, b)
  posts.set(id, p)
  if (p.public || ops.some(o => o.meta)) publish()
  return p
}

var validOp = o => o && typeof o == 'object' && Object.keys(o).length == 4
  && typeof o.t == 'number' && isFinite(o.t) && Number.isInteger(o.pos) && o.pos >= 0
  && typeof o.del == 'string' && typeof o.ins == 'string' && !!(o.del || o.ins)

// a slug from the title, never one another post has
function slugFor(p){
  var base = render.title(p.text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '') || 'post'
  var taken = new Set([...posts.values()].filter(q => q.id != p.id).map(q => q.slug))
  for (var slug = base, n = 2; taken.has(slug); n++) slug = base + '-' + n
  return slug
}

// ---- the public site, as files: rewritten whenever a public post (or a visibility) changes

function writeFile(file, body){
  var tmp = file + '.tmp'
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
}

// pictures in public posts are open to anyone; the rest only to the signed-in owner
var publicMedia = new Set()

function publish(){
  var pub = [...posts.values()].filter(p => p.public && p.slug).sort((a, b) => b.published - a.published)
  publicMedia = new Set(pub.flatMap(p => [...p.text.matchAll(/\/media\/([0-9a-z]{20,40})-\d+\.jpg/g)].map(m => m[1])))
  var keep = new Set(pub.map(p => p.slug + '.html'))
  fs.readdirSync(path.join(SITE, 'p')).forEach(f => { if (!keep.has(f)) fs.unlinkSync(path.join(SITE, 'p', f)) })
  pub.forEach(p => writeFile(path.join(SITE, 'p', p.slug + '.html'), render.page(p, config, MEDIA)))
  writeFile(path.join(SITE, 'index.html'), render.home(pub, config))
  writeFile(path.join(SITE, 'feed.xml'), render.feed(pub, config, MEDIA))
}
publish()

// ---- http

var TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/rss+xml; charset=utf-8'}

function send(res, status, body, type, headers){
  res.writeHead(status, Object.assign({'Content-Type': type || 'application/json', 'X-Content-Type-Options': 'nosniff'}, headers))
  res.end(typeof body == 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

function file(res, f, headers){
  fs.readFile(f, (err, buf) => {
    if (err) return send(res, 404, notFound, TYPES['.html'])
    if (f.startsWith(PUBLIC) && /\.(js|html)$/.test(f)) buf = buf.toString().replace(/__VERSION__/g, VERSION)
    send(res, 200, buf, TYPES[path.extname(f)], headers)
  })
}
var notFound = '<!doctype html><meta charset=utf-8><title>Not found</title><p style="font:18px system-ui;margin:3em auto;max-width:30em">Nothing here. <a href="/">Home</a></p>'

// the request body, or null as soon as it's bigger than max (the rest isn't kept)
function body(req, max, cb){
  var chunks = [], size = 0, done = false
  req.on('data', c => {
    if (done) return
    size += c.length
    if (size <= max) return chunks.push(c)
    done = true; chunks = []; cb(null)
  })
  req.on('end', () => { if (!done){ done = true; cb(Buffer.concat(chunks)) } })
}

// a JSON object, or a 400/413. A throw in cb is a 500, not a crash.
function json(req, res, max, cb){
  body(req, max, buf => {
    if (!buf) return send(res, 413, {error: 'too big'}, null, {Connection: 'close'})
    try { var data = JSON.parse(buf) } catch (e){}
    if (!data || typeof data != 'object' || Array.isArray(data)) return send(res, 400, {error: 'not json'})
    try { cb(data) } catch (e){ console.error(e); if (!res.headersSent) send(res, 500, {error: 'something broke'}) }
  })
}
var SMALL = 4 * 1024, BIG = 8 * 1024 * 1024

var server = http.createServer((req, res) => {
  var u = new URL(req.url, 'http://x'), p = u.pathname, m
  var nocache = {'Cache-Control': 'no-cache'}

  // public
  // the public pages have no scripts, and say so
  var site = Object.assign({'Content-Security-Policy': "script-src 'none'"}, nocache)
  if (p == '/health') return send(res, 200, {ok: true, version: VERSION})
  if (p == '/') return file(res, path.join(SITE, 'index.html'), site)
  if (p == '/feed.xml') return file(res, path.join(SITE, 'feed.xml'), site)
  if ((m = p.match(/^\/p\/([a-z0-9-]{1,80})$/))) return file(res, path.join(SITE, 'p', m[1] + '.html'), site)
  if ((m = p.match(media.NAME))){
    if (publicMedia.has(m[1].split('-')[0])) return file(res, path.join(MEDIA, m[1]), {'Cache-Control': 'public, max-age=86400'})
    if (auth.signedIn(req, config)) return file(res, path.join(MEDIA, m[1]), {'Cache-Control': 'private, max-age=31536000, immutable'})
    return send(res, 404, notFound, TYPES['.html'])
  }
  if (p == '/login') return file(res, path.join(PUBLIC, 'login.html'), nocache)
  if (p == '/write') return send(res, 301, '', 'text/plain', {Location: '/write/'})
  if (p == '/write/') return file(res, path.join(PUBLIC, 'index.html'), nocache)
  if ((m = p.match(/^\/write\/([a-z0-9.-]+)$/)) && SHELL.includes(m[1]))
    return file(res, path.join(PUBLIC, m[1]), Object.assign({}, nocache, m[1] == 'sw.js' ? {'Service-Worker-Allowed': '/write/'} : {}))
  if (!p.startsWith('/api/')) return send(res, 404, notFound, TYPES['.html'])

  // the api. Writes must be JSON (or a JPEG), which a form on another site can't send,
  // and the browser says where a request came from.
  if (req.method != 'GET'){
    var type = req.headers['content-type'] || '', site = req.headers['sec-fetch-site']
    if (site && site != 'same-origin' && site != 'none') return send(res, 403, {error: 'not from this site'})
    if (!/^application\/json\b/.test(type) && !(p.startsWith('/api/media/') && type == 'image/jpeg'))
      return send(res, 415, {error: 'send json'})
  }
  if (p == '/api/login' && req.method == 'POST'){
    // nginx says when a request came over plain http; a passphrase should never travel that way
    if (req.headers['x-forwarded-proto'] == 'http')
      return send(res, 400, {error: 'sign in over https'})
    return json(req, res, SMALL, d => auth.login(req, res, d, config, send))
  }
  if (p == '/api/logout' && req.method == 'POST') return send(res, 200, {ok: true}, null, {'Set-Cookie': auth.clearCookie()})
  if (!auth.signedIn(req, config)) return send(res, 401, {error: 'sign in'})

  if (p == '/api/me') return send(res, 200, {ok: true, version: VERSION})
  if (p == '/api/posts') return send(res, 200, [...posts.values()].map(p => ({id: p.id, title: render.title(p.text), head: p.head, edited: p.edited, public: p.public, slug: p.slug})))
  if ((m = p.match(media.NAME_API)) && req.method == 'PUT') return media.put(req, res, m[1], MEDIA, send, body, publish)

  if (!(m = p.match(/^\/api\/posts\/([0-9a-z]{8,40})(\/batches|\/public)?$/))) return send(res, 404, {error: 'not found'})
  var id = m[1], post = posts.get(id), empty = {head: 0, text: '', public: false, slug: ''}
  if (req.method == 'GET' && !m[2]) return send(res, 200, post ? {head: post.head, text: post.text, public: post.public, slug: post.slug} : empty)
  if (req.method == 'GET' && m[2] == '/batches'){
    var since = +u.searchParams.get('since') || 0
    return send(res, 200, {head: post ? post.head : 0, batches: post ? post.batches.slice(since) : []})
  }
  if (req.method != 'POST') return send(res, 405, {error: 'no'})

  if (m[2] == '/public') return json(req, res, SMALL, d => {
    if (!post) return send(res, 404, {error: 'write something first'})
    var ops = [{t: Date.now(), pos: 0, del: '', ins: '', meta: {public: !!d.public}}]
    if (d.public && !post.slug) ops.push({t: Date.now(), pos: 0, del: '', ins: '', meta: {slug: slugFor(post)}})
    if (!!d.public != post.public || ops.length > 1) append(id, 'server' + crypto.randomBytes(6).toString('hex'), ops)
    send(res, 200, {head: post.head, public: post.public, slug: post.slug})
  })

  // a batch of edits: {base, bid, ops}. base is the head the ops were typed against.
  json(req, res, BIG, d => {
    if (!Number.isInteger(d.base) || typeof d.bid != 'string' || !/^[0-9a-z]{2,40}$/.test(d.bid)
      || !Array.isArray(d.ops) || !d.ops.length || !d.ops.every(validOp)) return send(res, 400, {error: 'bad batch'})
    var head = post ? post.head : 0
    if (d.base < head) return send(res, 409, {head, batches: post.batches.slice(d.base)})
    // the device knows of more than the server has (say, the server came back from an old backup)
    if (d.base > head) return send(res, 409, {head, reset: true, text: post ? post.text : ''})
    try { post = append(id, d.bid, d.ops) } catch (e){
      if (/does not fit/.test(e.message)) return send(res, 422, {error: e.message, head, text: post ? post.text : ''})
      console.error(e); return send(res, 500, {error: 'could not save'})
    }
    send(res, 200, {head: post.head})
  })
})

if (require.main == module) server.listen(PORT, '127.0.0.1', () => console.log('simple-log ' + VERSION + ' on http://localhost:' + PORT))
module.exports = server
