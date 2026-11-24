// One post on this device, and how it catches up with the server. Shared by the browser
// (window.sync) and the tests. A post's state:
//
//   {id, head, text, fly, pend}
//   head  the last batch (seq) this device has from the server
//   text  the server's text at head
//   fly   the batch sent and not yet answered: {bid, ops}, or null
//   pend  ops typed since
//
// What's on screen is always local(state): the server's text plus everything not yet sent.
;(function(exports){
  var ot = typeof require == 'function' ? require('./ot') : window.ot

  // an op that doesn't fit (it never should) is skipped rather than breaking the page
  var local = s => (s.fly ? s.fly.ops : []).concat(s.pend).reduce((t, o) => { try { return ot.apply(t, o) } catch (e){ return t } }, s.text)
  var rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36)

  // -> the body to POST, moving pend into fly. A batch already in flight goes again as it is
  // (same bid), so if the first answer got lost the server can tell it already has it.
  function outgoing(s){
    if (!s.fly && s.pend.length){ s.fly = {bid: rid(), ops: s.pend}; s.pend = [] }
    return s.fly && {base: s.head, bid: s.fly.bid, ops: s.fly.ops}
  }

  // the server took it (200 {head})
  function ack(s, head){
    s.text = ot.applyAll(s.text, s.fly.ops)
    s.head = head
    s.fly = null
  }

  // batches the device hadn't seen (a 409, or a poll), in order. Ours (same bid) means the
  // server had it all along. Theirs: our unsent ops are moved to apply after them. After a
  // 409 what was in flight goes back to the front of pend, to be sent again on the new head.
  function absorb(s, batches){
    batches.forEach(b => {
      if (b.seq <= s.head) return
      s.text = ot.applyAll(s.text, b.ops)
      s.head = b.seq
      if (s.fly && b.bid == s.fly.bid){ s.fly = null; return }
      var theirs = b.ops
      if (s.fly){ var r = ot.transform(s.fly.ops, theirs, false); s.fly.ops = r[0]; theirs = r[1] }
      s.pend = ot.transform(s.pend, theirs, false)[0]
    })
    if (s.fly){ s.pend = s.fly.ops.concat(s.pend); s.fly = null }
  }

  // when nothing else works (the server refused a batch, or has less than we thought): start
  // from the server's text and put back everything on screen as one edit. Never loses text.
  function reset(s, text, head, mine){
    var op = ot.diff(text, mine)
    s.text = text; s.head = head; s.fly = null; s.pend = op ? [op] : []
  }

  Object.assign(exports, {local, outgoing, ack, absorb, reset, rid})
})(typeof module == 'object' ? module.exports : (window.sync = {}))
