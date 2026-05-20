# Changelog

## [1.9.23] - 2026-05-20

### Icône anomalie de capteur dans le journal d'activité

- **Catégorie ALARM** : `_enrichOperation()` dans `manager.js` mappe maintenant `LogOperateCategory.ALARM` (DOOR_SENSOR_ANOMALY, TAMPER_ALARM, LOW_BATTERY_ALARM…) vers `recordTypeCategory = 'ALARM'` au lieu de `'OTHER'`
- **Icône `mdi-shield-lock-open`** : les entrées ALARM affichent l'icône en orange dans `OperationsAll.vue` et `Operations.vue`

## [1.9.22] - 2026-05-20

### AppTopBar : icône gateway unique avec menu déroulant

- **Refonte de la zone gateway** : le chip + 2 boutons séparés sont remplacés par une seule icône cliquable. Icône verte (`mdi-lan-connect`) si connecté, rouge (`mdi-lan-disconnect`) si déconnecté, orange (`mdi-help-network`) sinon. Spinner si une opération est en cours
- **Menu déroulant** : un clic ouvre un `v-menu` avec deux actions — *Reconnecter le gateway* et *Redémarrer la passerelle ESP32* — désactivées pendant une opération en cours
- **Tooltip au survol** : conserve le texte d'état (host si connecté, message d'erreur sinon)

## [1.9.21] - 2026-05-20

### Fix : détection de fin de reboot ESP32 — reconnexion noble WS forcée

- **Cause racine** : le TCP du noble WebSocket (addon ↔ ESP32) reste "accroché" après le reboot car le protocole noble n'a pas de ping/pong applicatif. `_setGatewayStatus('disconnected')` ne se déclenchait jamais → `_esp32RebootPending` restait `true` → spinner 60s, aucune notification
- **Reconnexion forcée** : `rebootEsp32()` — après un succès (ECONNRESET ou HTTP 200), programme `ws.reconnect()` après 2 s. Force le cycle `close → open` sur le noble WS → `_setGatewayStatus('disconnected')` puis `'connected'` → `_esp32RebootPending = false` → snackbar *Passerelle ESP32 redémarrée*
- **Déduplication** : `rebootEsp32()` retourne immédiatement si `_esp32RebootPending` est déjà vrai (empêche un double-reboot si deux clients WS envoient la commande en même temps)
- **`settle()` one-shot** : remplace les `resolve()/this._esp32RebootPending=true` en doublon. Empêche le cas où `req.destroy()` (timeout) émet lui-même ECONNRESET et poserait faussement `_esp32RebootPending = true`
- **Fail-fast `_connectLock` corrigé** : le guard `_esp32RebootPending` attend maintenant que le flag redevienne `false` (plutôt que `_waitForGatewayReady` qui retournait `true` immédiatement si `gatewayStatus === 'connected'`)

## [1.9.20] - 2026-05-20

### Fail-fast BLE + résilience WS pendant le reboot ESP32

- **Fail-fast `_connectLock` pendant le reboot** : `manager.js` — quand `_esp32RebootPending = true`, `_connectLock` appelle `_waitForGatewayReady(20000)` avant de tenter la connexion BLE. L'ESP32 met 10-15s à redémarrer ; pendant cette fenêtre le gateway est encore marqué `connected` mais les connexions BLE échouent. Le guard attend silencieusement le retour du gateway au lieu de logguer `newEvents: échec #1`
- **`clearWaitingFlags` ne touche plus `waitingEsp32Reboot`** : `store/index.js` — si le WS frontend↔addon se coupe pendant le reboot (redémarrage HA, ingress), le flag reste actif. Le spinner persiste et la notice `Passerelle ESP32 redémarrée` s'affiche bien quand le gateway revient en ligne. Nettoyage assuré par `setGatewayStatus('connected')` (chemin normal) ou le timeout 60s de sécurité

## [1.9.19] - 2026-05-20

### Notification de fin de reboot ESP32

- **Log backend** : quand la passerelle revient en ligne après un reboot ESP32, `_setGatewayStatus('connected')` détecte le flag `_esp32RebootPending` et affiche `[Gateway] ESP32 redémarré — passerelle de retour en ligne` (à la place du message d'état générique)
- **Snackbar frontend** : la mutation `setGatewayStatus('connected')` pousse automatiquement la notice `notices.gateway.esp32RebootComplete` quand `waitingEsp32Reboot` était actif — `Notices.vue` affiche un snackbar vert *"Passerelle ESP32 redémarrée — connexion rétablie"* (fr) / *"ESP32 gateway rebooted — connection restored"* (en)
- **Couches impactées** : `manager.js` (`_esp32RebootPending`, `rebootEsp32`, `_setGatewayStatus`), `store/index.js` (mutation `setGatewayStatus`), locales fr/en (`notices.gateway.esp32RebootComplete`)

## [1.9.18] - 2026-05-20

### Fix : spinner ESP32 reboot — rester actif jusqu'à la reconnexion complète

- **Spinner prolongé** : `_onEsp32Reboot` ne vide plus `waitingEsp32Reboot` sur succès HTTP. Le spinner reste actif jusqu'à ce que `gatewayStatus` redevienne `'connected'` (signal naturel de fin de reboot, ~10-15s). Timeout de sécurité à 60s si l'ESP32 ne revient pas
- **Bouton reconnect désactivé** pendant le reboot ESP32 : `:disabled="isRebootingEsp32"` sur le bouton `mdi-lan-pending` empêche l'utilisateur de cliquer sur "reconnecter gateway" pendant que l'ESP32 reboot, évitant les `restartGateway` involontaires observés dans les logs
- **`setGatewayStatus('connected')` efface `waitingEsp32Reboot`** dans la mutation Vuex : quand le WS se reconnecte après le reboot, le flag est automatiquement vidé

## [1.9.17] - 2026-05-20

### Bouton "Redémarrer la passerelle ESP32" dans AppTopBar

- **Nouveau bouton `mdi-restart`** : quand un gateway noble est configuré, un bouton de redémarrage matériel apparaît à côté du bouton de reconnexion WS. Un clic envoie un `GET https://gateway_host:443/restart` avec Basic Auth (credentials de la config gateway). L'ESP32 répond 200 puis exécute `ESP.restart()` après 2 itérations de loop
- **Certificat auto-signé** : la requête HTTPS utilise `rejectUnauthorized: false` (cert auto-généré côté ESP32, comportement standard)
- **Spinner** : couvre uniquement la phase HTTP (1-5s) ; la puce gateway affiche ensuite le cycle `disconnected → connecting → connected` automatiquement via les mécanismes existants
- **Retour d'erreur** : si l'ESP32 est inaccessible ou les credentials incorrects, un snackbar d'erreur est affiché
- **Aucune modification côté ESP32** : l'endpoint `/restart` est déjà présent dans `web.cpp`
- **Couches impactées** : `manager.rebootEsp32()` (import `node:https`), `WsApi.sendEsp32Reboot()`, `case 'rebootEsp32'` dans le dispatcher, `api.rebootEsp32()` + `_onEsp32Reboot()` (frontend), store (`waitingEsp32Reboot`), `AppTopBar.vue`, locales fr/en

## [1.9.16] - 2026-05-20

### Bouton "Reconnecter le gateway" dans AppTopBar

- **Nouveau bouton dans la barre** : quand un gateway noble est configuré, un bouton `mdi-lan-pending` apparaît à côté de la puce gateway. Un clic force une reconnexion WebSocket (via `ws.reconnect()` sur le socket RWS interne) sans redémarrer l'addon ni l'ESP32
- **Indicateur de progression** : le bouton affiche un spinner pendant la reconnexion (jusqu'à 15 s) et se remet à jour automatiquement via le statut gateway existant
- **Retour d'erreur** : si le gateway ne répond pas dans les 15 s, un snackbar d'erreur est affiché
- **Couches impactées** : `manager.restartGateway()` (backend), `WsApi.sendGatewayRestart()`, `case 'restartGateway'` dans le dispatcher, `api.restartGateway()` + `_onGatewayRestart()` (frontend), store (`waitingGatewayRestart`), `AppTopBar.vue`, locales fr/en

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
