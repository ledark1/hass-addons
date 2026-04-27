# Changelog

## [1.4.0] - 2026-04-27

### Corrections

- **Firmware** : correction d'un bug récurrent où la version firmware de la serrure n'était pas affichée après un redémarrage
  - `store.js` : ajout de `deviceInfoData` (méthodes `setDeviceInfo` / `getDeviceInfo`) persisté dans `/data/deviceInfoData.json`
  - `manager.js` : sauvegarde de `lock.deviceInfo` dans le store immédiatement après le jumelage (`initLock`)
  - `Lock.js` : fallback `store.getDeviceInfo()` quand `lock.deviceInfo` est absent (après redémarrage)
  - `ha.js` : même fallback pour `sw_version` dans la découverte MQTT Home Assistant

- **Audio (son)** : le chip d'état du son restait grisé sur la carte serrure même quand le son était actif
  - `Lock.js` : `getLockSound()` utilise un cache en mémoire et est sans danger quand la serrure est connectée ; la lecture était incorrectement conditionnée à `!isConnected()`, bloquant la valeur lors de l'événement `lockConnected`

## [1.2.38] - 2026-04-26

### Corrections

- **PIN (passcode)** : correction du crash `Cannot read properties of undefined (reading 'length')` lors de l'ajout ou la modification d'un code PIN
  - `Passcode.vue` : utilisation de `||` au lieu de `??` pour gérer les chaînes vides (`passCode`, `newPassCode`, `startDate`)
  - `Passcode.vue` : blocage de la sauvegarde si le nouveau code PIN est vide
  - `api/index.js` : validation des paramètres requis avant appel au manager ; dates par défaut pour l'update si absentes
  - `manager.js` : garde défensive dans `updatePasscode` pour détecter les paramètres manquants avant d'appeler le SDK

## [1.2.37] - 2026-04-26

### Corrections et améliorations de fiabilité

- **manager** : prévention des exécutions concurrentes de `_processOperationLog` par verrou (flag de déduplication + `finally`)
- **manager** : `_onLockUpdated` ne tente plus de se connecter si `_processOperationLog` est déjà en cours
- **manager** : émission de `lockBatteryUpdated` en plus de `lockUpdated` lors d'un changement de batterie
- **ha.js** : abonnement à `lockUpdated` (au lieu de `lockBatteryUpdated` qui n'était jamais émis) — la batterie est maintenant correctement publiée via MQTT
- **ha.js** : `updateLockState` enveloppé dans un `try/catch` pour éviter les crashs MQTT
- **store.js** : sauvegardes atomiques via fichier temporaire + `rename()` — protège contre la corruption JSON en cas de coupure de courant
- **WsApi.js** : méthode `_send()` centralisée avec `try/catch` — protège contre les envois sur socket fermée
- **api/index.js** : les erreurs de `getAudio` sont maintenant renvoyées au client WebSocket

## [1.2.0] - 2026-04-22

- Migrate frontend from Vue 2 to Vue 3 + Vuetify 3
- Replace webpack / @vue/cli-service build toolchain with Vite 5
- Replace v-jsoneditor with json-editor-vue (Vue 3 compatible)

## [0.4.11] - 2021-05-06

- Bump SDK in attempt at fixing connect limbo

## [0.4.0] - 2021-03-27

- Monitor advertisement packets to detect lock/unlock status updates (detects unlock events using pin, fingerprint or card)
- Discovery should be more reliable now
- View operation log
- Optimise communication with the lock
- Add lock unpair
- Fixes on settings save

## [0.3.2] - 2021-03-16

- Fix some bugs related to aliases when adding a new card or fingerprint

## [0.3.1] - 2021-03-08

- Add aliases (friendly names) to cards and fingerprints

## [0.3.0] - 2021-01-22

- New layout separating settings and credentials
- Manage lock sound

## [0.2.31] - 2021-01-21

- Bump SDK for fixing gateway disconnection issues

## [0.2.24] - 2021-01-20

- Bump SDK for switch feature fix and remote unlock error during pairing
- Stop scan after a new unpaired lock is found
- Option to debug gateway messages (`gateway_debug: true` in config)

## [0.2.21] - 2021-01-17

- Bump SDK for stability fixes

## [0.2.19] - 2021-01-16

- Auto-lock management

## [0.2.16] - 2021-01-16

- Basic config editing UI for saving/restoring lock pairing data
- Option for communication debug (`debug_communication: true` in config)

## [0.2.12] - 2021-01-16

- Persist device state between HA restarts
- Option for MQTT debug (`debug_mqtt: true` in config)

## [0.2.11] - 2021-01-15

- Filter credentials type availability based on lock features
- Force noble in websocket mode to avoid missing BLE adapter
- Unstable connection fixes from SDK
- Status updates to all clients
- Reduce scan interval
- Option to ignore CRC errors (`ignore_crc: true` in config)

## [0.2.7] - 2021-01-12

- Add support for BLE Gateway (not TTLock G2 gateway)

## [0.1.1] - 2021-01-08

- Possible fix for discovering unpaired locks
- Debug found locks

## [0.1.0] - 2021-01-05

Initial release
