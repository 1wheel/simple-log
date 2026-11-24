// The public pages: plain HTML, no scripts. The text is written in a little markdown:
//
//   the first line           the title
//   # / ## heading           a heading
//   - item                   a list
//   > quote                  a quote
//   **bold** *italic*        bold, italic
//   [words](https://..)      a link
//   ![words](/media/..jpg)   a picture (with its other sizes, for phones and big screens)
//   a blank line             a new paragraph

var fs = require('fs')
var path = require('path')

var esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
var lines = text => text.split('\n')
var title = text => (lines(text).map(l => l.trim()).find(l => l) || 'Untitled').replace(/^#+\s*/, '').slice(0, 120)
var body = text => { var ls = lines(text), i = ls.findIndex(l => l.trim()); return i < 0 ? '' : ls.slice(i + 1).join('\n') }
var day = ms => new Date(ms).toISOString().slice(0, 10)

function picture(alt, url, mediaDir){
  var m = url.match(/^\/media\/([0-9a-z]{20,40})-(\d+)\.jpg$/)
  if (!m) return '<img src="' + url + '" alt="' + alt + '">'
  var sizes = [640, 1280, 2400].filter(s => fs.existsSync(path.join(mediaDir, m[1] + '-' + s + '.jpg')))
  var set = sizes.map(s => '/media/' + m[1] + '-' + s + '.jpg ' + s + 'w').join(', ')
  return '<img src="' + url + '" alt="' + alt + '" loading="lazy"' + (set ? ' srcset="' + set + '" sizes="(max-width: 42rem) 100vw, 42rem"' : '') + '>'
}

// on text already escaped, so nothing in it can make a tag; urls must be https?:// or /media/
function inline(s, mediaDir){
  return s
    .replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/media\/)[^\s)]+)\)/g, (_, alt, url) => picture(alt, url, mediaDir))
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>')
}

function html(text, mediaDir){
  return body(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
    var e = esc(b), ls = e.split('\n'), m
    if ((m = e.match(/^(#{1,3})\s+(.*)$/))) return '<h' + (m[1].length + 1) + '>' + inline(m[2], mediaDir) + '</h' + (m[1].length + 1) + '>'
    if (ls.every(l => /^[-*] /.test(l))) return '<ul>' + ls.map(l => '<li>' + inline(l.slice(2), mediaDir) + '</li>').join('') + '</ul>'
    if (ls.every(l => /^&gt; ?/.test(l))) return '<blockquote><p>' + ls.map(l => inline(l.replace(/^&gt; ?/, ''), mediaDir)).join('<br>') + '</p></blockquote>'
    return '<p>' + ls.map(l => inline(l, mediaDir)).join('<br>') + '</p>'
  }).join('\n')
}

var STYLE = `<style>
:root{--fg:#111;--bg:#fff;--muted:#666}
@media (prefers-color-scheme: dark){:root{--fg:#e8e8e8;--bg:#111;--muted:#999}}
body{margin:0;background:var(--bg);color:var(--fg);font:19px/1.6 Georgia,serif}
main{max-width:42rem;margin:0 auto;padding:2rem 1rem 4rem}
a{color:inherit}header,time,footer,.list span{font:14px system-ui,sans-serif;color:var(--muted)}
header a{text-decoration:none}h1{font-size:1.7em;line-height:1.2;margin:1.5rem 0 .3rem}
img{max-width:100%;height:auto;display:block;margin:1.5rem 0}blockquote{margin:0;padding-left:1em;border-left:2px solid var(--muted)}
.list{list-style:none;padding:0}.list li{margin:.6rem 0}.list span{margin-left:.6em}
</style>`

function shell(t, config, inner){
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(t) + '</title><link rel="alternate" type="application/rss+xml" href="/feed.xml">' + STYLE + '</head>'
    + '<body><main><header><a href="/">' + esc(config.title) + '</a></header>' + inner
    + '<footer><p><a href="/feed.xml">RSS</a></p></footer></main></body></html>\n'
}

var page = (p, config, mediaDir) => shell(title(p.text), config,
  '<article><h1>' + esc(title(p.text)) + '</h1><time>' + day(p.published) + '</time>\n' + html(p.text, mediaDir) + '</article>')

var home = (pub, config) => shell(config.title, config, pub.length
  ? '<ul class="list">' + pub.map(p => '<li><a href="/p/' + p.slug + '">' + esc(title(p.text)) + '</a><span>' + day(p.published) + '</span></li>').join('') + '</ul>'
  : '<p>Nothing here yet.</p>')

var feed = (pub, config, mediaDir) => '<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0"><channel>'
  + '<title>' + esc(config.title) + '</title><link>' + esc(config.url) + '/</link><description>' + esc(config.title) + '</description>'
  + pub.slice(0, 50).map(p => '<item><title>' + esc(title(p.text)) + '</title><link>' + esc(config.url) + '/p/' + p.slug + '</link>'
    + '<guid>' + esc(config.url) + '/p/' + p.slug + '</guid><pubDate>' + new Date(p.published).toUTCString() + '</pubDate>'
    + '<description>' + esc(html(p.text, mediaDir).replace(/(src|srcset)="\//g, '$1="' + config.url + '/').replace(/, \/media\//g, ', ' + config.url + '/media/')) + '</description></item>').join('')
  + '</channel></rss>\n'

module.exports = {title, page, home, feed, html}
