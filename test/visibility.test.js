var test = require('node:test')
var assert = require('node:assert')
var {start} = require('./helpers')

var html = (s, p) => s.fetch(p).then(async r => ({status: r.status, text: await r.text(), type: r.headers.get('content-type')}))

test('private and public posts', async t => {
  var s = await start()
  t.after(s.stop)
  await s.login()
  var write = (id, text) => s.post('/api/posts/' + id, {base: 0, bid: 'b1', ops: [{t: Date.now(), pos: 0, del: '', ins: text}]})

  await write('secret000001', 'My secret diary\n\nNobody reads this.')
  await write('hello0000001', 'Hello <world> & friends\n\nA *public* post with [a link](https://example.com).\n\n<script>alert(1)</script>')

  await t.test('posts are private by default: not on /p/, the home page or the feed', async () => {
    assert.equal((await html(s, '/p/my-secret-diary')).status, 404)
    assert.equal((await html(s, '/p/secret000001')).status, 404)
    assert.doesNotMatch((await html(s, '/')).text, /secret/i)
    assert.doesNotMatch((await html(s, '/feed.xml')).text, /secret/i)
  })

  await t.test('made public, it gets a page, a line on the home page and a feed item', async () => {
    var r = await s.post('/api/posts/hello0000001/public', {public: true})
    assert.equal(r.status, 200)
    assert.equal(r.data.slug, 'hello-world-friends')
    var page = await html(s, '/p/hello-world-friends')
    assert.equal(page.status, 200)
    assert.match(page.type, /text\/html/)
    assert.match(page.text, /<h1>Hello &lt;world&gt; &amp; friends<\/h1>/)
    assert.match(page.text, /<em>public<\/em>/)
    assert.match(page.text, /<a href="https:\/\/example.com">a link<\/a>/)
    assert.doesNotMatch(page.text, /<script>/, 'what was typed can never become a tag')
    assert.match((await html(s, '/')).text, /href="\/p\/hello-world-friends"/)
    var feed = await html(s, '/feed.xml')
    assert.match(feed.text, /<link>https:\/\/log.example.com\/p\/hello-world-friends<\/link>/)
    assert.doesNotMatch(feed.text, /secret/i)
  })

  await t.test('edits to a public post show at once', async () => {
    var head = (await s.get('/api/posts/hello0000001')).data.head
    await s.post('/api/posts/hello0000001', {base: head, bid: 'b2', ops: [{t: Date.now(), pos: 0, del: '', ins: 'P.S. '}]})
    assert.match((await html(s, '/p/hello-world-friends')).text, /P.S. Hello/)
  })

  await t.test('made private again, it is gone from all three, and keeps its name for next time', async () => {
    await s.post('/api/posts/hello0000001/public', {public: false})
    assert.equal((await html(s, '/p/hello-world-friends')).status, 404)
    assert.doesNotMatch((await html(s, '/')).text, /hello/i)
    assert.doesNotMatch((await html(s, '/feed.xml')).text, /hello/i)
    var r = await s.post('/api/posts/hello0000001/public', {public: true})
    assert.equal(r.data.slug, 'hello-world-friends')
  })

  await t.test('two posts with one title get different names', async () => {
    await write('hello0000002', 'Hello world friends')
    assert.equal((await s.post('/api/posts/hello0000002/public', {public: true})).data.slug, 'hello-world-friends-2')
  })

  await t.test('the visibility is in the log, so it survives a restart', async () => {
    await s.post('/api/posts/hello0000002/public', {public: false})
    await s.restart()
    assert.equal((await html(s, '/p/hello-world-friends')).status, 200)
    assert.equal((await html(s, '/p/hello-world-friends-2')).status, 404)
    assert.equal((await html(s, '/p/my-secret-diary')).status, 404)
  })

  await t.test('the app pages and other paths', async () => {
    assert.equal((await html(s, '/write/')).status, 200)
    assert.match((await html(s, '/write/sw.js')).text, /var VERSION = '[0-9a-f]{8}'/)
    assert.equal((await html(s, '/write/../server.js')).status, 404)
    assert.equal((await html(s, '/write/config.json')).status, 404)
    assert.equal((await html(s, '/p/../config')).status, 404)
    assert.equal((await s.fetch('/health').then(r => r.json())).ok, true)
  })
})
