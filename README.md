# simple-log

A small place to write on the web, for one person.

You open it on your phone or laptop and there is only a page of text. Every keystroke is
kept, so each post archives itself and can be played back the way it was typed. It works
with no connection and catches up when you're back online. Posts are private until you make
one public; public posts get a plain, fast page, a list on the home page and an RSS feed.

It is one Node.js program with no dependencies and no build step, meant to run on a $5 server
of your own. To set one up with Claude Code's help, even if you've never run a server, open
this folder in Claude Code and say "help me set this up". [CLAUDE.md](CLAUDE.md) has the steps.

## What it looks like

- **Writing** (`/write/`): the text, full screen. A small black square in the top-right corner
  opens the menu: new post, add image, replay, public on/off, your posts. One grey line at the
  bottom says whether everything has reached the server (`synced`, `offline · 12 edits on this
  device`, `sign in to sync`), and which version of the app is running; tap it to force an update.
- **Replay**: the post being typed again, pauses shortened, at 1×, 4×, 16× or 64×, with a slider.
- **E-ink** (a Boox or other e-ink phone): the editor and menu go pure black on white, with no
  greys and nothing that animates. It turns on by itself on an old Android Chrome (below 125, as
  Boox ships) or an e-ink model name; `?eink=1` / `?eink=0` or the menu's "e-ink" switch decide
  for good on that device. There, the first tap also goes full screen ("full screen" switch).
- **Public pages** (`/`, `/p/<name>`, `/feed.xml`): a title, a date, the text and its pictures.
  No scripts, no tracking.

`docs/` has screenshots from the automated browser check.

## How it works

1. Each post is a file, `data/posts/<id>.jsonl`. Each line is a batch of edits, and nothing is ever rewritten.
2. An edit is `{t, pos, del, ins}`: at time `t`, at position `pos`, the text `del` became `ins`. One per keystroke.
3. The post's text is all of its edits applied in order. Replay applies them one by one, with the gaps between them.
4. In the browser every edit is saved at once in IndexedDB, then sent within a second if there's a connection.
5. A batch says which version of the post it was typed on (`base`). If the server has moved on (another device), it answers 409 with what was missed.
6. The browser then moves its unsent edits to fit after those (a small "operational transform", `public/ot.js`) and sends again. Nothing typed is lost.
7. A service worker keeps the app's files on the device, so it opens on a plane. Every request has a time limit.
8. Making a post public adds an edit that says so. The server then writes `data/site/p/<name>.html`, the home page and the feed. Made private again, those go.
9. Pictures are shrunk in the browser to 640, 1280 and 2400 pixels on the long side. The server cuts out camera metadata (GPS, serial numbers) and stores them under long random names.
10. One passphrase signs you in. Only its scrypt hash is stored, in `data/config.json`, which is never in git. Sign-in gives a signed cookie good for 90 days.

## Files

```
server.js              the whole server: routes, the post logs, the public site
lib/auth.js            passphrase hash, signed cookie, limit on wrong guesses
lib/media.js           picture uploads, metadata stripping
lib/render.js          the public pages and the RSS feed, from a little markdown
public/                the writing app (served at /write/)
  index.html app.js app.css   the page
  ot.js                apply / diff / transform edits (also used by the server)
  sync.js              one post's unsent edits and how they catch up (also used by the tests)
  sw.js manifest.json  offline and install-to-home-screen
  manifest-eink.json   the same, full screen, for e-ink devices
  login.html           the sign-in page
bin/passphrase.js      set or change the passphrase, site title and address
deploy/                setup.sh (run on the server), nginx-site.conf, simple-log.service,
                       backup.sh, pull-backups.sh (run on your computer), health.sh
test/                  node --test: edits, sync, sign-in, pictures, private/public; browser.check.js
data/                  (not in git) config.json, posts/, media/, site/
```

## Run it on your computer

Needs Node.js 20 or newer.

```sh
node bin/passphrase.js      # pick a title and passphrase; address: http://localhost:8090
node server.js              # or PORT=8091 node server.js
```

Open http://localhost:8090/login, sign in, and write. The public side is http://localhost:8090/.

## Tests

```sh
node --test test/*.test.js
NODE_PATH=/path/to/node_modules node test/browser.check.js   # needs Playwright (npm i playwright; npx playwright install chromium)
```

The browser check signs in, types, goes offline, keeps typing, reloads with no network, comes
back while another device has edited the same post, checks they merge, makes the post public,
replays it and adds a picture. It leaves screenshots in `docs/`.

## Limits, on purpose

- One writer. No comments, no likes, no analytics.
- A plain textarea, not a rich editor. The markdown is: first line = title, `#` headings,
  `**bold**`, `*italic*`, `[links](https://…)`, `- lists`, `> quotes`, pictures.
- One tab edits at a time on a device; a second tab is read-only.
- Replay is for you (signed in). The full history includes text you deleted, so it isn't public.
- Strangers can open a picture only while a public post uses it. Once a post has been public,
  feed readers may have kept copies of its pictures; making it private can't take those back.
- Five wrong passphrases from one address pause sign-ins from that address for 15 minutes.
  Devices already signed in keep working.
- Signing out ends the sign-in on that device only. To sign out every device (a lost phone),
  set the passphrase again (`node bin/passphrase.js`, then restart).

MIT license.
