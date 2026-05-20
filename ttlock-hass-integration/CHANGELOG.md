# Changelog

## [1.9.15] - 2026-05-20

### Amélioration des performances de connexion

- **ESP32 — délai post-déconnexion BLE réduit** : `ble_api.cpp` — `vTaskDelay` après déconnexion réduit de 1000 ms à 200 ms. Économise 800 ms à chaque cycle lock/unlock
- **ESP32 — délai entre retries BLE réduit** : `ble_api.cpp` — délai entre tentatives de connexion BLE réduit de 1000 ms à 500 ms. Économise jusqu'à 2 s sur les connexions initiales qui nécessitent plusieurs essais
- **Addon — reprise du monitor plus rapide** : `manager.js` — délai de `_scheduleGatewayRecovery` réduit de 2500 ms à 500 ms. Le monitor BLE redémarre 2 s plus tôt après un reconnect WebSocket
- **Addon — reconnexion WebSocket plus rapide** : `manager.js` — configuration du `reconnecting-websocket` (RWS) du SDK avec `minReconnectionDelay: 300 ms` et `connectionTimeout: 2000 ms` (au lieu de 1000 ms et 4000 ms par défaut). La reconnexion après une coupure réseau est 700 ms plus rapide. Appliqué de façon défensive (feature-detected) dans `_attachGatewayWatchdog`

## [1.9.10] - 2026-05-15

### Gateway noble : UI, reprise du monitor, fail-fast

- **Puce gateway toujours visible** : quand un gateway noble est configuré, la puce reste affichée en permanence — verte (`success`) avec `host:port` au survol quand le lien est connecté, en `warning`/`error` sinon (`AppTopBar.vue`). Le backend expose `gatewayHost` dans le payload `status` (`manager.getGatewayHost()`, `WsApi.js`) ; le frontend le stocke (`store`, `api`) et l'affiche dans l'infobulle (locales fr/en : `app.gateway.connected`)
- **Reprise fiable du monitor BLE** : `_recoverMonitor` remplacé par `_ensureMonitoring()` + watchdog périodique (20 s). Corrige le `monitor BLE redémarré: false` : `TTLockClient.stopMonitor()` ne réinitialisait pas le flag interne `monitoring`, donc `startMonitor()` repartait toujours en `false` et le scan restait mort jusqu'à un scan manuel. Le nouveau code détecte cet état bloqué, réinitialise les flags internes du SDK (couplage documenté, feature-detected) et vérifie réellement `isMonitoring()` avec retries. Le watchdog couvre aussi les `startMonitor()` silencieusement faux de `_onScanStopped`/`_onLockDisconnected`
- **Fail-fast des opérations BLE quand le gateway est déconnecté** : `_connectLock` attend brièvement la reconnexion (≤6 s) puis abandonne proprement au lieu d'enchaîner 4 tentatives × backoff vouées à `Disconnected while waiting for response` ; sortie anticipée de la boucle si le lien tombe en cours. Gardes scoppées au mode noble — aucun impact sur le BLE local

## [1.9.9] - 2026-05-15

### Améliorations gateway noble (WebSocket)

- **Robustesse des erreurs** : `index.js` remplace le handler `uncaughtException` basé sur un match de chaîne exact (fragile, message trompeur « retrying… » alors que l'addon ne retentait rien) par une détection ciblée de la classe d'erreurs de connexion récupérables (fragment de message OU code errno). Ajout d'un handler `unhandledRejection` symétrique. Avertissement throttlé (max 1/30 s) et message corrigé : c'est le `reconnecting-websocket` du SDK qui retente
- **Validation de configuration** : `init.js` normalise et valide les options noble avant `setNobleGateway` — `gateway_port` est coercé en nombre (il arrivait en chaîne depuis l'environnement), `gateway_host`/`gateway_key`/`gateway_user`/`gateway_pass` sont contrôlés et toute valeur manquante ou invalide est signalée explicitement (le SDK retombait silencieusement sur des défauts codés en dur, dont `admin`/`admin`)
- **État du lien dans l'UI** : `manager.js` observe le `reconnecting-websocket` du SDK (open/close/error) et expose `gatewayStatus` (`connecting`/`connected`/`disconnected`/`unknown`). Diffusé dans le payload `status` (`WsApi.js`, `api/index.js`) ; le frontend (`store`, `api`, `AppTopBar.vue`, locales fr/en) affiche une puce d'alerte quand le gateway n'est pas connecté. Détection 100 % défensive : dégradation en `unknown` si la structure interne du SDK change, jamais de crash
- **Watchdog de reprise du monitoring** : sur reconnexion du gateway, `manager.js` relance le monitor BLE (`stopMonitor` puis `startMonitor`, avec une nouvelle tentative). Le SDK ne réémettait pas la commande de scan après une reconnexion silencieuse — le scan restait donc mort jusqu'au prochain redémarrage. Recovery débouncée et différée si une opération serrure est en cours

## [1.9.0] - 2026-05-12

### Corrections

- **Connexion admin (adminLogin)** : réinitialisation systématique de `lock.adminAuth` avant chaque `_doAdminLogin`
  - `manager.js` : le SDK positionnait `adminAuth=true` lors de `connect(false)/onConnected` même quand la session firmware n'était plus valide (déconnexion en pleine auth). Skipper `_doAdminLogin` sur une session périmée provoquait `NO_PERMISSION (0x01)` sur les lectures/écritures (notamment `getPassCodes`)
  - `manager.js` : `adminAuth` également réinitialisé dans le `catch` pour ne pas court-circuiter la macro à la tentative suivante
- **Ajout PIN** : refresh fiable de la liste après écriture
  - `manager.js` : `addPasscode` attend désormais 1.5 s puis tente jusqu'à 3 fois la lecture `getPassCodes` (avec reconnexion si la serrure s'est déconnectée). Évite de renvoyer une liste vide à l'UI quand l'index firmware n'est pas encore prêt
- **Persistance store** : sauvegardes JSON robustes face aux verrous Windows
  - `store.js` : nouveau helper `fileDataRename` qui retente le `fs.rename` jusqu'à 3 fois en cas d'`EPERM` (antivirus / indexeur qui tient le `.tmp`). Appliqué à `lockData`, `aliasData` et `deviceInfoData`
- **SDK TTLock** : bump `@domodom30/ttlock-sdk-js` `^0.6.0` → `^0.6.3`
- **Frontend** : `CredentialsAll.vue` et `SettingsAll.vue` utilisent `Array.some()` (SonarQube) à la place de `Array.find()` pour la détection d'une serrure dépairée
- **Frontend** : interface Réglages et Identifiants rafraîchies
- **Dev mode** : `api/index.js` honore `process.env.DEV_MODE` pour `handleCredentials`/`handlePasscode`/`handleCard`/`handleFinger` (mock via `WsApi._devSendCredentials`)

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
