# StarTestAll

Послідовний тестер Starlink-мереж для Android: сканує доступні Wi‑Fi мережі,
автоматично перемикається між авторизованими мережами, які зараз у зоні досяжності,
і пише журнал прогонів (швидкість, ping, погода) з експортом у CSV/JSON.

- Package: `com.xsiloflex.startestall`
- Capacitor 6 + ванільний JS, нативний плагін `startestall-wifi`
- Збірка APK — GitHub Actions (`push` у `main` → артефакт `startestall-debug-apk`)

## Можливості

| Вкладка | Що робить |
|---|---|
| **Мережі** | Сканування Wi‑Fi, додавання мереж (мітка, SSID, пароль, тип захисту), список авторизованих мереж з увімк./вимк. та порядком |
| **Прогін** | Запит погодних умов, запуск одного прогону, автоперемикання лише на мережі **в зоні досяжності**, live-результати по кожній мережі |
| **Лог** | Історія прогонів (дата + погода), таблиця результатів, експорт CSV/JSON |

Паролі мереж зберігаються **зашифровано** (EncryptedSharedPreferences + Android Keystore)
і не потрапляють у журнал чи експорт.

## Shizuku

Автоматичне перемикання мереж працює через **Shizuku** (застосунок не може сам
отримати shell-права — це обмеження Android). Один раз:

1. Встановити [Shizuku](https://github.com/RikkaApps/Shizuku/releases) (13.6+).
2. Увімкнути **Параметри розробника → Бездротова налагодження**.
3. У Shizuku натиснути **Start** (через бездротову налагодження).
4. У StarTestAll: «Мережі» → **Дозволити Shizuku**.

Щоб Shizuku піднімався сам після перезавантаження:

```bash
adb shell pm grant moe.shizuku.privileged.api android.permission.WRITE_SECURE_SETTINGS
```

…і в налаштуваннях Shizuku увімкнути **Start on boot** (працює без root на Android 13+).

Без Shizuku доступний ручний режим: застосунок сам підказує, до якої мережі
підключитися, і продовжує тест після підключення.

## Швидкість

- Розмір тесту: 40 / 80 / 150 МБ (типово 40 МБ).
- Download: 4 чанки, Upload: 3 чанки, Ping: 8 замірів (ping/jitter/loss).
- Endpoint: Cloudflare `speed.cloudflare.com`; публічний IP/ISP/вузол — із `cf-meta-*`.

## Збірка

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Ліцензія та підпис

Keystore: `signing/startestall.keystore` (PKCS12, alias `startestall`, пароль `android`).
Ключ у відкритому репозиторії — це компроміс для персонального застосунку;
для публікації в Play перенесіть ключ у GitHub Secrets.
