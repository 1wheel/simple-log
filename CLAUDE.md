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
- Before starting, ask three things: (1) Mac, Windows or Linux? (2) do they already own a
  domain name? (3) have they used a terminal before? Adjust your explanations to the answers.

On Windows, use PowerShell: `ssh`, `ssh-keygen` and `scp` are built in. Everything that's a
bash script here runs on the server, not on their computer, except `deploy/pull-backups.sh`
(on Windows use the `scp` line in step 15 instead).

## The steps

### 1. Try it on their computer (optional, 5 minutes)

Worth it if they have Node.js 20+ (`node --version`), skip it if not; the server will have Node.

```sh
node --test test/*.test.js
DATA_DIR=/tmp/simple-log-try node bin/passphrase.js --title "Trying it" --url http://localhost:8090
DATA_DIR=/tmp/simple-log-try node server.js
```

The passphrase prompt is for them to type in their own terminal. Then they open
http://localhost:8090/login. **Check:** they can sign in and type. Stop the server afterwards.

### 2. An ssh key

An ssh key is a pair of files that lets their computer log in to the server without a
password: the private one stays on their computer, the public one (`.pub`) goes on the server.

```sh
ls ~/.ssh/*.pub                       # maybe they have one already
ssh-keygen -t ed25519 -f ~/.ssh/simple_log -C simple-log
```

`ssh-keygen` asks for a key passphrase: they type it (or leave it empty) themselves. If they
set one, on a Mac add it to the keychain so commands you run don't stop to ask:
`ssh-add --apple-use-keychain ~/.ssh/simple_log`. **Check:** `cat ~/.ssh/simple_log.pub`
prints one line starting with `ssh-ed25519`.

### 3. Rent a server

A VPS ("virtual private server") is a small computer in a data centre, rented by the month.
About $5 is plenty. Either:

- **Hetzner Cloud** (hetzner.com/cloud): CX22 or the cheapest shared plan, ~€4/month. Location
  near them.
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

In the registrar's (or DNS host's) DNS settings they add: type `A`, host/name `log` (or `@`
for the bare domain), value the server's IPv4, TTL default/automatic. If there's already an A
record for that name, it has to be changed, not duplicated. On Cloudflare, set the record to
"DNS only" (grey cloud), at least until https works.

**Check:** `dig +short log.example.com` (Windows: `nslookup log.example.com`) prints the
server's IP. It can take from a minute to an hour; carry on with steps 5-8 meanwhile and check again.

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
ssh log 'printf "PermitRootLogin no\nPasswordAuthentication no\n" | sudo tee /etc/ssh/sshd_config.d/90-simple-log.conf && sudo sshd -t && sudo systemctl reload ssh'
```

**Check:** `ssh log whoami` still works, and `ssh -o BatchMode=yes root@<IP> true` is refused.
If they ever lose their key, the provider's website has a "console" that still gets them in.

Then bring the system up to date (a few minutes): `ssh log 'sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade'`.
Ubuntu installs security updates by itself after this (`unattended-upgrades`, on by default).
If it says a restart is needed: `ssh log 'sudo reboot'`, wait a minute.

### 7. Put the app on the server

If this folder has a git remote (`git remote get-url origin`), clone it:
`ssh log 'git clone <url> simple-log'`. If not (they downloaded a zip, or the repo is private),
copy it: `rsync -a --exclude data --exclude .git --exclude setup-notes.txt ./ log:simple-log/`
(Windows without rsync: `scp -r` the folder, without `data`).

**Check:** `ssh log 'ls simple-log'` shows `server.js`.

### 8. Install everything: setup.sh

`deploy/setup.sh` installs nginx (the web server that faces the internet and passes requests to
the app), certbot (gets the free https certificate from Let's Encrypt), Node.js 22 and the
firewall (`ufw`, which closes every door except ssh, http and https). It makes the app a
systemd service (Ubuntu's way of keeping a program running and starting it after a reboot) and
schedules the nightly backup. It is safe to run again any time; each part checks first.

```sh
ssh log 'cd simple-log && sudo bash deploy/setup.sh log.example.com their@email.com'
```

The email only gets certificate-expiry warnings from Let's Encrypt. The first run will say
there's no passphrase yet and skip starting the app; and if DNS isn't ready, it skips https.
Both are fine for now. **Check:** it ends with the health check; failures about the app and
https are expected at this point, anything about nginx or the firewall is not.

### 9. The passphrase

This one they do themselves, in **their own terminal window**, not through you. Tell them:

1. Open a new terminal window.
2. Type `ssh log` and press Enter. (Windows: same, in PowerShell.)
3. Type `cd simple-log && node bin/passphrase.js` and press Enter.
4. Give the site a title, its address (`https://log.example.com`), and a passphrase twice.
   Nothing shows while typing it; that's on purpose. Four or more random words is a good passphrase.
   Save it in their password manager.
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
Public and open the link; then untick it and see it 404. Posts start private.

### 12. On their phone

Sign in on the phone first (`/login`), then:

- **Android (Chrome):** ⋮ menu, "Add to Home screen" or "Install app".
- **iPhone (Safari):** the Share button, "Add to Home Screen".

It opens full screen like an app. **Check:** in airplane mode, open it, type a sentence (the
footer says `offline · N edits on this device`), turn airplane mode off, tap the footer: `synced`.

### 13. Backups

Every night at 3:17 the server makes `~/backups/simple-log-<date>.tar.gz` of the data folder
and keeps 14 days. Make the first one now: `ssh log 'bash simple-log/deploy/backup.sh'`.

A backup on the same server doesn't survive losing the server, so also copy them to their
computer: `bash deploy/pull-backups.sh log` (Windows: `scp "log:backups/*.tar.gz" .`). Offer to
schedule that (crontab on Mac/Linux). The provider's backups (step 3) are a third copy.

To restore: `sudo systemctl stop simple-log`, `tar -xzf simple-log-<date>.tar.gz -C ~/simple-log`,
`sudo systemctl start simple-log`. **Check:** `ls` on their computer shows a `.tar.gz`.

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
| "too many tries" | | 5 wrong passphrases from one place (or 20 in all): wait 15 minutes |
| Forgot the passphrase | | Step 9 again, then `sudo systemctl restart simple-log`. It signs every device out |
| Old version on a phone | | Tap the version in the footer |
| Lost the ssh key | | Provider's web console, log in there, add a new `.pub` to `/home/writer/.ssh/authorized_keys` |
| Disk full | `ssh log 'df -h; du -sh ~/backups ~/simple-log/data'` | Pictures or backups. Fewer backups: `KEEP=7` in the cron line |

`ssh log 'sudo journalctl -u simple-log -f'` shows the app's messages live.

## Glossary (one line each, for when a word first comes up)

- **Terminal**: the window where you type commands. Mac: Terminal app. Windows: PowerShell.
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
