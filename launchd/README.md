# launchd agents

Two LaunchAgents keep the dev environment running between reboots.

| Plist | Purpose | Listens / connects |
|------|---------|--------------------|
| `com.gwp.wrestling-researcher.plist` | Next.js dev server (`pnpm dev` under nvm) | `http://wrestling-researcher.local:5150` |
| `com.gwp.pwr-ngrok.plist` | ngrok tunnel | `https://pwr.ngrok.io` → localhost:5150 |

## Install / load

Symlink (preferred — edits in this repo apply immediately) or copy each plist
into `~/Library/LaunchAgents`, then `launchctl bootstrap`. The symlink path
must use the actual on-disk location, no spaces resolved:

```sh
ln -sf "/Users/jschairb-gwp/src/ProWrestling Researcher/launchd/com.gwp.pwr-ngrok.plist" \
       ~/Library/LaunchAgents/com.gwp.pwr-ngrok.plist

launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.gwp.pwr-ngrok.plist
launchctl enable    "gui/$(id -u)/com.gwp.pwr-ngrok"
launchctl kickstart "gui/$(id -u)/com.gwp.pwr-ngrok"
```

## Status / logs

```sh
launchctl print "gui/$(id -u)/com.gwp.pwr-ngrok" | head -20
tail -f /tmp/pwr-ngrok.out.log
```

ngrok writes JSON-line logs to stdout — pipe through `jq` if you want pretty
event filtering:

```sh
tail -f /tmp/pwr-ngrok.out.log | jq -c '{lvl, msg, addr, url}'
```

## Stop / unload

```sh
launchctl bootout "gui/$(id -u)/com.gwp.pwr-ngrok"
```

## Authtoken

The ngrok agent reads `~/Library/Application Support/ngrok/ngrok.yml` for the
authtoken — the plist deliberately does **not** embed it. To rotate, log in at
https://dashboard.ngrok.com, copy the new token, and run
`ngrok config add-authtoken <new-token>`.

## Verify the tunnel end-to-end

After the auth login flow ships:

1. `launchctl kickstart -k "gui/$(id -u)/com.gwp.pwr-ngrok"` — restart the tunnel.
2. `curl -I https://pwr.ngrok.io/login` from any machine → expect `200`.
3. `curl -X POST https://pwr.ngrok.io/api/wrestlers -H 'content-type: application/json' -d '{}'` → expect `401` (unauthenticated mutation).
4. From your phone, load `https://pwr.ngrok.io/login`, sign in, then try a write — should succeed once authenticated.
