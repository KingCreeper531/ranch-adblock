import { useCallback, useEffect, useRef, useState } from 'react';
import AnimatedContent from './react-bits/AnimatedContent.jsx';
import BlurText from './react-bits/BlurText.jsx';
import ClickSpark from './react-bits/ClickSpark.jsx';
import CountUp from './react-bits/CountUp.jsx';
import GradualBlur from './react-bits/GradualBlur.jsx';
import Magnet from './react-bits/Magnet.jsx';
import Noise from './react-bits/Noise.jsx';
import SplitText from './react-bits/SplitText.jsx';
import Topography from './react-bits/Topography.jsx';

const B = window.blocker;
const CREAM = '#efe8d4';

function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="54" height="54" aria-hidden="true">
      <path d="M12 3v8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M6.4 6.6a8 8 0 1 0 11.2 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button className="chip" onClick={async () => { await B.copy(text); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? 'Copied' : label}
    </button>
  );
}

export default function App() {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);       // { text, tone }
  const [test, setTest] = useState(null);     // { text, tone }
  const [testing, setTesting] = useState(false);
  const busyRef = useRef(false);
  const setupRef = useRef(null);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const next = await B.state();
    if (next && !next.error) setS(next);
  }, []);

  useEffect(() => {
    refresh();
    if (B.onState) B.onState((next) => { if (next && !busyRef.current) setS(next); });
    const t = setInterval(refresh, 4000);
    const vis = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refresh]);

  if (!s) return <div className="shell" />;

  const provider = s.providers.find((p) => p.id === s.provider) || s.providers[0];
  const device = s.platform === 'windows' ? 'PC' : 'phone';
  const title = s.on ? 'Blocking ads' : 'Off';
  const lead = s.on
    ? `Every app on this ${device} now uses ${s.activeName || provider.name}, which won't look up ad and tracker servers.`
    : `Turn it on to block ads and trackers in every app on this ${device}.${s.platform === 'windows' ? ' Windows asks for permission first.' : ''}`;

  async function toggle() {
    if (busy) return;
    if (s.needsSetup && !s.on) {
      setupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMsg(null);
    setTest(null);
    const res = await B.setOn(!s.on, s.provider);
    busyRef.current = false;
    setBusy(false);
    if (!res || res.error) { setMsg({ text: (res && res.error) || 'Something went wrong.', tone: 'bad' }); refresh(); return; }
    setS(res);
    if (res.message) setMsg({ text: res.message, tone: 'warn' });
  }

  async function runTest() {
    setTesting(true);
    setTest({ text: 'Looking up an ad server…', tone: '' });
    const r = await B.test();
    setTesting(false);
    if (!r || r.error) setTest({ text: (r && r.error) || 'The test failed.', tone: 'bad' });
    else if (r.blocked) setTest({ text: 'Working. Ad servers are blocked on this device.', tone: 'ok' });
    else setTest({ text: r.detail || 'Not blocking yet. Ad servers still load.', tone: 'warn' });
  }

  const label = busy ? 'Working…' : s.on ? 'Turn off' : s.needsSetup ? 'Set it up' : 'Turn on';

  return (
    <div className={`shell${s.on ? ' is-on' : ''}`}>
      <div className="backdrop" aria-hidden="true">
        <Topography
          key={s.on ? 'on' : 'off'}
          color={s.on ? '#356b33' : '#2a322b'}
          lineCount={24}
          lineWidth={1}
          glow={0}
          fog={0.6}
          brightness={s.on ? 1 : 0.7}
          speed={s.on ? 0.16 : 0.05}
          clickEffect="none"
          intro={false}
        />
      </div>
      <Noise opacity={0.06} fps={8} contrast={0.5} blendMode="overlay" fixed zIndex={1} />

      <header className="topbar">
        <div className="brand">
          <img src="./icon.png" alt="" />
          <span>Ad Blocker</span>
        </div>
        {s.update && (
          <button className="update-pill" onClick={async () => setS(await B.update())}>{s.update.label || `Update to ${s.update.version}`}</button>
        )}
      </header>

      <main className="scroll">
        <section className="hero">
          <ClickSpark sparkColor={CREAM} sparkSize={10} sparkRadius={34} sparkCount={9} duration={460} disabled={busy}>
            <Magnet padding={60} magnetStrength={5} maxOffset={10} disabled={busy}>
              <button
                className={`power${s.on ? ' on' : ''}${busy ? ' busy' : ''}`}
                onClick={toggle}
                disabled={busy}
                aria-pressed={s.on}
                aria-label={label}
              >
                <PowerIcon />
              </button>
            </Magnet>
          </ClickSpark>

          <SplitText key={title} text={title} tag="h1" className="status" splitType="chars" delay={30} duration={0.6} trigger="mount" />
          <BlurText key={lead} text={lead} className="lead" animateBy="words" delay={18} stepDuration={0.25} trigger="mount" />
          <button className="action" onClick={toggle} disabled={busy}>{label}</button>
          {msg && <p className={`msg ${msg.tone}`}>{msg.text}</p>}

          {s.on && typeof s.networks === 'number' && s.networks > 0 && (
            <p className="stat"><CountUp to={s.networks} duration={0.8} trigger="mount" /> {s.networks === 1 ? 'network' : 'networks'} protected</p>
          )}
        </section>

        {s.needsSetup && !s.on && (
          <AnimatedContent trigger="mount" distance={20} duration={0.5} delay={0.1}>
            <section className="card" ref={setupRef}>
              <p className="kicker">One-time setup</p>
              <h2>Turn on Private DNS</h2>
              <ol>
                <li>Tap <b>Copy and open settings</b>.</li>
                <li>Open <b>Private DNS</b>. It's under Network &amp; internet, or Connections → More connection settings on Samsung.</li>
                <li>Pick <b>Private DNS provider hostname</b>, paste, and tap <b>Save</b>.</li>
              </ol>
              <code>{provider.host}</code>
              <div className="row">
                <button className="chip strong" onClick={async () => { await B.copy(provider.host); await B.openPrivateDns(); }}>Copy and open settings</button>
                <CopyButton text={provider.host} label="Copy only" />
              </div>
              <h3>Prefer a one-tap switch?</h3>
              <p className="small">Connect the phone to a computer with USB debugging on and run this once. After that, the button turns blocking on and off by itself.</p>
              <code>{s.adbCommand}</code>
              <div className="row"><CopyButton text={s.adbCommand} label="Copy command" /></div>
            </section>
          </AnimatedContent>
        )}

        {s.providers.length > 1 && (
          <AnimatedContent trigger="mount" distance={20} duration={0.5} delay={0.15}>
            <section className="card">
              <p className="kicker">Blocklist</p>
              {s.providers.map((p) => (
                <label key={p.id} className={`choice${p.id === s.provider ? ' picked' : ''}`}>
                  <input
                    type="radio"
                    name="provider"
                    checked={p.id === s.provider}
                    onChange={async () => { const r = await B.setProvider(p.id); if (r && !r.error) setS(r); }}
                  />
                  <span><b>{p.name}</b><small>{p.note}</small></span>
                </label>
              ))}
            </section>
          </AnimatedContent>
        )}

        <AnimatedContent trigger="mount" distance={20} duration={0.5} delay={0.2}>
          <section className="card">
            <div className="row spread">
              <span><b>Test it</b><small>Looks up a known ad server from this {device}</small></span>
              <button className="chip" onClick={runTest} disabled={testing}>Test</button>
            </div>
            {test && <p className={`msg ${test.tone}`}>{test.text}</p>}
          </section>
        </AnimatedContent>

        <p className="footnote">
          Ads are blocked by refusing to look up ad servers, in every app and browser. YouTube and Twitch video ads come
          from the same servers as the videos, so they still play; the Ranch YouTube app removes those.
        </p>
        <p className="footnote version">Version {s.version}</p>
        <GradualBlur position="bottom" target="page" height="3rem" strength={1.2} layers={5} zIndex={3} />
      </main>
    </div>
  );
}
