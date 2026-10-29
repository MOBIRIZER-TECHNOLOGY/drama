# How aicanon.dev is hosted and mapped to Katha

Last checked: 29 Oct 2026. Everything below was read from the running machine unless it says **(inferred)**.
No secrets are in this file. Real keys live in `deploy/pm2.aicanon.config.cjs` and `deploy/aicanon.secrets.json`,
both gitignored.

## In one paragraph

Katha runs on one Mac mini at home or office, which is the production server. The domain `aicanon.dev` is
registered and its DNS is hosted at BigRock. Its records point at this Mac's public IP address. The router sends
ports 80 and 443 to the Mac **(inferred)**. nginx on the Mac terminates HTTPS with a free Let's Encrypt
certificate and passes each hostname to a local process managed by pm2. Postgres, Redis and MinIO (video storage)
run in Docker on the same machine.

## The path of a request

```
viewer's phone or browser
   |  1. asks DNS for api.aicanon.dev   -> BigRock DNS -> 103.99.186.162
   v
internet -> router (forwards 80/443 to the Mac) -> nginx on the Mac (ports 80, 443)
   |
   |-- aicanon.dev, www.aicanon.dev  -> 127.0.0.1:3000  Next.js web app      (pm2: katha-web-aicanon)
   |-- admin.aicanon.dev             -> 127.0.0.1:8070  Next.js admin app    (pm2: katha-admin-aicanon)
   |-- api.aicanon.dev
   |       /media/hls/...            -> checked by the API, then MinIO 127.0.0.1:9000 (encrypted video segments)
   |       /media/images|subtitles|avatars -> MinIO (public artwork)
   |       everything else           -> 127.0.0.1:8071  FastAPI           (pm2: katha-api-aicanon)
   |-- mcp.aicanon.dev               -> 127.0.0.1:8072  (configured; no process was running when checked)
   '-- any other *.aicanon.dev       -> 404

background jobs: katha-worker-aicanon (pm2) turns uploaded videos into encrypted HLS and runs scheduled jobs
```

The mobile apps talk to `https://api.aicanon.dev` directly. The websites call it from the browser, and the web
server also calls the API on `127.0.0.1:8071` for server-side rendering, which never leaves the machine.

## 1. Domain and DNS

| Item | Value |
|---|---|
| Registrar and DNS host | BigRock (nameservers `dns1-4.bigrock.in`) |
| `aicanon.dev`, `www`, `api`, `admin` | A records -> `103.99.186.162` (checked through public DNS) |
| That IP | This Mac's public address (confirmed with an external IP check) |
| `mcp.aicanon.dev` | Has a certificate and an nginx entry |

To add or change a name, edit the A record at BigRock. Changes take minutes to a few hours to spread.
The IP must stay the same. If your internet provider changes it, every record must be updated, so ask the
provider for a static IP.

**Why local checks mislead:** this Mac's `/etc/hosts` maps `aicanon.dev`, `admin`, `api` and `mcp` to
`127.0.0.1`. That is handy for testing, but it means a browser on this Mac never proves what the outside world
sees. Check from another network, or use a probe site such as check-host.net.

## 2. Network entry

- The Mac listens on ports 80 and 443 (nginx).
- The router must forward TCP 80 and 443 to the Mac's local address **(inferred; outside probes from several
  countries reach the site, so it is working)**. If the Mac's local IP changes, give it a fixed address or a DHCP
  reservation in the router, or traffic stops.
- Port 80 only answers certificate checks and redirects everything else to HTTPS.

## 3. HTTPS certificate

- Issued by Let's Encrypt, covering `aicanon.dev`, `www`, `api`, `admin` and `mcp`.
- **Valid from 11 Sep 2026 to 10 Dec 2026.**
- nginx reads it from `/Users/pawansingh/Desktop/workspace/ssl/aicanon.dev/` (`fullchain.pem`, `privkey.pem`).
- Renewal: a launchd job (`~/Library/LaunchAgents/com.aicanon.certrenew.plist`) runs
  `workspace/nginx/renew-aicanon-cert.sh` every day at 03:30. It calls `certbot renew` (a no-op until about 30 days
  before expiry), which proves ownership through `/.well-known/acme-challenge/` on port 80, then
  `deploy-aicanon-cert.sh` copies the new files into the folder above and reloads nginx.
- **Known problem:** `workspace/nginx/aicanon-renew.log` shows the job failing every night with
  `Operation not permitted`. macOS is blocking launchd from running a script stored under `Desktop`. Renewal
  will probably fail when it matters, and **the certificate expires on 10 Dec 2026**, which would make every
  browser and phone show a security error. Fix: move the two scripts and the log out of `Desktop` (for example to
  `/usr/local/lib/aicanon/`), update the plist to point there, reload it with `launchctl`, and run it once by
  hand. Not done yet.

## 4. nginx

- Installed with Homebrew and started at boot by launchd (`homebrew.mxcl.nginx`). It also serves other sites on
  this Mac, so a bad edit can take them down too. Always run `nginx -t` before `nginx -s reload`.
- Active config: `/opt/homebrew/etc/nginx/servers/aicanon.dev.conf`; the repo-side copy is
  `workspace/nginx/aicanon.dev.conf` (the two must match). Shared include `katha_public_media.conf` sits next to
  `nginx.conf`.
- It contains one server block per hostname (see the diagram), plus these media rules on `api.aicanon.dev`:
  - `/media/hls/` is protected: nginx asks the API (`/v1/media/verify`) whether the signed link in the URL is valid
    and unexpired. No valid link, no video.
  - Only `images`, `subtitles` and `avatars` under `/media/` are public. Everything else, including the original
    uploaded videos, returns 404.
  - CORS is limited to `aicanon.dev`, `www` and `admin`; the key endpoint is limited to 30 requests per minute
    per client; JSON, playlists and subtitles are gzip-compressed; downloaded segments are cached on disk.

## 5. Processes (pm2)

Defined in `deploy/pm2.aicanon.config.cjs` (gitignored, holds the signing and encryption secrets).

| pm2 name | Port | What it is |
|---|---|---|
| `katha-web-aicanon` | 3000 | Public website (Next.js, `next start`) |
| `katha-admin-aicanon` | 8070 | Admin console (Next.js) |
| `katha-api-aicanon` | 8071 | FastAPI backend |
| `katha-worker-aicanon` | - | Video transcoding and scheduled jobs (arq) |

`magari-backend` and `magari-frontend` in the same pm2 are a different project and are not part of Katha.

After a reboot, pm2 restarts everything by itself through the login agent `~/Library/LaunchAgents/pm2.pawansingh.plist`
(`pm2 resurrect`, using the list saved with `pm2 save`). This was confirmed after a real reboot. It starts when the
user account logs in, so the Mac must log in automatically.

## 6. Data stores (Docker)

| Container | Host port | Purpose |
|---|---|---|
| `katha-postgres-1` | 127.0.0.1:5433 | Database `katha` (this is the **live** database) |
| `katha-redis-1` | 127.0.0.1:6380 | Job queue and cache |
| `katha-minio-1` | 127.0.0.1:9000 (console 9001) | Bucket `katha-media`: videos, images, subtitles |
| `katha-mailpit-1` | 1025 / 8025 | Local email catcher for development |
| `katha-media-edge-1` | 127.0.0.1:8080 | An older edge proxy; production does not use it |

Containers have `restart: unless-stopped`, but **Docker Desktop itself does not start at login**. After a reboot
the site is up but the API returns errors until Docker Desktop is opened. Turn on "Start Docker Desktop when you
sign in" in its settings. Nothing in the databases is backed up automatically; take a dump with
`docker exec katha-postgres-1 pg_dump -U katha katha > backup.sql` and copy the MinIO data.

## 7. How the pieces are wired to the product

- **Web:** built with `next build` using the public API address `https://api.aicanon.dev`, then served by pm2.
  To deploy a web change: build with the env from the pm2 config, then `pm2 restart katha-web-aicanon`.
- **Admin:** same pattern on port 8070.
- **API:** `KATHA_CDN_BASE_URL` is `https://api.aicanon.dev/media`, so artwork and subtitle links point there.
  `KATHA_MEDIA_ORIGIN_URL` points at MinIO directly so the API reads playlists without going through the public
  edge. `KATHA_CDN_SIGNING_MODE=hmac` makes nginx enforce signed segment links, and the links expire in 30 minutes.
  Videos are AES-128 encrypted; the API hands out the per-episode key only to viewers allowed to watch.
- **Mobile apps:** the API address is baked in at build time (`EXPO_PUBLIC_API_URL`), so a new domain needs a new
  build.
- **Sign-in and payments:** the server reads Firebase and Razorpay settings from `deploy/aicanon.secrets.json`
  (see `deploy/AUTH-PAYMENTS-SETUP.md`). Both are **not configured yet**.

## 8. Everyday commands

```
pm2 list                                   # what is running
pm2 logs katha-api-aicanon --lines 50      # recent API logs
pm2 reload deploy/pm2.aicanon.config.cjs --only katha-api-aicanon --update-env   # apply config changes
nginx -t && nginx -s reload                # check, then reload nginx
docker ps                                  # data stores
curl https://api.aicanon.dev/health        # quick check (this Mac sees itself, see the hosts note)
```

After a reboot: log in, open Docker Desktop, then `pm2 list` and `docker ps` should show everything online.

## 9. Risks, most important first

1. **Certificate expires 10 Dec 2026** and automatic renewal is failing (section 3).
2. **The Mac sleeps after 1 minute** unless something holds it awake. Run `sudo pmset -c sleep 0` to keep it
   awake on mains power. A sleeping Mac means the site is offline.
3. **Docker Desktop does not auto-start**, so a reboot leaves the API broken until someone opens it.
4. **One machine, one home or office connection.** A power cut, router reboot, IP change or Mac failure is a full
   outage, and there are no automated backups.
5. **The API runs with `KATHA_ENV=local`**, a development-style setting that production-only checks (for
   example refusing to start without certain secrets) do not apply to.
6. **A shared nginx** also serves other sites, so changes need care.

## 10. Adding another domain or subdomain

1. At BigRock, add an A record to `103.99.186.162`.
2. Add a `server` block to `/opt/homebrew/etc/nginx/servers/aicanon.dev.conf` (and the repo copy) pointing to the
   right local port, and extend the certificate to cover the new name.
3. Allow the new origin in `KATHA_CORS_ORIGINS` for the API if browsers will call it, then reload.
4. `nginx -t && nginx -s reload`.
