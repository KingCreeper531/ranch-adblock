// The Windows app provides window.blocker in its preload. On Android the app
// provides window.BlockerNative (synchronous, returns JSON); wrap it the same way.
if (!window.blocker && window.BlockerNative) {
  const call = (name, ...args) => new Promise((resolve) => setTimeout(() => {
    try {
      resolve(JSON.parse(window.BlockerNative[name](...args.map(String)) || 'null'));
    } catch (e) {
      resolve({ error: String((e && e.message) || e) });
    }
  }, 0));
  window.blocker = {
    state: () => call('state'),
    setOn: (on, provider) => call('setOn', on ? '1' : '0', provider || ''),
    setProvider: (id) => call('setProvider', id),
    test: () => call('test'),
    openPrivateDns: () => call('openPrivateDns'),
    copy: (text) => call('copy', text),
    open: (url) => call('open', url),
    update: () => call('update'),
  };
}

// Browser preview (npm run dev): a fake device so the screen can be worked on
if (!window.blocker) {
  let s = {
    platform: 'android', on: false, provider: 'adguard', needsSetup: true, version: 'dev', update: null,
    adbCommand: 'adb shell pm grant io.github.kingcreeper531.ranchadblock android.permission.WRITE_SECURE_SETTINGS',
    providers: [
      { id: 'adguard', name: 'AdGuard DNS', host: 'dns.adguard-dns.com', note: 'Largest ad and tracker list.' },
      { id: 'mullvad', name: 'Mullvad DNS', host: 'adblock.dns.mullvad.net', note: 'Keeps no logs. Smaller list.' },
    ],
  };
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 400));
  window.blocker = {
    state: () => wait(s),
    setOn: (on) => wait((s = { ...s, on, needsSetup: false })),
    setProvider: (id) => wait((s = { ...s, provider: id })),
    test: () => wait({ blocked: s.on }),
    openPrivateDns: () => wait(null),
    copy: () => wait(null),
    open: () => wait(null),
    update: () => wait(s),
  };
}