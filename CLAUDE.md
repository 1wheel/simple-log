# CLAUDE.md

This repo is simple-log: a one-person writing app (see README.md). Most people who open it in
Claude Code want it running on their own server and have never done that before. Your job is
to get them from nothing to a working https site, with them doing as little as possible and
understanding what happened.

## How to work with them

- **One step at a time.** Say what the step is for in a sentence, do it (or ask them to), then
  check that it worked before moving on. Each step below ends with a **Check**. Don't stack up
  three instructions and hope.
- **Plain words.** Explain each new term the first time it comes up, in one line (there's a
  glossary at the bottom). No "simply", no "just". Don't paste walls of output at them; say
  what it means.
- **Do everything you can yourself.** Run commands on their computer and, once ssh works, on
  the server (`ssh log '...'`). Ask them only for what needs their hands: creating accounts,
  paying, clicking in a provider's or registrar's website, DNS records, choosing a passphrase,
  and anything that asks for a password.
- **Never see the passphrase.** They type it into `node bin/passphrase.js` in their own
  terminal window, not into this chat. Never ask for it, print it, write it to a file, put it
  in a command line, or store it in memory or notes. The same goes for provider passwords and
  private ssh keys (the `.pub` file is fine to read). If they paste a secret into the chat
  anyway, tell them to choose a new one.
- **Nothing secret in git.** `data/` (posts, config.json with the hash) is gitignored. Keep it that way.
- **Ask before anything that can't be undone**: deleting a server, files, or DNS records, or
  changing ssh settings.
- **Keep notes** in `setup-notes.txt` in this folder (gitignored): provider, server IP, domain,
  username, ssh alias, what's done. No secrets. Read it first when they come back later, and
  pick up where it says.
- **Nothing that waits for typing.** Your Bash tool can't answer a prompt, so a command that
  asks a question (a password, "Overwrite (y/n)?", a key passphrase) just hangs. Use the
  non-asking forms below; anything that has to ask goes to the user, in their own terminal window.
- **Long server commands** (`apt-get upgrade`, the first run of setup.sh) often take more than
  2 minutes. Give them a 10-minute timeout (`timeout: 600000`) or run them in the background.
  So that a dropped connection can't stop apt halfway, wrap them:
  `ssh log 'sudo nohup bash -c "<command>" > /tmp/step.log 2>&1'`, then read `/tmp/step.log`.
- Before starting, ask three things: (1) Mac, Windows or Linux? (2) do they already own a
  domain name? (3) have they used a terminal before? Adjust your explanations to the answers.

On Windows, your commands run in Git Bash; the user's own terminal window is PowerShell.
`ssh`, `ssh-keygen`, `scp` and `tar` work in both. Git Bash has no rsync, so steps 7 and 13 give a
Windows line. Everything that's a bash script here runs on the server, not on their computer,
except `deploy/pull-backups.sh` (Mac/Linux only).

## The steps

### 1. Try it on their computer (optional, 5 minutes)

Worth it if they have Node.js 20+ (`node --version`), skip it if not; the server will have Node.
You run the tests: `node --test test/*.test.js`.

The passphrase is theirs to type, so hand them this line for their own terminal window, in this folder:

```sh
DATA_DIR=/tmp/simple-log-try node bin/passphrase.js --title "Trying it" --url http://localhost:8090
```

(Windows PowerShell: `$env:DATA_DIR="$env:TEMP\simple-log-try"; node bin/passphrase.js --title "Trying it" --url http://localhost:8090`.)
Then you start the server in the background, `DATA_DIR=/tmp/simple-log-try node server.js`
(Windows Git Bash: `DATA_DIR="$TEMP/simple-log-try" node server.js`), and they open http://localhost:8090/login.
**Check:** they can sign in and type. Stop the server afterwards.

### 2. An ssh key

An ssh key is a pair of files that lets their computer log in to the server without a
password: the private one stays on their computer, the public one (`.pub`) goes on the server.

You run, if `~/.ssh/simple_log` doesn't exist yet:

```sh
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/simple_log -C simple-log -N ""
```

`-N ""` means the key file has no passphrase of its own, which is fine here: it lives only on
their computer, which has its own login. If they want one anyway, they run `ssh-keygen -t ed25519
-f ~/.ssh/simple_log -C simple-log` in their own window, then (Mac) `ssh-add --apple-use-keychain
~/.ssh/simple_log` and you add `UseKeychain yes` and `AddKeysToAgent yes` to the `Host log`
block in step 5; otherwise every ssh command you run later hangs waiting for it.
**Check:** `cat ~/.ssh/simple_log.pub` prints one line starting with `ssh-ed25519`.

### 3. Rent a server

A VPS ("virtual private server") is a small computer in a data centre, rented by the month.
About $5 is plenty. Either:

- **Hetzner Cloud** (hetzner.com/cloud): the cheapest shared x86 plan, ~€4/month. Location
  near them. Keep **Public IPv4** ticked (unticking saves a few cents and breaks every later
  step). New accounts are sometimes asked for ID first, which can take hours; that's normal.
- **DigitalOcean** (digitalocean.com): Droplet, Basic, Regular, the $6/month size.

Either way: image **Ubuntu 24.04 LTS**; under SSH keys, "add key" and paste the contents of
`~/.ssh/simple_log.pub` (you print it, they paste it); no extra volumes or load balancers.
Turning on the provider's own weekly backups (+20%) is a good cheap extra. They sign up, pay
and click create; ask them for the server's **IPv4 address** when it shows.

**Check:** `ping -c 3 <IP>` gets answers (if ping is blocked, step 5's ssh is the check).

### 4. A domain name, pointed at the server

DNS is the internet's address book: it turns `log.example.com` into the server's IP address.
An **A record** is one line in it: a name and the IPv4 address it goes to.

- If they don't own a domain: buy one at a registrar (Porkbun, Namecheap, Cloudflare;
  ~$10-15/year). Any name they like.
- They can use the bare domain (`example.com`) or a subdomain (`log.example.com`); a subdomain
  is handy if the domain already has a website.

First they delete every other record for the same name: `AAAA` (the IPv6 kind), `CNAME`,
`ALIAS`, and "URL redirect" or parking records. New domains often come with these (Porkbun: an
ALIAS on `@` and a CNAME on `*`; Namecheap: a URL Redirect Record on `@`). Left in place, they
stop the new record working or make the certificate fail.

Then they add: type `A`, host/name `log` (or `@` for the bare domain), value the server's IPv4,
TTL default/automatic. If there's already an A record for that name, change it, don't add a
second. On Cloudflare, set the record to "DNS only" (grey cloud), at least until https works.

**Check:** `dig +short log.example.com @1.1.1.1` (Windows: `nslookup log.example.com 1.1.1.1`)
prints the server's IP. An empty answer for the first half hour is normal, not an error; carry
on with steps 5-8 meanwhile and check again. (Asking 1.1.1.1 avoids their own computer
remembering an early "no such name" for up to an hour.)

### 5. Log in to the server

Write an ssh shortcut so every later command is short. Add to `~/.ssh/config` (create it if
needed; on Windows it's `C:\Users\<them>\.ssh\config`):

```
Host log
  HostName <IP>
  User root
  IdentityFile ~/.ssh/simple_log
```

Then `ssh -o StrictHostKeyChecking=accept-new log 'uname -a; lsb_release -d'`. ("accept-new"
answers the first-time "are you sure?" question for this new server.)

**Check:** it prints Ubuntu 24.04 without asking for a password.

### 6. A user of their own, and lock the door

Working as `root` (the all-powerful admin account) all the time is risky; the app gets its own
everyday user, called `writer` here. It has no password at all: the only way in is their ssh
key. Because it has no password, it's allowed to use `sudo` (run one command as admin) without one.

```sh
ssh log 'adduser --disabled-password --gecos "" writer &&
  usermod -aG sudo writer &&
  echo "writer ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/writer && chmod 440 /etc/sudoers.d/writer &&
  install -d -m 700 -o writer -g writer /home/writer/.ssh &&
  install -m 600 -o writer -g writer /root/.ssh/authorized_keys /home/writer/.ssh/authorized_keys'
```

Change `User root` to `User writer` in `~/.ssh/config`. **Check:** `ssh log 'whoami; sudo -n true && echo sudo ok'`
prints `writer` and `sudo ok`. Only then turn off root and password logins:

```sh
ssh log 'printf "PermitRootLogin no\nPasswordAuthentication no\n" | sudo tee /etc/ssh/sshd_config.d/01-simple-log.conf && sudo sshd -t && sudo systemctl reload ssh'
```

(The `01-` matters: ssh uses the first value it reads, and cloud images often ship a
`50-cloud-init.conf` that turns passwords back on.)

**Check:** `ssh log 'sudo sshd -T | grep -Ei "^(permitrootlogin|passwordauthentication) "'`
prints both with `no`, and `ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/simple_log root@<IP> true`
says "Permission denied". If they ever lose their key, see "Lost the ssh key" under Troubleshooting.

Then bring the system up to date (a few minutes; see "Long server commands" above):

```sh
ssh log 'sudo nohup bash -c "cloud-init status --wait; apt-get -o DPkg::Lock::Timeout=600 update && DEBIAN_FRONTEND=noninteractive apt-get -y -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade" > /tmp/upgrade.log 2>&1'
```

Ubuntu installs security updates by itself after this (`unattended-upgrades`, on by default).
Then `ssh log 'test -f /var/run/reboot-required && echo reboot'`; if it says `reboot`, run
`ssh log 'sudo reboot'` and wait until `ssh log true` answers again.

### 7. Put the app on the server

If this folder has a git remote (`git remote get-url origin`), clone it:
`ssh log 'git clone <url> simple-log'`. Write an ssh-style url as https first
(`git@github.com:owner/repo.git` becomes `https://github.com/owner/repo.git`); the server has no
GitHub key. If the clone asks for a login, the repo is private: copy instead.

To copy (they downloaded a zip, or the repo is private):
`rsync -a --exclude data --exclude .git --exclude setup-notes.txt ./ log:simple-log/`.
Windows (Git Bash, no rsync):
`tar --exclude=./data --exclude=./.git --exclude=./setup-notes.txt -czf - . | ssh log "mkdir -p simple-log && tar -xzf - -C simple-log"`.

**Check:** `ssh log 'ls simple-log'` shows `server.js`.

### 8. Install everything: setup.sh

`deploy/setup.sh` installs nginx (the web server that faces the internet and passes requests to
the app), certbot (gets the free https certificate from Let's Encrypt), Node.js 22 and the
firewall (`ufw`, which closes every door except ssh, http and https). It makes the app a
systemd service (Ubuntu's way of keeping a program running and starting it after a reboot) and
schedules the nightly backup. It is safe to run again any time; each part checks first.

```sh
ssh log 'cd simple-log && sudo nohup bash deploy/setup.sh log.example.com > /tmp/setup.log 2>&1'; ssh log 'cat /tmp/setup.log'
```

(Give it the 10-minute timeout.) No email is needed; if they want Let's Encrypt account notices,
put their email after the domain. The first run will say there's no passphrase yet and skip
starting the app; and if DNS isn't ready, it skips https.
Both are fine for now. **Check:** it ends with the health check; failures about the app and
https are expected at this point, anything about nginx or the firewall is not.

### 9. The passphrase

This one they do themselves, in **their own terminal window**, not through you. Tell them:

1. Open a new terminal window.
2. Type `ssh log` and press Enter. (Windows: same, in PowerShell.)
3. Paste the line you give them, with their title and domain filled in by you:
   `cd simple-log && node bin/passphrase.js --title "<title>" --url https://<domain>`
4. Type a passphrase, Enter, the same again, Enter. Nothing shows while typing it; that's on
   purpose. It needs 12 or more characters; four or more random words is good. Save it in
   their password manager.
5. Type `exit`.

**Check** (without seeing it): `ssh log 'test -s simple-log/data/config.json && echo set'`.

### 10. Start it, with https

Run setup.sh again (step 8's command). Now it starts the app and, once DNS points at the
server, gets the certificate. **Check:** it ends with `All good.`, and
`curl -sI https://log.example.com/ | head -1` says `200`.

If certbot fails: DNS isn't pointing here yet (step 4's check), or a provider firewall blocks
port 80 (DigitalOcean/Hetzner "Cloud Firewall": allow TCP 80 and 443 inbound, or don't use one).

### 11. The first post

They open `https://log.example.com/login`, sign in, and write. The first line is the title.
Show them the corner menu: New post, Add image, Replay, Public. **Check:** the footer says
`synced`, and `ssh log 'ls simple-log/data/posts'` shows a `.jsonl` file. Have them tick
Public and open the link; then untick it and see it 404. Posts start private. Strangers can
see a picture only while a public post uses it, but feed readers may keep copies of what was public.

### 12. On their phone

Sign in on the phone first (`/login`), then:

- **Android (Chrome):** ⋮ menu, "Add to Home screen" or "Install app".
- **iPhone (Safari):** the Share button, "Add to Home Screen". The installed app doesn't share
  Safari's sign-in, so it asks once more: tap the footer's `sign in to sync`.

If their phone has an e-ink screen (a Boox, say), tell them about e-ink mode: black on white,
nothing that animates, full screen on the first tap. It usually turns itself on; if not, the
menu's "e-ink off" switch turns it on (or open `/write/?eink=1` once).

It opens full screen like an app. **Check:** in airplane mode, open it, type a sentence (the
footer says `offline · N edits on this device`), turn airplane mode off, tap the footer: `synced`.

### 13. Backups

Every night at 3:17 the server makes `~/backups/simple-log-<date>.tar.gz` of the data folder
and keeps 14 days. Make the first one now: `ssh log 'bash simple-log/deploy/backup.sh'`.

A backup on the same server doesn't survive losing the server, so also copy them to their
computer: `bash deploy/pull-backups.sh log` (Windows: `mkdir -p ~/simple-log-backups && scp "log:backups/*.tar.gz" ~/simple-log-backups/`).
Offer to schedule it daily, and on Mac/Linux do it yourself (cron on a Mac can't read
~/Desktop or ~/Documents, so the script goes in the backups folder first):

```sh
mkdir -p ~/simple-log-backups && cp deploy/pull-backups.sh ~/simple-log-backups/
(crontab -l 2>/dev/null; echo "0 12 * * * /bin/bash $HOME/simple-log-backups/pull-backups.sh log") | crontab -
```

A laptop that's asleep at noon skips that day, which is fine with 14 kept on the server.
The provider's backups (step 3) are a third copy.

To restore on the same server: `ssh log 'sudo systemctl stop simple-log && tar -xzf ~/backups/simple-log-<date>.tar.gz -C ~/simple-log && sudo systemctl start simple-log'`.
On a new server: steps 5-8, then `scp <file> log:` and `ssh log 'tar -xzf simple-log-<date>.tar.gz -C ~/simple-log'`,
then setup.sh again. No step 9: config.json is in the backup.
**Check:** `ls ~/simple-log-backups` on their computer shows a `.tar.gz`.

### 14. The health check

```sh
ssh log 'bash simple-log/deploy/health.sh'
```

**Check:** every line `ok` (a `warn` about no backup yet is fine on day one), ending `All good.`.
Then tell them in a few lines what they have, what it costs per month and year, and where
things are: posts on the server in `~/simple-log/data/posts/`, backups in `~/backups/`, notes in
`setup-notes.txt`.

### 15. Later: updating

```sh
ssh log 'cd simple-log && git pull && sudo systemctl restart simple-log'
```

(If it was copied with rsync, rsync again, then restart.) Phones pick up the new version in the
background and use it from the next launch; tapping the version in the footer forces it.
Re-run `setup.sh` after updates that change anything in `deploy/`.

## Troubleshooting

| They see | Look at | Usually |
| --- | --- | --- |
| The site doesn't load at all | `dig +short <domain>`; `ssh log 'sudo ufw status; systemctl status nginx'` | DNS not pointing here yet, or a provider firewall |
| `502 Bad Gateway` | `ssh log 'sudo journalctl -u simple-log -n 50'` | The app stopped. No config.json (step 9), or a crash in the log |
| Browser warns "not secure" | `ssh log 'sudo certbot certificates'` | https not set up yet: re-run setup.sh once DNS works |
| Footer says `sign in to sync` | | The 90-day sign-in ran out, or the passphrase changed. Sign in again; nothing typed is lost |
| Footer stays `offline` | Can the phone open the site in a browser? | No connection, or the server is down (see 502) |
| "too many tries" | | 5 wrong passphrases from one place: wait 15 minutes |
| "sign in over https" | `curl -sI https://<domain>/` | https isn't set up yet: step 10 |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | | Expected after rebuilding the server at the same IP: `ssh-keygen -R <IP>`, then step 5's accept-new command |
| Forgot the passphrase | | Step 9 again, then `sudo systemctl restart simple-log`. It signs every device out |
| Old version on a phone | | Tap the version in the footer |
| Lost the ssh key | | Step 2 for a new key. In the provider's website, "Reset root password" (Hetzner: Rescue tab; DigitalOcean: Access tab), open the console, log in as root with it, and add the new `.pub` line to `/home/writer/.ssh/authorized_keys`. (`PermitRootLogin no` is for ssh only.) |
| Disk full | `ssh log 'df -h; du -sh ~/backups ~/simple-log/data'` | Pictures or backups. Fewer backups: `ssh log 'cd simple-log && sudo KEEP=7 bash deploy/setup.sh <domain>'` |

`ssh log 'sudo journalctl -u simple-log -f'` shows the app's messages live.

## Glossary (one line each, for when a word first comes up)

- **Terminal**: the window where you type commands. Mac: Terminal app. Windows: PowerShell.
- **Node.js**: the program that runs the app's code.
- **apt / package**: Ubuntu's app store for the command line; one program it installs.
- **git clone / rsync**: copy a project from where it's kept online; copy a folder to another computer.
- **Registrar**: the company you buy a domain from.
- **TTL**: how long other computers may remember a DNS answer before asking again.
- **IPv4 / IPv6**: the short kind of IP address (`203.0.113.7`) and the long new kind; this setup uses IPv4.
- **Port**: a numbered door on a computer: 80 is http, 443 is https, 8090 is the app (closed to the internet).
- **cron**: runs a command on a schedule, like the nightly backup.
- **404 / 502**: "nothing here"; "nginx couldn't reach the app".
- **Health check**: `deploy/health.sh`, one line per thing that should be working.
- **Server / VPS**: a computer in a data centre that's always on, rented by the month.
- **IP address**: the server's number on the internet, like `203.0.113.7`.
- **Domain / DNS / A record**: a name you own; the internet's address book; the line in it that points the name at the IP.
- **ssh / ssh key**: the secure way to type commands on the server; the pair of files that proves it's you.
- **root / sudo**: the admin account; "do this one command as admin".
- **Firewall (ufw)**: closes every network door except the ones you choose.
- **nginx**: the program that answers web requests and hands them to the app.
- **https / certificate / Let's Encrypt / certbot**: the padlock; the file that proves the site is yours; the free service that issues it; the tool that gets and renews it.
- **systemd service**: Ubuntu keeping the app running and starting it after a reboot.
- **PWA / service worker**: a website that installs like an app; the part that keeps it working offline.
- **Passphrase hash**: a scrambled form of the passphrase that can check it but can't be turned back into it.

## For changes to the code

Keep it small and direct: no frameworks, no npm dependencies, no build step. Every network
request in the app has a deadline. Run `node --test test/*.test.js` (and `test/browser.check.js`
with Playwright for UI changes) before saying something works.
