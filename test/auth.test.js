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

  await t.test('signing out clears the cookie', async () => {
    var r = await s.fetch('/api/logout', {method: 'POST', headers: {Cookie: s.cookie, 'Content-Type': 'application/json'}, body: '{}'})
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/)
  })
})
