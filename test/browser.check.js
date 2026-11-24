// The app in a real (headless) browser: sign in, write, lose the connection, keep writing
// (and reload, from the service worker), come back, sync, publish, replay, add a picture.
// Needs Playwright:  NODE_PATH=<where playwright is> node test/browser.check.js
// Screenshots go to docs/.
var test = require('node:test')
var assert = require('node:assert')
var path = require('path')
var {start, PASS} = require('./helpers')

var playwright
try { playwright = require('playwright') } catch (e){}

test('offline typing, then sync, in a browser', {skip: !playwright && 'playwright is not installed'}, async t => {
  var s = await start()
  var browser = await playwright.chromium.launch()
  t.after(async () => { await browser.close(); s.stop() })
  var ctx = await browser.newContext({viewport: {width: 420, height: 800}, deviceScaleFactor: 2})
  var page = await ctx.newPage()
  var errors = []
  page.on('pageerror', e => errors.push(e.message))
  var foot = () => page.textContent('#state')
  var server = async () => {
    var list = await s.get('/api/posts')
    return Promise.all(list.data.map(p => s.get('/api/posts/' + p.id).then(r => r.data.text)))
  }
  var until = async (fn, what) => { for (var i = 0; i < 100; i++){ if (await fn()) return; await page.waitForTimeout(100) } throw new Error('waited for ' + what) }

  await page.goto(s.base + '/login')
  await page.fill('#pass', 'wrong one here')
  await page.click('button')
  await until(async () => /wrong/.test(await page.textContent('#msg')), 'the wrong passphrase message')
  await page.fill('#pass', PASS)
  await page.click('button')
  await page.waitForURL(/\/write\/$/)
  s.cookie = (await ctx.cookies()).map(c => c.name + '=' + c.value).join('; ')

  await page.click('#text')
  await page.keyboard.type('A walk in the rain\n\nIt started before we left.')
  await until(async () => (await foot()) == 'synced', 'synced')
  assert.deepEqual(await server(), ['A walk in the rain\n\nIt started before we left.'])
  await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), 'the service worker')

  await t.test('offline: typing goes on, and survives a reload', async () => {
    await ctx.setOffline(true)
    await page.keyboard.type(' We got soaked.')
    await page.click('#state')   // try now: it can't
    await until(async () => /offline/.test(await foot()), 'offline in the footer')
    await page.reload()          // from the service worker, with no network
    await page.waitForSelector('#text')
    assert.equal(await page.inputValue('#text'), 'A walk in the rain\n\nIt started before we left. We got soaked.')
    await page.click('#text')
    await page.keyboard.press('End')
    await page.keyboard.type(' Worth it.')
    await until(async () => /offline · \d+ edits on this device/.test(await foot()), 'the waiting count')
    await page.screenshot({path: path.join(__dirname, '..', 'docs', 'offline.png')})
    assert.deepEqual(await server(), ['A walk in the rain\n\nIt started before we left.'], 'nothing reached the server')
  })

  await t.test('meanwhile the post changes on the server; back online, the two merge', async () => {
    var id = (await s.get('/api/posts')).data[0].id, head = (await s.get('/api/posts/' + id)).data.head
    assert.equal((await s.post('/api/posts/' + id, {base: head, bid: 'otherdevice', ops: [{t: Date.now(), pos: 0, del: '', ins: 'Sunday. '}]})).status, 200)
    await ctx.setOffline(false)
    await page.click('#state')
    await until(async () => (await foot()) == 'synced', 'synced again')
    var want = 'Sunday. A walk in the rain\n\nIt started before we left. We got soaked. Worth it.'
    assert.deepEqual(await server(), [want])
    await until(async () => (await page.inputValue('#text')) == want, 'the other device\'s edit on screen')
  })

  await t.test('make it public and read it at /p/', async () => {
    await page.click('#menu-btn')
    await page.check('#public')
    await until(async () => /\/p\//.test(await page.textContent('#public-link')), 'the link')
    await page.screenshot({path: path.join(__dirname, '..', 'docs', 'menu.png')})
    var href = await page.getAttribute('#public-link', 'href')
    assert.equal(href, '/p/sunday-a-walk-in-the-rain')
    var pub = await ctx.newPage()
    var r = await pub.goto(s.base + href)
    assert.equal(r.status(), 200)
    assert.equal(await pub.textContent('h1'), 'Sunday. A walk in the rain')
    await pub.screenshot({path: path.join(__dirname, '..', 'docs', 'public.png')})
    await pub.goto(s.base + '/')
    assert.match(await pub.textContent('main'), /Sunday. A walk in the rain/)
    await pub.close()
  })

  await t.test('replay plays it back', async () => {
    await page.click('#replay-btn')
    await page.waitForSelector('#replay:not([hidden])')
    await page.click('#speed'); await page.click('#speed')   // 64x
    await until(async () => (await page.textContent('#play')) == 'Again', 'the end of the replay')
    assert.equal(await page.textContent('#replay-text'), 'Sunday. A walk in the rain\n\nIt started before we left. We got soaked. Worth it.')
    await page.fill('#scrub', '10')
    await page.dispatchEvent('#scrub', 'input')
    assert.equal(await page.textContent('#replay-text'), 'A walk in ')
    await page.screenshot({path: path.join(__dirname, '..', 'docs', 'replay.png')})
    await page.click('#close-replay')
  })

  await t.test('add a picture: three sizes, uploaded, shown on the public page', async () => {
    var shot = await page.screenshot({type: 'jpeg'})   // 840x1600: big enough for 640 and 1280
    await page.click('#menu-btn')
    await page.setInputFiles('#file', {name: 'photo.jpg', mimeType: 'image/jpeg', buffer: shot})
    await until(async () => /!\[\]\(\/media\/[0-9a-z]+-1280\.jpg\)/.test(await page.inputValue('#text')), 'the picture in the text')
    await until(async () => (await foot()) == 'synced', 'synced')
    var url = (await page.inputValue('#text')).match(/\/media\/[0-9a-z]+-1280\.jpg/)[0]
    var img = await s.fetch(url)
    assert.equal(img.status, 200)
    assert.equal((await s.fetch(url.replace('1280', '640'))).status, 200)
    assert.equal((await s.fetch(url.replace('1280', '2400'))).status, 404, 'the picture is too small for 2400')
    var html = await (await s.fetch('/p/sunday-a-walk-in-the-rain')).text()
    assert.match(html, /<img src="\/media\/[0-9a-z]+-1280\.jpg"[^>]*srcset="[^"]*640w, [^"]*1280w"/)
    var pub = await ctx.newPage()
    await pub.goto(s.base + '/p/sunday-a-walk-in-the-rain')
    await until(() => pub.evaluate(() => document.images[0].complete && document.images[0].naturalWidth > 0), 'the picture to load')
    await pub.screenshot({path: path.join(__dirname, '..', 'docs', 'public.png')})
    await pub.close()
  })

  await t.test('the footer names the running version', async () => {
    assert.match(await page.textContent('#version'), /^app [0-9a-f]{8}$/)
    assert.deepEqual(errors, [])
  })
})
