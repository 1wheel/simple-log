// Two devices writing the same post against a real server.
var test = require('node:test')
var assert = require('node:assert')
var ot = require('../public/ot')
var sync = require('../public/sync')
var {start} = require('./helpers')

var device = id => ({id, head: 0, text: '', fly: null, pend: []})
var type = (d, pos, ins) => d.pend.push({t: Date.now(), pos, del: '', ins})
var send = (s, d, body) => s.post('/api/posts/' + d.id, body || sync.outgoing(d))

// what the app does: send, and on a 409 take in what was missed and go again
async function push(s, d){
  for (var i = 0; i < 5; i++){
    var body = sync.outgoing(d)
    if (!body) return
    var r = await send(s, d, body)
    if (r.status == 200) sync.ack(d, r.data.head)
    else if (r.status == 409 && r.data.reset) sync.reset(d, r.data.text, r.data.head, sync.local(d))
    else if (r.status == 409) sync.absorb(d, r.data.batches)
    else if (r.status == 422) sync.reset(d, r.data.text, r.data.head, sync.local(d))
    else throw new Error('status ' + r.status)
  }
}
async function pull(s, d){
  var r = await s.get('/api/posts/' + d.id + '/batches?since=' + d.head)
  sync.absorb(d, r.data.batches)
}

test('sync', async t => {
  var s = await start()
  t.after(s.stop)
  await s.login()

  await t.test('a batch on the head is appended', async () => {
    var a = device('post00000001')
    type(a, 0, 'Hello')
    await push(s, a)
    assert.equal(a.head, 1)
    assert.deepEqual((await s.get('/api/posts/post00000001')).data, {head: 1, text: 'Hello', public: false, slug: ''})
  })

  await t.test('409: a device that was offline rebases onto what it missed', async () => {
    var a = device('post00000002'), b = device('post00000002')
    type(a, 0, 'one two'); await push(s, a)
    await pull(s, b)
    // both type at once; b is offline
    type(a, 7, ' three'); await push(s, a)
    type(b, 0, 'zero ')
    var r = await send(s, b)
    assert.equal(r.status, 409)
    assert.equal(r.data.batches.length, 1)
    sync.absorb(b, r.data.batches)
    await push(s, b)
    await pull(s, a)
    var server = (await s.get('/api/posts/post00000002')).data.text
    assert.equal(server, 'zero one two three')
    assert.equal(sync.local(a), server)
    assert.equal(sync.local(b), server)
  })

  await t.test('an answer lost on the way back: the same batch again is not appended twice', async () => {
    var a = device('post00000003')
    type(a, 0, 'abc')
    var body = sync.outgoing(a)
    assert.equal((await send(s, a, body)).status, 200)   // ...but pretend the answer never came
    type(a, 3, 'def')
    await push(s, a)
    assert.equal((await s.get('/api/posts/post00000003')).data.text, 'abcdef')
    assert.equal(sync.local(a), 'abcdef')
  })

  await t.test('422: ops that do not fit are refused, nothing is written, and the device starts over without losing text', async () => {
    var a = device('post00000004')
    type(a, 0, 'kept'); await push(s, a)
    a.pend.push({t: Date.now(), pos: 0, del: 'nope', ins: ''})
    var r = await send(s, a)
    assert.equal(r.status, 422)
    assert.equal((await s.get('/api/posts/post00000004')).data.head, 1)
    sync.reset(a, r.data.text, r.data.head, sync.local(a))
    assert.deepEqual(a.pend, [])
    assert.equal(sync.local(a), 'kept')
  })

  await t.test('a device ahead of the server (restored from an old backup) resets onto it', async () => {
    var a = device('post00000005')
    a.head = 7; a.text = 'from before'
    type(a, 11, ' and after')
    await push(s, a)
    assert.equal((await s.get('/api/posts/post00000005')).data.text, 'from before and after')
  })

  await t.test('bad batches are 400s', async () => {
    var bad = [{base: 0, bid: 'b1', ops: []}, {base: 0, bid: 'b1', ops: [{t: 1, pos: -1, del: '', ins: 'x'}]},
      {base: 0, bid: 'b1', ops: [{t: 1, pos: 0, del: '', ins: '', meta: {public: true}}]}, {base: 'x', bid: 'b1', ops: [{t: 1, pos: 0, del: '', ins: 'x'}]}]
    for (var b of bad) assert.equal((await s.post('/api/posts/post00000006', b)).status, 400)
  })

  await t.test('the log on disk is one line per batch, and a restart reads it back, torn lines and all', async () => {
    var fs = require('fs'), path = require('path')
    var lines = fs.readFileSync(path.join(s.dir, 'posts', 'post00000002.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
    assert.deepEqual(lines.map(l => l.seq), [1, 2, 3])
    assert.equal(ot.applyAll('', lines.flatMap(l => l.ops)), 'zero one two three')
    // a crash mid-write leaves half a line: skipped, and the next batch starts on a fresh line
    fs.appendFileSync(path.join(s.dir, 'posts', 'post00000002.jsonl'), '{"seq":4,"at":1,"bid":"torn","ops":[{"t"')
    await s.restart()
    var r = await s.get('/api/posts/post00000002')
    assert.deepEqual([r.data.head, r.data.text], [3, 'zero one two three'])
    assert.equal((await s.post('/api/posts/post00000002', {base: 3, bid: 'after', ops: [{t: 1, pos: 18, del: '', ins: '.'}]})).status, 200)
    await s.restart()
    assert.equal((await s.get('/api/posts/post00000002')).data.text, 'zero one two three.')
  })
})
