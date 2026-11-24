var test = require('node:test')
var assert = require('node:assert')
var ot = require('../public/ot')

test('apply and diff', () => {
  assert.equal(ot.apply('hello', {t: 1, pos: 5, del: '', ins: '!'}), 'hello!')
  assert.throws(() => ot.apply('hello', {t: 1, pos: 0, del: 'x', ins: ''}))
  var op = ot.diff('aa', 'aaa', 1)   // the caret says the first a was typed
  assert.deepEqual([op.pos, op.del, op.ins], [0, '', 'a'])
  assert.equal(ot.diff('same', 'same'), null)
  // an emoji is never cut in half
  var e = ot.diff('x😀', 'x😃')
  assert.equal(e.del, '😀'); assert.equal(e.ins, '😃')
})

function randomOps(text, n, seed){
  var ops = [], rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (var i = 0; i < n; i++){
    var pos = Math.floor(rnd() * (text.length + 1)), len = Math.floor(rnd() * Math.min(4, text.length - pos + 1))
    var op = {t: i, pos, del: text.slice(pos, pos + len), ins: rnd() < 0.6 ? 'xyz'.slice(0, 1 + Math.floor(rnd() * 3)) + i : ''}
    if (!op.del && !op.ins) continue
    ops.push(op); text = ot.apply(text, op)
  }
  return ops
}

test('two sides editing the same text end up with the same text', () => {
  for (var seed = 1; seed < 400; seed++){
    var base = 'the quick brown fox'
    var xs = randomOps(base, 1 + seed % 6, seed), ys = randomOps(base, 1 + seed % 5, seed * 7 + 3)
    var [x2, y2] = ot.transform(xs, ys, false)
    var a = ot.applyAll(ot.applyAll(base, ys), x2), b = ot.applyAll(ot.applyAll(base, xs), y2)
    assert.equal(a, b, 'seed ' + seed)
  }
})

test('text typed on one side is never lost to the other side\'s deletes', () => {
  for (var seed = 1; seed < 400; seed++){
    var base = 'the quick brown fox'
    var xs = randomOps(base, 1 + seed % 6, seed), ys = randomOps(base, 1 + seed % 5, seed * 7 + 3).filter((o, i) => i == 0)
    ys = ys.filter(o => o.ins).map(o => Object.assign({}, o, {del: ''}))
    var a = ot.applyAll(ot.applyAll(base, xs), ot.transform(ys, xs, false)[0])
    ys.forEach(o => assert.ok(a.includes(o.ins), 'lost ' + o.ins + ' at seed ' + seed))
  }
})

test('mapPos moves a caret past text inserted before it', () => {
  assert.equal(ot.mapPos(3, [{t: 0, pos: 0, del: '', ins: 'ab'}]), 5)
  assert.equal(ot.mapPos(3, [{t: 0, pos: 5, del: '', ins: 'ab'}]), 3)
  assert.equal(ot.mapPos(5, [{t: 0, pos: 1, del: 'abc', ins: ''}]), 2)
})
