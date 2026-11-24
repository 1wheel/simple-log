// One owner, one passphrase. data/config.json keeps only its scrypt hash; a correct
// passphrase gets a signed cookie, good for 90 days:
//
//   session=<expires ms>.<HMAC-SHA256 of it, keyed by config.secret>
//
// HttpOnly (page scripts can't read it), Secure (https only; browsers allow it on localhost),
// SameSite=Lax (not sent on another site's POSTs). A new passphrase makes a new secret, which
// signs everyone out.

var crypto = require('crypto')

var DAYS = 90
var SCRYPT = {N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024}

function hash(passphrase){
  var salt = crypto.randomBytes(16)
  var key = crypto.scryptSync(passphrase, salt, 32, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$')
}

function check(passphrase, stored, cb){
  var [kind, N, r, p, salt, key] = String(stored).split('$')
  if (kind != 'scrypt') return cb(false)
  key = Buffer.from(key, 'base64')
  crypto.scrypt(String(passphrase), Buffer.from(salt, 'base64'), key.length, {N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem},
    (err, got) => cb(!err && crypto.timingSafeEqual(got, key)))
}

var sign = (exp, secret) => crypto.createHmac('sha256', secret).update('session.' + exp).digest('base64url')

function signedIn(req, config){
  var m = (req.headers.cookie || '').match(/(?:^|;\s*)session=(\d+)\.([\w-]+)/)
  if (!m || +m[1] < Date.now()) return false
  var want = Buffer.from(sign(m[1], config.secret)), got = Buffer.from(m[2])
  return got.length == want.length && crypto.timingSafeEqual(got, want)
}

function cookie(config){
  var exp = Date.now() + DAYS * 864e5
  return 'session=' + exp + '.' + sign(exp, config.secret) + '; Path=/; Max-Age=' + DAYS * 86400 + '; HttpOnly; Secure; SameSite=Lax'
}
var clearCookie = () => 'session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax'

// Wrong guesses: 5 per address per 15 minutes. While limited, even the right passphrase is
// refused from that address, so guessing learns nothing. There's no limit across all addresses:
// that would let a stranger lock the owner out, and scrypt plus 12+ characters already makes
// guessing hopeless.
var WINDOW = 15 * 60 * 1000, PER_IP = 5
var fails = []   // [time, ip]

function ipOf(req){
  var direct = req.socket.remoteAddress || ''
  // behind nginx (on this machine) the real address is in X-Real-IP
  var ip = (/^(127\.|::1$|::ffff:127\.)/.test(direct) && req.headers['x-real-ip'] || direct).replace(/^::ffff:/, '')
  // one IPv6 host has a whole /64 to hop around in, so that's the "address"
  if (!ip.includes(':')) return ip
  var [head, tail] = ip.split('::'), h = head ? head.split(':') : [], t = tail ? tail.split(':') : []
  if (tail != null) h = h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill('0'), t)
  return h.slice(0, 4).map(x => parseInt(x, 16) || 0).join(':')
}

function login(req, res, data, config, send){
  var now = Date.now(), ip = ipOf(req)
  fails = fails.filter(f => f[0] > now - WINDOW)
  if (fails.filter(f => f[1] == ip).length >= PER_IP)
    return send(res, 429, {error: 'too many tries; wait 15 minutes'}, null, {'Retry-After': '900'})
  if (typeof data.passphrase != 'string' || !data.passphrase || data.passphrase.length > 1000) return send(res, 400, {error: 'passphrase?'})
  // counted as wrong until it's checked, so a burst of tries at once can't slip past the limit
  var attempt = [now, ip]
  fails.push(attempt)
  check(data.passphrase, config.hash, ok => {
    if (!ok) return send(res, 401, {error: 'wrong passphrase'})
    fails = fails.filter(f => f != attempt)
    send(res, 200, {ok: true}, null, {'Set-Cookie': cookie(config)})
  })
}

module.exports = {hash, check, signedIn, login, clearCookie}
