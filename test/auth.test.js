var test = require('node:test')
var assert = require('node:assert')
var {start, PASS} = require('./helpers')

test('auth', async t => {
  var s = await start()
  t.after(s.stop)

  await t.test('signed out, the api is closed', async () => {
    for (var p of ['/api/posts', '/api/posts/abcdefgh12', '/api/me']) assert.equal((await s.fetch(p)).status, 401)
    var r = await s.fetch('/api/posts/abcdefgh12', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({base: 0, bid: 'b1', ops: [{t: 1, pos: 0, del: '', ins: 'x'}]})})
    assert.equal(r.status, 401)
  })

  await t.test('a wrong passphrase gets no cookie', async () => {
    var r = await s.login('not it', '10.0.0.1')
    assert.equal(r.status, 401)
    assert.equal(r.setCookie, null)
  })

  await t.test('the right one gets an HttpOnly, Secure, SameSite=Lax cookie that opens the api', async () => {
    var r = await s.login(PASS, '10.0.0.2')
    assert.equal(r.status, 200)
    assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /Secure/); assert.match(r.setCookie, /SameSite=Lax/)
    assert.equal((await s.get('/api/me')).status, 200)
  })

  await t.test('a cookie changed by hand is refused', async () => {
    var good = s.cookie, [, exp, sig] = good.match(/session=(\d+)\.(.+)/)
    var forged = ['session=' + (+exp + 1e9) + '.' + sig, 'session=' + exp + '.' + sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA'),
      'session=' + exp + '.', 'session=' + (Date.now() - 1000) + '.' + sig, 'session=x']
    for (var c of forged) assert.equal((await s.fetch('/api/me', {headers: {Cookie: c}})).status, 401, c)
  })

  await t.test('writes must be JSON from this site', async () => {
    // what a form on another site could send
    var r = await s.fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'passphrase=' + encodeURIComponent(PASS)})
    assert.equal(r.status, 415)
    r = await s.fetch('/api/posts/abcdefgh12/public', {method: 'POST', headers: {Cookie: s.cookie, 'Content-Type': 'text/plain'}, body: '{"public":true}'})
    assert.equal(r.status, 415)
    r = await s.fetch('/api/posts/abcdefgh12/public', {method: 'POST', headers: {Cookie: s.cookie, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site'}, body: '{"public":true}'})
    assert.equal(r.status, 403)
  })

  await t.test('after 5 wrong tries from one address, even the right passphrase waits', async () => {
    for (var i = 0; i < 5; i++) assert.equal((await s.login('guess ' + i, '10.0.0.9')).status, 401)
    var r = await s.login(PASS, '10.0.0.9')
    assert.equal(r.status, 429)
    assert.equal(r.setCookie, null)
    assert.equal((await s.login(PASS, '10.0.0.10')).status, 200, 'another address is still fine')
  })

  await t.test('a burst of tries at once is limited too', async () => {
    var rs = await Promise.all(Array.from({length: 12}, (_, i) => s.login('burst ' + i, '10.0.0.20')))
    assert.equal(rs.filter(r => r.status == 401).length, 5)
    assert.equal(rs.filter(r => r.status == 429).length, 7)
  })

  await t.test('strangers guessing from many addresses cannot lock the owner out', async () => {
    for (var n = 30; n < 34; n++) for (var i = 0; i < 5; i++) assert.equal((await s.login('guess ' + i, '10.0.0.' + n)).status, 401)
    assert.equal((await s.login(PASS, '10.0.0.40')).status, 200)
  })

  await t.test('one IPv6 /64 counts as one address', async () => {
    for (var i = 0; i < 5; i++) assert.equal((await s.login('guess', '2001:db8:1:2::' + (i + 1).toString(16))).status, 401)
    assert.equal((await s.login(PASS, '2001:db8:1:2:ffff::9')).status, 429)
    assert.equal((await s.login(PASS, '2001:db8:1:3::1')).status, 200)
  })

  await t.test('bodies that are not a JSON object get a 400, and the server stays up', async () => {
    for (var bad of ['null', '[]', '1', '"x"', 'true']){
      var r = await s.fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: bad})
      assert.equal(r.status, 400, bad)
      r = await s.fetch('/api/posts/abcdefgh12', {method: 'POST', headers: {Cookie: s.cookie, 'Content-Type': 'application/json'}, body: bad})
      assert.equal(r.status, 400, bad)
      r = await s.fetch('/api/posts/abcdefgh12/public', {method: 'POST', headers: {Cookie: s.cookie, 'Content-Type': 'application/json'}, body: bad})
      assert.equal(r.status, 400, bad)
    }
    assert.equal((await s.fetch('/health')).status, 200)
  })

  await t.test('a big body to the login is refused early', async () => {
    var r = await s.fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({passphrase: 'x'.repeat(100000)})})
    assert.equal(r.status, 413)
    assert.equal((await s.fetch('/health')).status, 200)
  })

  await t.test('no signing in over plain http', async () => {
    var r = await s.fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Forwarded-Proto': 'http', 'X-Real-IP': '10.0.0.50'}, body: JSON.stringify({passphrase: PASS})})
    assert.equal(r.status, 400)
    assert.equal(r.headers.get('set-cookie'), null)
  })

  await t.test('the public health check says nothing about how many posts there are', async () => {
    var d = await (await s.fetch('/health')).json()
    assert.equal(d.ok, true); assert.ok(!('posts' in d))
  })

  await t.test('signing out clears the cookie', async () => {
    var r = await s.fetch('/api/logout', {method: 'POST', headers: {Cookie: s.cookie, 'Content-Type': 'application/json'}, body: '{}'})
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/)
  })
})
