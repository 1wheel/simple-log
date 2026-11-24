// Edit ops, shared by the browser (window.ot) and node (require).
// An op is {t, pos, del, ins}: at pos, the text del is replaced by ins. t is when (ms).
;(function(exports){

  function apply(text, op){
    if (text.substr(op.pos, op.del.length) != op.del) throw new Error('op does not fit the text at ' + op.pos)
    return text.slice(0, op.pos) + op.ins + text.slice(op.pos + op.del.length)
  }
  var applyAll = (text, ops) => ops.reduce(apply, text)

  // the one op that turns a into b. cursor (the caret in b) picks which copy of a repeated
  // letter was typed, so a replay shows it where it happened
  function diff(a, b, cursor, t){
    if (a == b) return null
    var max = Math.min(a.length, b.length)
    var sufMax = cursor == null ? max : Math.max(0, Math.min(max, b.length - cursor))
    var s = 0
    while (s < sufMax && a[a.length - 1 - s] == b[b.length - 1 - s]) s++
    var p = 0
    while (p < max - s && a[p] == b[p]) p++
    // never cut an emoji (a surrogate pair) in half
    var hi = i => /[\ud800-\udbff]/.test(a[i] || '')
    if (p > 0 && hi(p - 1)) p--
    while (s > 0 && /[\udc00-\udfff]/.test(a[a.length - s] || '')) s--
    return {t: t || Date.now(), pos: p, del: a.slice(p, a.length - s), ins: b.slice(p, b.length - s)}
  }

  // a replace is a delete then an insert at the same spot; empty ops (meta) drop out
  function split(ops){
    var out = []
    ops.forEach(o => {
      if (o.del) out.push({t: o.t, pos: o.pos, del: o.del, ins: ''})
      if (o.ins) out.push({t: o.t, pos: o.pos, del: '', ins: o.ins})
    })
    return out
  }

  // a (one delete or one insert) moved to apply after b; both were made on the same text.
  // aFirst settles two inserts at one spot. Typed text is never dropped.
  function xf(a, b, aFirst){
    var at = pos => [Object.assign({}, a, {pos})]
    var bEnd = b.pos + b.del.length
    if (a.ins){
      if (b.ins) return a.pos < b.pos || (a.pos == b.pos && aFirst) ? [a] : at(a.pos + b.ins.length)
      return a.pos <= b.pos ? [a] : a.pos >= bEnd ? at(a.pos - b.del.length) : at(b.pos)
    }
    var aEnd = a.pos + a.del.length
    if (b.ins){
      if (b.pos <= a.pos) return at(a.pos + b.ins.length)
      if (b.pos >= aEnd) return [a]
      var k = b.pos - a.pos   // b typed inside what a deletes: delete around it
      return [{t: a.t, pos: a.pos, del: a.del.slice(0, k), ins: ''},
              {t: a.t, pos: a.pos + b.ins.length, del: a.del.slice(k), ins: ''}]
    }
    // two deletes: a keeps only what b didn't already delete
    var keep = a.del.slice(0, Math.max(0, Math.min(a.del.length, b.pos - a.pos)))
      + a.del.slice(Math.min(a.del.length, Math.max(0, bEnd - a.pos)))
    var pos = a.pos <= b.pos ? a.pos : a.pos >= bEnd ? a.pos - b.del.length : b.pos
    return keep ? [{t: a.t, pos, del: keep, ins: ''}] : []
  }

  // xs and ys start from the same text. -> [xs after ys, ys after xs]
  function transform(xs, ys, xFirst){
    xs = split(xs); ys = split(ys)
    if (!xs.length || !ys.length) return [xs, ys]
    if (xs.length == 1 && ys.length == 1) return [xf(xs[0], ys[0], xFirst), xf(ys[0], xs[0], !xFirst)]
    if (xs.length > 1){
      var [x0, y1] = transform(xs.slice(0, 1), ys, xFirst)
      var [xr, y2] = transform(xs.slice(1), y1, xFirst)
      return [x0.concat(xr), y2]
    }
    var [x1, y0] = transform(xs, ys.slice(0, 1), xFirst)
    var [x2, yr] = transform(x1, ys.slice(1), xFirst)
    return [x2, y0.concat(yr)]
  }

  // where a caret at pos ends up after ops
  function mapPos(pos, ops){
    split(ops).forEach(o => {
      if (o.ins){ if (o.pos < pos) pos += o.ins.length }
      else if (o.pos < pos) pos -= Math.min(o.del.length, pos - o.pos)
    })
    return pos
  }

  Object.assign(exports, {apply, applyAll, diff, split, xf, transform, mapPos})
})(typeof module == 'object' ? module.exports : (window.ot = {}))
