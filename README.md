# Ranch Ad Blocker

Blocks ads and trackers in every app and browser on your PC or phone, with one switch. It doesn't use a VPN and doesn't run in the background. It switches your device to an ad-blocking DNS service, which refuses to look up ad and tracker servers. Part of the Ranch apps; install and update it yourself or through the [Ranch Launcher](https://github.com/KingCreeper531/ranch-launcher).

| | How it works |
|---|---|
| **Windows** | Press the switch. Windows asks for permission, then the app points your Wi-Fi and Ethernet at [AdGuard DNS](https://adguard-dns.io), encrypted on Windows 11. Your old DNS settings are remembered, and turning it off puts them back exactly. If AdGuard doesn't answer, the app undoes the change by itself. |
| **Android 9+** | Uses Android's built-in **Private DNS** (encrypted). Pick AdGuard DNS or [Mullvad DNS](https://mullvad.net/en/help/dns-over-https-and-dns-over-tls) (no logs). The app walks you through the setting once, or, after one USB command, turns it on and off by itself. |
| **iPhone / iPad** | Install one of the DNS profiles from the release (AdGuard or Mullvad). Encrypted, and works in every app. |

**What it can't block:** YouTube and Twitch video ads come from the same servers as the videos, so DNS blocking can't remove them. The [Ranch YouTube app](https://github.com/KingCreeper531/youtube-desktop) removes YouTube's ads.

**Privacy:** the DNS service you pick sees which websites your device looks up (not what's on them). Mullvad says it keeps no logs.

## Download

Get the latest release from the [Releases page](https://github.com/KingCreeper531/ranch-adblock/releases/latest).

### Windows

Run `Ranch-AdBlock-Setup-x.y.z.exe`, then press the switch. Use **Test** to check it's blocking. Windows SmartScreen may warn because the app isn't code-signed: click **More info**, then **Run anyway**.

### Android

Install `Ranch-AdBlock-Android-x.y.z.apk` and open it. Android only lets the system settings change Private DNS, so the first time there are two ways:

- **Settings (no computer):** tap **Copy and open settings**, open **Private DNS**, choose **Private DNS provider hostname**, paste, and save.
- **One-tap switch:** with USB debugging on, run this once from a computer. After that, the app's button turns blocking on and off by itself:

  ```
  adb shell pm grant io.github.kingcreeper531.ranchadblock android.permission.WRITE_SECURE_SETTINGS
  ```

### iPhone / iPad

1. On the phone, open the release page in **Safari** and tap `Ranch-AdBlock-iOS-AdGuard.mobileconfig` (or the Mullvad one), then **Allow**.
2. Open **Settings**, tap **Profile Downloaded**, then **Install**.
3. If it's not on yet, go to **Settings > General > VPN & Device Management > DNS** and pick it.

To remove it, delete the profile under **Settings > General > VPN & Device Management**.

## Build it yourself

```
npm install
npm start           # build the screen and run the Windows app
npm run dist        # Windows installer into dist/
npm run release     # Windows + Android + iPhone profiles, published to GitHub (needs the GitHub CLI)
```

The screen (`renderer/`) is React with components from [React Bits](https://github.com/DavidHDev/react-bits) (see `renderer/src/react-bits/LICENSE.md`). It's shared by the Windows app (Electron) and the Android app (`android/`, a WebView).
