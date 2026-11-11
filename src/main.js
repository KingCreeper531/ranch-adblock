// Ranch Ad Blocker for Windows: one window with an On/Off switch. Turning it on
// points Windows' DNS at AdGuard's ad-blocking DNS (needs admin, asked each time);
// turning it off puts back exactly what was there before.
const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const { execFile } = require('child_process');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const updater = require('./updater');

const APP_ID = 'local.ranch.adblock';
app.setAppUserModelId(APP_ID);
if (process.env.RANCHAB_USER_DATA) app.setPath('userData', process.env.RANCHAB_USER_DATA);
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
// The switch script must be a real file PowerShell can run, so it ships outside the app archive
const SCRIPT = app.isPackaged
  ? path.join(process.resourcesPath, 'dns.ps1')
  : path.join(__dirname, '..', 'scripts', 'dns.ps1');
const STATE_FILE = () => path.join(app.getPath('userData'), 'previous-dns.json');
const RESULT_FILE = () => path.join(app.getPath('userData'), 'last-switch.json');
const ADGUARD = ['94.140.14.14', '94.140.15.15', '2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff'];
const PROVIDERS = [{ id: 'adguard', name: 'AdGuard DNS', host: 'dns.adguard-dns.com', note: 'Large ad and tracker list.' }];

let win = null;
const log = (m) => { try { fs.appendFileSync(path.join(app.getPath('userData'), 'adblock.log'), `[${new Date().toISOString()}] ${m}\n`); } catch { /* ignore */ } };

function ps(command, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve({ err, out: String(stdout || '') }));
  });
}

/** Which Wi-Fi / Ethernet adapters currently use AdGuard (reading this needs no admin). */
async function readDns() {
  const { out } = await ps('@(Get-NetAdapter -Physical | Where-Object Status -ne "Not Present" | ForEach-Object { [pscustomobject]@{ name = $_.Name; up = ($_.Status -eq "Up"); servers = @((Get-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ErrorAction SilentlyContinue).ServerAddresses) } }) | ConvertTo-Json -Depth 4 -Compress');
  let list = [];
  try { list = JSON.parse(out || '[]'); } catch { /* ignore */ }
  if (!Array.isArray(list)) list = [list];
  return list.map((a) => ({ ...a, servers: [].concat(a.servers || []), adguard: [].concat(a.servers || []).some((s) => ADGUARD.includes(s)) }));
}

async function state(extra = {}) {
  const adapters = await readDns();
  const using = adapters.filter((a) => a.adguard);
  const on = using.length > 0;
  const missing = on ? adapters.filter((a) => !a.adguard).map((a) => a.name) : [];
  return {
    platform: 'windows',
    on,
    provider: 'adguard',
    providers: PROVIDERS,
    activeName: 'AdGuard DNS',
    needsSetup: false,
    networks: using.filter((a) => a.up).length,
    detail: missing.length ? `Not set on: ${missing.join(', ')}. Turn it off and on again to include them.` : '',
    version: app.getVersion(),
    update: updateButton(),
    ...extra,
  };
}

/** Runs dns.ps1 with admin rights. Windows shows its permission prompt. */
function runElevated(mode) {
  try { fs.rmSync(RESULT_FILE(), { force: true }); } catch { /* ignore */ }
  const q = (s) => s.replace(/'/g, "''");
  const inner = `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${SCRIPT}" -Mode ${mode} -StateFile "${STATE_FILE()}" -ResultFile "${RESULT_FILE()}"`;
  const cmd = `try { $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '${q(inner)}'; exit $p.ExitCode } catch { exit 1223 }`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(cmd, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 120000 }, () => {
        let res = null;
        try { res = JSON.parse(fs.readFileSync(RESULT_FILE(), 'utf8').replace(/^ï»¿/, '')); } catch { /* no result: prompt declined */ }
        resolve(res || { ok: false, error: 'Windows didn\'t get permission, so nothing changed.' });
      });
  });
}

let switching = false;
async function setOn(on) {
  if (switching) return state();
  switching = true;
  try {
    const res = await runElevated(on ? 'on' : 'off');
    log(`Switch ${on ? 'on' : 'off'}: ${JSON.stringify(res)}`);
    if (!res.ok) return { error: res.error || 'Couldn\'t change the DNS settings.' };
    const s = await state();
    if (on && res.encrypted === false) s.message = 'On. This Windows version can\'t encrypt DNS, so lookups go to AdGuard unencrypted.';
    return s;
  } finally {
    switching = false;
  }
}

/** Looks up a known ad server through Windows. Blocked = 0.0.0.0 or no answer. */
function test() {
  return new Promise((resolve) => {
    dns.lookup('doubleclick.net', { family: 4 }, (err, address) => {
      if (err) resolve({ blocked: ['ENOTFOUND', 'ENODATA', 'EAI_FAIL'].includes(err.code), detail: err.code === 'ENOTFOUND' ? '' : `Lookup failed (${err.code}). Are you online?` });
      else resolve({ blocked: address === '0.0.0.0', detail: address === '0.0.0.0' ? '' : 'Not blocking yet: ad servers still load. If it\'s on, give Windows a minute or restart your browser.' });
    });
  });
}

// ---------------------------------------------------------------- updates
let up = updater.getState();
function updateButton() {
  if (up.status === 'available') return { version: up.version, label: `Update to ${up.version}` };
  if (up.status === 'downloading') return { version: up.version, label: `Updatingâ€¦ ${up.percent || 0}%` };
  if (up.status === 'ready') return { version: up.version, label: 'Restart to update' };
  if (up.status === 'error' && up.version) return { version: up.version, label: 'Retry update' };
  return null;
}

// ---------------------------------------------------------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 380,
    minHeight: 520,
    title: 'Ranch Ad Blocker',
    icon: ICON,
    backgroundColor: '#0b100c',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'ui', 'index.html'));
}

ipcMain.handle('ab:state', () => state());
ipcMain.handle('ab:set-on', (_e, on) => setOn(!!on));
ipcMain.handle('ab:set-provider', () => state());
ipcMain.handle('ab:test', () => test());
ipcMain.handle('ab:copy', (_e, text) => { clipboard.writeText(String(text || '').slice(0, 500)); return null; });
ipcMain.handle('ab:open', (_e, url) => { if (/^https:\/\/(github\.com|adguard-dns\.io|mullvad\.net)\//.test(String(url))) shell.openExternal(url); return null; });
ipcMain.handle('ab:update', () => { updater.install(); return state(); });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  createWindow();
  updater.init({
    logger: log,
    onChange: (s) => { up = s; state().then((st) => win?.webContents.send('ab:state', st)).catch(() => {}); },
    beforeInstall: () => {},
  });
});
app.on('window-all-closed', () => app.quit());
