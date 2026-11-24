#!/usr/bin/env node
// Set (or change) the passphrase, and the site's title and address, in data/config.json.
// Only the scrypt hash of the passphrase is stored. Changing it signs every device out.
//
//   node bin/passphrase.js                       asks for everything
//   node bin/passphrase.js --title "My log" --url https://log.example.com
//
// Typed characters aren't shown. With no terminal (a script), it reads the passphrase from
// the first line of stdin.

var fs = require('fs')
var path = require('path')
var crypto = require('crypto')
var readline = require('readline')
var auth = require('../lib/auth')

var DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'))
var FILE = path.join(DATA, 'config.json')
var arg = k => { var i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null }

function ask(q, hidden){
  return new Promise(done => {
    var rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY})
    if (hidden && process.stdin.isTTY) rl._writeToOutput = s => { if (/\n|\r/.test(s) || s.startsWith(q)) process.stdout.write(s.startsWith(q) ? q : '\n') }
    rl.question(q, a => { rl.close(); done(a) })
  })
}

;(async () => {
  var old = {}
  try { old = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (e){}
  var title = arg('title') || old.title, url = arg('url') || old.url
  var tty = process.stdin.isTTY
  if (!title) title = tty ? (await ask('Site title (e.g. Notes): ')).trim() || 'Notes' : 'Notes'
  if (!url) url = tty ? (await ask('Site address (e.g. https://log.example.com): ')).trim() : 'http://localhost:8090'
  url = url.replace(/\/+$/, '')

  var pass = await ask('New passphrase (4+ words is good): ', true)
  if (tty && (await ask('Same again: ', true)) != pass){ console.error('Those were different. Nothing changed.'); process.exit(1) }
  if (pass.length < 12){ console.error('Use at least 12 characters. Nothing changed.'); process.exit(1) }

  fs.mkdirSync(DATA, {recursive: true})
  var config = {title, url, hash: auth.hash(pass), secret: crypto.randomBytes(32).toString('hex')}
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(config, null, 2) + '\n', {mode: 0o600})
  fs.renameSync(FILE + '.tmp', FILE)
  console.log('Saved to ' + FILE + '. Restart the app to use it (sudo systemctl restart simple-log).')
})()
