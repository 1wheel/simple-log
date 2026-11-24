// The writing app. Every keystroke becomes an op ({t, pos, del, ins}, see ot.js), saved on the
// device at once (IndexedDB) and sent to the server when it can be (see sync.js). The page is
// only the text; everything else is behind the corner button.

var $ = id => document.getElementById(id)
var ta = $('text')
var VERSION = '__VERSION__'

// ---- the network: every request has a deadline

async function req(url, opts, ms){
  var ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms || 8000)
  try {
    var r = await fetch(url, Object.assign({signal: ctl.signal, credentials: 'same-origin'}, opts))
    var data = /json/.test(r.headers.get('content-type') || '') ? await r.json() : null
    return {status: r.status, data}
  } catch (e){ return {status: 0, data: null} } finally { clearTimeout(timer) }
}
var post = (url, data) => req(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})

// ---- IndexedDB: posts (each one's sync state) and pictures waiting to upload

var db = new Promise((ok, fail) => {
  var r = indexedDB.open('simple-log', 1)
  r.onupgradeneeded = () => { r.result.createObjectStore('posts', {keyPath: 'id'}); r.result.createObjectStore('media', {keyPath: 'name'}) }
  r.onsuccess = () => ok(r.result)
  r.onerror = () => fail(r.error)
})
function idb(store, fn){
  return db.then(d => new Promise((ok, fail) => {
    var tx = d.transaction(store, 'readwrite'), out = fn(tx.objectStore(store))
    tx.oncomplete = () => ok(out && out.result)
    tx.onerror = () => fail(tx.error)
  }))
}
var all = store => idb(store, s => s.getAll())
// saves go one after another, in order, so a slow write can't land after a newer one
var saving = Promise.resolve()
var save = p => (saving = saving.then(() => idb('posts', s => s.put(JSON.parse(JSON.stringify(p))))).catch(console.error))

// ---- the posts

var posts = new Map()   // id -> {id, head, text, fly, pend, public, slug, edited}
var cur = null
// n random letters and digits (bytes of 252 and up are thrown away, so each of the 36 is as likely)
var randomId = n => { var s = ''; while (s.length < n) for (var x of crypto.getRandomValues(new Uint8Array(n))) if (x < 252 && s.length < n) s += (x % 36).toString(36); return s }
var newId = () => Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(10)), b => (b % 36).toString(36)).join('')
var titleOf = text => (text.split('\n').map(l => l.trim()).find(l => l) || 'Untitled').replace(/^#+\s*/, '').slice(0, 80)
var waiting = p => p.pend.length + (p.fly ? p.fly.ops.length : 0)

function blank(id){ return {id, head: 0, text: '', fly: null, pend: [], public: false, slug: '', edited: Date.now()} }

function show(p){
  cur = p
  ta.value = sync.local(p)
  try { localStorage.setItem('simple-log-open', p.id) } catch (e){}
  drawMenu()
}

// an edit on screen -> an op. The caret says which of two same letters was typed
var shown = ''
ta.addEventListener('input', () => {
  var op = ot.diff(shown, ta.value, ta.selectionEnd)
  shown = ta.value
  if (!op || readOnly) return
  cur.pend.push(op)
  cur.edited = op.t
  save(cur)
  drawFoot()
  later()
})
var showText = () => { shown = ta.value }

// the server's text moved on: put the new local text on screen, keeping the caret in place
function redraw(){
  var want = sync.local(cur)
  if (want == ta.value) return
  var op = ot.diff(ta.value, want), a = ta.selectionStart, b = ta.selectionEnd
  ta.value = want
  ta.setSelectionRange(ot.mapPos(a, [op]), ot.mapPos(b, [op]))
  showText()
}

// ---- sync: send each post's unsent ops, then catch up on the open one

var status = 'starting', syncing = false, timer = null
var later = () => { clearTimeout(timer); timer = setTimeout(syncAll, 800) }

async function syncPost(p){
  for (var tries = 0; tries < 5; tries++){
    var body = sync.outgoing(p)
    if (!body) return true
    await save(p)   // marked in flight before it goes, so a closed tab resends the same batch
    var r = await post('/api/posts/' + p.id, body)
    if (r.status == 200) sync.ack(p, r.data.head)
    else if (r.status == 409 && r.data.reset) sync.reset(p, r.data.text, r.data.head, sync.local(p))
    else if (r.status == 409) sync.absorb(p, r.data.batches)
    else if (r.status == 422) sync.reset(p, r.data.text, r.data.head, sync.local(p))
    else return fail(r.status)
    await save(p)
    if (p == cur) redraw()
  }
  return true
}

function fail(code){
  status = code == 401 ? 'signin' : code == 0 ? 'offline' : 'error ' + code
  drawFoot()
  return false
}

async function syncAll(){
  if (syncing) return later()
  syncing = true
  try {
    // pictures first, so a public page never links to one that isn't there yet
    if (!(await uploadAll())) return
    for (var p of posts.values()) if (waiting(p) && !(await syncPost(p))) return
    // what the server has that we don't, for the open post
    if (cur && !cur.fly){
      var r = await req('/api/posts/' + cur.id + '/batches?since=' + cur.head)
      if (r.status != 200) return fail(r.status)
      if (r.data.head > cur.head && !cur.fly){ sync.absorb(cur, r.data.batches); save(cur); redraw() }
      if (r.data.head < cur.head){ var t = await req('/api/posts/' + cur.id); if (t.status == 200){ sync.reset(cur, t.data.text, t.data.head, sync.local(cur)); save(cur) } }
    }
    var l = await req('/api/posts')
    if (l.status != 200) return fail(l.status)
    l.data.forEach(s => {
      var p = posts.get(s.id)
      if (!p){ p = blank(s.id); p.head = -1; posts.set(s.id, p) }   // head -1: not fetched yet
      Object.assign(p, {public: s.public, slug: s.slug, title: s.title, edited: Math.max(p.edited || 0, s.edited)})
    })
    status = 'synced'
  } finally {
    syncing = false
    drawFoot(); drawMenu()
  }
}

async function open(id){
  var p = posts.get(id)
  if (p.head < 0){
    var r = await req('/api/posts/' + id)
    if (r.status != 200) return fail(r.status)
    Object.assign(p, {head: r.data.head, text: r.data.text, public: r.data.public, slug: r.data.slug})
    save(p)
  }
  show(p); showText(); ta.focus()
  syncAll()
}

// ---- pictures: the browser makes three sizes; they wait in IndexedDB until they're uploaded

var SIZES = [640, 1280, 2400]
async function addImage(file){
  var img = await createImageBitmap(file, {imageOrientation: 'from-image'})
  var long = Math.max(img.width, img.height), id = randomId(20)
  var made = SIZES.filter(s => s <= long)
  if (!made.length) made = [640]
  for (var s of made){
    var k = Math.min(1, s / long), c = document.createElement('canvas')
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    var blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.85))
    await idb('media', st => st.put({name: id + '-' + s + '.jpg', blob}))
  }
  var main = made.filter(s => s <= 1280).pop()
  // on a paragraph of its own
  var at = ta.selectionEnd, before = ta.value.slice(0, at)
  var line = (!before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n') + '![](/media/' + id + '-' + main + '.jpg)\n\n'
  ta.setRangeText(line, at, at, 'end')
  ta.dispatchEvent(new Event('input'))
  later()
}

async function uploadAll(){
  for (var m of await all('media')){
    var r = await req('/api/media/' + m.name, {method: 'PUT', headers: {'Content-Type': 'image/jpeg'}, body: m.blob}, 60000)
    if (r.status != 200) return fail(r.status)
    await idb('media', st => st.delete(m.name))
  }
  return true
}

// ---- the menu

var menu = $('menu')
function toggleMenu(open){
  menu.hidden = open == null ? !menu.hidden : !open
  if (!menu.hidden){ drawMenu(); syncAll() }
}
$('menu-btn').onclick = () => toggleMenu()
document.addEventListener('keydown', e => { if (e.key == 'Escape' && $('replay').hidden) toggleMenu() })
ta.addEventListener('pointerdown', () => toggleMenu(false))

function drawMenu(){
  if (!cur) return
  var list = [...posts.values()].filter(p => p == cur || p.head != 0 || waiting(p)).sort((a, b) => b.edited - a.edited)
  $('list').replaceChildren(...list.map(p => {
    var li = document.createElement('li'), t = document.createElement('div'), s = document.createElement('span')
    t.textContent = p.head < 0 ? p.title || 'Untitled' : titleOf(sync.local(p))
    s.textContent = (p.public ? 'public · ' : '') + new Date(p.edited).toLocaleDateString()
    li.append(t, s)
    li.className = p == cur ? 'here' : ''
    li.onclick = () => { toggleMenu(false); open(p.id) }
    return li
  }))
  $('public').checked = cur.public
  var link = $('public-link')
  link.hidden = !(cur.public && cur.slug)
  link.href = '/p/' + cur.slug
  link.textContent = location.host + '/p/' + cur.slug
}

$('new').onclick = () => {
  var p = blank(newId())
  posts.set(p.id, p)
  toggleMenu(false); show(p); showText(); ta.focus()
}
$('image').onclick = () => $('file').click()
$('file').onchange = e => { if (e.target.files[0]) addImage(e.target.files[0]).catch(err => alert('Could not add that picture: ' + err.message)); e.target.value = '' }

$('public').onchange = async e => {
  var want = e.target.checked
  await syncAll()   // the post has to be on the server first
  var r = await post('/api/posts/' + cur.id + '/public', {public: want})
  if (r.status != 200){ e.target.checked = !want; alert(r.status == 0 ? 'Making a post public needs a connection.' : 'That didn\'t work (' + r.status + ').'); return }
  Object.assign(cur, {public: r.data.public, slug: r.data.slug})
  save(cur); drawMenu(); syncAll()
}

$('logout').onclick = async () => {
  if ([...posts.values()].some(waiting) && !confirm('Some edits haven\'t reached the server yet. They stay on this device. Sign out anyway?')) return
  await post('/api/logout', {})
  location.href = '/login'
}

// ---- replay: the post's whole log, played back at the speed it was typed (pauses shortened)

var rp = null
$('replay-btn').onclick = async () => {
  await syncAll()
  var r = await req('/api/posts/' + cur.id + '/batches?since=0', {}, 30000)
  if (r.status != 200) return alert(r.status == 0 ? 'Replay needs a connection.' : 'Replay failed (' + r.status + ').')
  var ops = r.data.batches.flatMap(b => b.ops).filter(o => !o.meta)
  if (!ops.length) return alert('Nothing to replay yet.')
  toggleMenu(false)
  rp = {ops, i: 0, text: '', pos: 0, speed: 4, playing: true, timer: null}
  $('scrub').max = ops.length
  $('replay').hidden = false
  tick()
}
function drawReplay(){
  var t = $('replay-text'), caret = document.createElement('span')
  caret.className = 'caret'
  t.replaceChildren(rp.text.slice(0, rp.pos), caret, rp.text.slice(rp.pos))
  $('scrub').value = rp.i
  $('play').textContent = rp.playing ? 'Pause' : rp.i >= rp.ops.length ? 'Again' : 'Play'
}
function step(){
  var o = rp.ops[rp.i++]
  rp.text = ot.apply(rp.text, o)
  rp.pos = o.pos + o.ins.length
}
function tick(){
  clearTimeout(rp.timer)
  if (rp.playing && rp.i < rp.ops.length){
    step()
    var next = rp.ops[rp.i], gap = next ? Math.min(1500, Math.max(0, next.t - rp.ops[rp.i - 1].t)) : 0
    rp.timer = setTimeout(tick, gap / rp.speed)
  } else rp.playing = false
  drawReplay()
}
$('play').onclick = () => {
  if (rp.i >= rp.ops.length) Object.assign(rp, {i: 0, text: '', pos: 0})
  rp.playing = !rp.playing
  tick()
}
$('speed').onclick = e => {
  rp.speed = {1: 4, 4: 16, 16: 64, 64: 1}[rp.speed]
  e.target.textContent = rp.speed + '×'
}
$('scrub').oninput = e => {
  var to = +e.target.value
  if (to < rp.i) Object.assign(rp, {i: 0, text: '', pos: 0})
  while (rp.i < to) step()
  rp.playing = false
  tick()
}
$('close-replay').onclick = () => { clearTimeout(rp.timer); $('replay').hidden = true; ta.focus() }

// ---- the footer: what's not on the server yet, which copy of the app is running, and a way out

var readOnly = false
function drawFoot(){
  var n = [...posts.values()].reduce((a, p) => a + waiting(p), 0)
  var words = {synced: n ? 'saving' : 'synced', offline: 'offline', signin: 'sign in to sync', starting: '…'}[status] || status
  if (n && status != 'synced') words += ' · ' + n + ' edit' + (n == 1 ? '' : 's') + ' on this device'
  if (readOnly) words = 'open in another tab (read only here)'
  $('state').textContent = words
  $('state').title = 'Tap to sync now'
  $('menu-btn').classList.toggle('alert', status != 'synced' && status != 'starting')
}
$('state').onclick = () => status == 'signin' ? save(cur).then(() => location.href = '/login') : syncAll()

function swVersion(){
  var c = navigator.serviceWorker && navigator.serviceWorker.controller
  if (!c) return Promise.resolve('no worker')
  return new Promise(ok => {
    var ch = new MessageChannel()
    ch.port1.onmessage = e => ok('app ' + e.data)
    c.postMessage('version', [ch.port2])
    setTimeout(() => ok('app ' + VERSION + '?'), 1000)
  })
}
// force update: drop the workers and this app's caches (never the posts), and load fresh
$('version').onclick = async () => {
  await saving
  var regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : []
  await Promise.all(regs.map(r => r.unregister()))
  var keys = await caches.keys()
  await Promise.all(keys.filter(k => k.startsWith('simple-log-')).map(k => caches.delete(k)))
  location.reload()
}

// ---- start

;(async () => {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/write/sw.js', {scope: '/write/'}).catch(console.error)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {})
  // one tab edits; another one only reads, so two tabs can't overwrite each other's queue
  if (navigator.locks) navigator.locks.request('simple-log-editor', {ifAvailable: true}, lock => {
    if (!lock){ readOnly = true; ta.readOnly = true; drawFoot(); return }
    return new Promise(() => {})   // held for as long as this tab is open
  })
  ;(await all('posts')).forEach(p => posts.set(p.id, p))
  var last = null
  try { last = localStorage.getItem('simple-log-open') } catch (e){}
  var first = posts.get(last) || [...posts.values()].sort((a, b) => b.edited - a.edited)[0]
  if (!first){ first = blank(newId()); posts.set(first.id, first) }
  show(first); showText(); ta.focus()
  drawFoot()
  swVersion().then(v => $('version').textContent = v)
  syncAll()
  setInterval(() => { if (document.visibilityState == 'visible') syncAll() }, 20000)
  addEventListener('online', syncAll)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState == 'visible') syncAll() })
})()
