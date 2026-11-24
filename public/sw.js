// Keeps the app's own files on the device so it opens with no connection. Posts aren't here
// (they're in IndexedDB), and /api/ and /media/ always go to the network.
// The server stamps VERSION with a hash of the app's files: change any file and phones pick up
// the new copy in the background, and use it from the next launch.
var VERSION = '__VERSION__'
var CACHE = 'simple-log-' + VERSION
var SHELL = ['/write/', '/write/app.js', '/write/app.css', '/write/ot.js', '/write/sync.js', '/write/manifest.json', '/write/manifest-eink.json', '/write/icon-192.png', '/write/icon-512.png']

// every fetch gets a deadline, so a dead connection can't hang the install
function get(url){
  var ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000)
  return fetch(url, {cache: 'no-store', signal: ctl.signal}).finally(() => clearTimeout(timer))
}

self.addEventListener('install', e => {
  // all of the files or none: a half-fetched copy never replaces a whole one
  e.waitUntil(Promise.all(SHELL.map(u => get(u).then(r => { if (!r.ok || r.redirected) throw new Error(u + ' ' + r.status); return [u, r] })))
    .then(got => caches.open(CACHE).then(c => Promise.all(got.map(([u, r]) => c.put(u, r)))))
    .then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('simple-log-') && k != CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

// answered from the cache without waiting on the network; anything else is left alone
self.addEventListener('fetch', e => {
  var u = new URL(e.request.url)
  if (e.request.method != 'GET' || u.origin != location.origin) return
  var key = e.request.mode == 'navigate' && u.pathname.startsWith('/write') ? '/write/' : u.pathname
  if (!SHELL.includes(key)) return
  e.respondWith(caches.open(CACHE).then(c => c.match(key)).then(hit => hit || get(e.request.url)))
})

// the footer asks which copy is running
self.addEventListener('message', e => {
  if (e.data == 'version' && e.ports[0]) e.ports[0].postMessage(VERSION)
})
