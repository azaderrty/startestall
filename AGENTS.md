# StarTestAll — стан проєкту

Послідовний тестер Starlink-мереж для Android. Окремий застосунок (не в NetMeter).

## Проєкт
- `/public/startestall` — Capacitor 6 + ванільний JS, package `com.xsiloflex.startestall`.
- Репозиторій: `xsiloflex-cyber/startestall`, remote SSH `git@github.com:xsiloflex-cyber/startestall.git`, branch `main`.
- Нативний плагін `startestall-wifi` → `/public/startestall/plugins/wifi` (підключений як `file:./plugins/wifi`).
- Ключ підпису: `signing/startestall.keystore` (PKCS12, alias `startestall`, пароль `android`) — у відкритому репо.

## Збірка
- Локально немає JDK/gradle → **збірка лише в CI**: push у `main` → `.github/workflows/build-apk.yml`
  (вже в репо) → артефакт `startestall-debug-apk` (APK + `SHA256SUMS.txt`).
- Workflow-файл можна пушити лише через SSH (в токені `gh` немає scope `workflow`).
- Реліз: `gh release create v1.0.0 <apk> SHA256SUMS.txt --prerelease --notes-file ...`.
- Актуальний реліз: v1.0.0 (pre-release) — https://github.com/xsiloflex-cyber/startestall/releases/tag/v1.0.0

## Важливі деталі реалізації
- `plugins/wifi/android/src/main/AndroidManifest.xml` **обов'язково** має `<service>` з
  `com.getcapacitor.Plugin` для `WifiPlugin` і `NetStorePlugin`, інакше нативний плагін
  не реєструється і `window.Capacitor.Plugins.Wifi` буде undefined.
- Shizuku API 13.1.5:
  - `OnRequestPermissionResultListener.onRequestPermissionResult(int, int)` — другой аргумент `int`.
  - `Shizuku.PERMISSION_GRANTED` не існує → `PackageManager.PERMISSION_GRANTED`.
  - `bindUserService(...)` повертає `void`; `UserServiceArgs(ComponentName).daemon(false).version(1)`.
  - AIDL: `void destroy() = 16777114;` (у сервері транзакція 16777115).
- Capacitor `JSObject`: `put(String, Object)` не кидає JSONException, але `JSONObject.put` кидає;
  `JSObject.getInt` (успадкований від JSONObject) кидає JSONException → використовувати `getInteger`.
- `android.net.LinkAddress`: лише `getAddress()` (public); `isIpv4()`/`getType()` — @SystemApi, недоступні.
- `androidx.security:security-crypto:1.0.0`: API — `MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)`
  і `EncryptedSharedPreferences.create(fileName, masterKeyAlias, context, keyScheme, valueScheme)`
  (порядок аргументів саме такий). `MasterKey` з'явився лише у 1.1.0-alpha.
- CapacitorHttp: для POST обов'язковий `Content-Type`, інакше body не надсилається;
  `Uint8Array` ламається TextDecoder → upload відсилається рядком + `Content-Type: text/plain`.

## Логіка застосунку
- Вкладки: Мережі (скан + авторизовані мережі), Прогін (погода, розмір, авто/ручний режим), Лог (історія + CSV/JSON).
- Прогін: скан → `авторизовані ∩ увімкнені ∩ у зоні`; поза зоною → «skipped»; поточна мережа
  тестується без перемикання; після прогону відновлюється попередня мережа.
- Паролі — в EncryptedSharedPreferences, в журнал/експорт не потрапляють.

## Що лишилось / наступні кроки
- Протестувати на пристрої (Lenovo TB310FU, Android 13): скан, підключення через Shizuku
  (`cmd wifi connect-network`), вимірювання, експорт.
- Інструкція для користувача: Shizuku 13.6+ → Start через ADB → у застосунку «Дозволити Shizuku»;
  для автозапуску `adb shell pm grant moe.shizuku.privileged.api android.permission.WRITE_SECURE_SETTINGS`
  + «Start on boot».
- Опублікувати стабільний v1.0.0 після тестів (зараз v1.0.0 — pre-release).
