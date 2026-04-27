# Copilot instructions — ttlock-hass-integration

> Read before making changes. Concise, actionable notes for this repo.

## Architecture

- **Single Node.js process** (`addon/index.js`) orchestrated by `addon/src/init.js`:
  1. `store.loadData()` — load persisted lock config from `/data` (or `DATA_PATH`)
  2. `manager.init()` — initialize BLE/TTLock client (or noble gateway)
  3. Optional `HomeAssistant` MQTT client (`addon/src/ha.js`)
  4. Express server on port 55099 — serves built frontend at `/frontend`, attaches WebSocket at `/api`
- **Vue 3 + Vuetify frontend** (`frontend/src/`) communicates exclusively over WebSocket. Built output is committed to `addon/frontend/`.

## Data flow

```
Browser ──WS JSON──► addon/api/index.js (switch on msg.type)
                           │
                     manager.js (EventEmitter, BLE ops)
                           │ events: lockPaired|lockConnected|lockLock|lockUnlock|lockUpdated|scanStart|scanStop
                    ┌──────┴──────┐
              WsApi.js          ha.js
         (broadcast to UI)  (MQTT publish/subscribe)
```

## WebSocket message contract

All messages are `{ type: MessageType, data?: Object }`. **Types** (see `addon/api/Message.js`):

- **Client → server**: `status`, `scan`, `pair`, `lock`, `unlock`, `credentials`, `passcode`, `card`, `finger`, `settings`, `config`, `operations`, `unpair`
- **Server → client**: `status`, `lockStatus`, `credentials`, `error`

Lock shape sent to the frontend is built in `addon/api/Lock.js` (`Lock.fromTTLock()`). The frontend parses it in `frontend/src/api/index.js`.

## MQTT topics (ha.js)

- Discovery: `<discovery_prefix>/lock/<id>/config`
- State: `ttlock/<id>` (payload `LOCKED`/`UNLOCKED`)
- Command: `ttlock/<id>/set` (subscribes; accepts `LOCK`/`UNLOCK`)
- Lock ID = MAC address with colons removed, lowercased

**Do not change topic shapes** without also updating `ha.js` and documenting the migration — existing HA automations depend on them.

## Key conventions

- **DEV_MODE**: `process.env.DEV_MODE` enables stubs in `WsApi.js` (`_devLocks`, `_devSendCredentials`). Preserve these branches.
- **IP allowlist**: `init.js` restricts HTTP to `172.30.32.2` and localhost. Modify `options.localIP` to override; never remove the middleware.
- **Store singleton**: `addon/src/store.js` is a singleton. `init.js` must call `store.loadData()` before `manager.init()` — order matters.
- **BLE safety**: `manager.js` uses `waitingForConnect` set and `connectQueue` to serialise BLE ops. Don't bypass these guards when adding new lock operations.

## Developer workflows

| Task | Command |
|---|---|
| Start backend | `cd addon && node index.js` |
| Frontend dev server | `cd frontend && npm run dev` |
| Build + deploy frontend | `cd frontend && npm run deploy` (builds and copies `dist/*` → `addon/frontend/`) |
| Env vars for local run | `DATA_PATH`, `MQTT_HOST/USER/PASS/PORT/SSL`, `GATEWAY_TYPE/HOST/PORT/KEY/USER/PASS` |

No automated tests exist. Smoke test: start backend, open `http://localhost:55099/frontend`, or send raw WS messages to `/api`.

## Adding a new WebSocket message type

1. Add the type string to the `@typedef` in `addon/api/Message.js`
2. Add a `case` handler in `addon/api/index.js`
3. Add a send helper in `addon/api/WsApi.js`
4. Add the client-side call in `frontend/src/api/index.js` and update the relevant Vue component

## Key files

| File | Role |
|---|---|
| `addon/index.js` | Entry point, `uncaughtException` handler |
| `addon/src/init.js` | Startup orchestration, express + IP guard |
| `addon/src/manager.js` | BLE core, `Manager extends EventEmitter` |
| `addon/api/Lock.js` | Lock DTO (`Lock.fromTTLock`) |
| `addon/api/WsApi.js` | WebSocket broadcast helpers |
| `addon/src/ha.js` | MQTT discovery + state publishing |
| `addon/src/store.js` | Persistent config (lock data + aliases) |
| `frontend/src/api/index.js` | Frontend WS client, message parser |
