// Starts a real server on a free port with its own empty data folder.
var {spawn} = require('child_process')
var fs = require('fs')
var os = require('os')
var path = require('path')
var crypto = require('crypto')
var auth = require('../lib/auth')

var PASS = 'correct horse battery staple'

async function start(dir){
  var fresh = !dir
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'simple-log-test-'))
  if (fresh) fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({title: 'Test log', url: 'https://log.example.com', hash: auth.hash(PASS), secret: crypto.randomBytes(32).toString('hex')}))
  var port = 20000 + Math.floor(Math.random() * 20000)
  var child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {env: Object.assign({}, process.env, {PORT: port, DATA_DIR: dir}), stdio: ['ignore', 'pipe', 'inherit']})
  await new Promise((ok, fail) => { child.stdout.once('data', ok); child.once('exit', fail) })
  var base = 'http://127.0.0.1:' + port
  var s = {dir, base, child, cookie: '',
    stop: () => { s.child.kill(); fs.rmSync(dir, {recursive: true, force: true}) },
    // the same data folder, a new process
    restart: async () => {
      await new Promise(ok => { s.child.once("exit", ok); s.child.kill() })
      var t = await start(dir)
      Object.assign(s, {child: t.child, base: t.base, fetch: t.fetch, get: t.get, post: t.post})
      t.cookie = s.cookie
    },
    fetch: (p, opts) => fetch(base + p, opts),
    // as the signed-in owner
    get: p => fetch(base + p, {headers: {Cookie: s.cookie}}).then(async r => ({status: r.status, data: await r.json().catch(() => null)})),
    post: (p, data) => fetch(base + p, {method: 'POST', headers: {Cookie: s.cookie, 'Content-Type': 'application/json'}, body: JSON.stringify(data)})
      .then(async r => ({status: r.status, data: await r.json().catch(() => null)})),
    login: async (pass, ip) => {
      var r = await fetch(base + '/api/login', {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, ip ? {'X-Real-IP': ip} : {}), body: JSON.stringify({passphrase: pass || PASS})})
      var c = r.headers.get('set-cookie')
      if (r.status == 200) s.cookie = c.split(';')[0]
      return {status: r.status, setCookie: c}
    },
  }
  return s
}

module.exports = {start, PASS}
