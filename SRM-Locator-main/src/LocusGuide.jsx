import React, { useState, useEffect } from 'react';

// Boot sequence lines only reference features that actually exist in the app —
// no AI/Oracle claims (that feature was intentionally removed, see App.jsx history).
const BOOT_SEQUENCE = [
  "> INITIALIZING LOCUS NETWORK...",
  "> AUTH NODE v4.0 ONLINE",
  "> SCANNING CREDENTIALS...",
  "> IDENTITY VERIFIED: OPERATIVE",
  "> CONNECTING TO SRM KTR GRID...",
  "  [████████████████████] 100%",
  "> SQUAD MATRIX: ONLINE",
  "> DEAD RECKONING ENGINE: ACTIVE",
  "> AR COMPASS: CALIBRATED",
  "> ALL SYSTEMS NOMINAL",
  "  WELCOME TO LOCUS, OPERATIVE."
];

const FAQS = [
  { q: "How accurate is the GPS tracking?", a: "LOCUS applies a Kalman filter to raw GPS sensor data, smoothing erratic phone sensor noise. Accuracy is within 3–5 meters under open sky." },
  { q: "Can the Commander track me without my knowledge?", a: "No. You control your broadcast mode at all times. FROZEN locks your avatar in place, GHOST removes you from the map entirely." },
  { q: "What happens to my location data when I close the app?", a: "Your live telemetry session ends on app close. The system records your last known ping position, visible to squad members as an offline marker." },
  { q: "How do Secret Routes work?", a: "Secret Routes are custom path overlays recorded and published by administrators. They bypass standard walking paths and show the actual fastest shortcuts." },
];

const NAV_LINKS = [
  { href: '#start', label: 'Start' },
  { href: '#features', label: 'Features' },
  { href: '#modes', label: 'Stealth' },
  { href: '#access', label: 'Access' },
  { href: '#sos', label: 'SOS' },
  { href: '#faq', label: 'FAQ' },
];

// Small reusable corner-bracket decoration used on panels throughout App.jsx
// (see e.g. the SECURE_CHANNEL auth card) — reused here for visual continuity.
const CornerBrackets = () => (
  <>
    <div className="absolute top-0 left-0 w-2 h-2 bg-white" />
    <div className="absolute top-0 right-0 w-2 h-2 bg-white" />
    <div className="absolute bottom-0 left-0 w-2 h-2 bg-white" />
    <div className="absolute bottom-0 right-0 w-2 h-2 bg-white" />
  </>
);

const SectionHeader = ({ n, title }) => (
  <div className="reveal mb-12 flex items-baseline gap-6">
    <span className="font-dot text-xs text-zinc-600 tracking-widest">{n}</span>
    <span className="locus-glitch font-dot text-2xl uppercase tracking-widest text-white" data-text={title}>{title}</span>
    <div className="flex-1 h-px bg-white/20" />
  </div>
);

const LocusGuide = ({ onInitialize }) => {
  const [booting, setBooting] = useState(true);
  const [bootLines, setBootLines] = useState([]);
  const [stealthMode, setStealthMode] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState('0%');
  const [openFaq, setOpenFaq] = useState(null);

  // --- TERMINAL BOOT EFFECT ---
  useEffect(() => {
    let currentLine = 0;
    let finishTimeout = null;
    const interval = setInterval(() => {
      if (currentLine < BOOT_SEQUENCE.length) {
        setBootLines(prev => [...prev, BOOT_SEQUENCE[currentLine]]);
        currentLine++;
      } else {
        clearInterval(interval);
        finishTimeout = setTimeout(() => setBooting(false), 800);
      }
    }, 300);
    return () => {
      clearInterval(interval);
      clearTimeout(finishTimeout);
    };
  }, []);

  // --- SCROLL & REVEAL ---
  useEffect(() => {
    const handleScroll = () => {
      const totalScroll = document.documentElement.scrollTop;
      const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      setScrollProgress(windowHeight > 0 ? `${(totalScroll / windowHeight) * 100}%` : '0%');
    };
    window.addEventListener('scroll', handleScroll);

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('vis');
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.08 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    return () => {
      window.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [booting]);

  const toggleFaq = (index) => setOpenFaq(openFaq === index ? null : index);

  // --- RENDER BOOT SCREEN ---
  if (booting) {
    return (
      <div className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center p-6">
        <div className="relative border border-white/20 bg-black px-10 py-10 w-full max-w-lg">
          <CornerBrackets />
          <p className="absolute -top-2.5 left-5 bg-black px-2 font-dot text-[10px] tracking-widest text-red-500">
            LOCUS // AUTH NODE v4.0
          </p>
          <div className="min-h-[220px] font-inter text-[13px] leading-loose">
            {bootLines.map((line, i) => (
              <div key={i} className={line?.includes('100%') || line?.includes('WELCOME') ? 'text-red-500' : 'text-zinc-400'}>
                {line}
              </div>
            ))}
            <span
              className="inline-block w-2 h-3.5 bg-red-500 ml-1 align-middle"
              style={{ animation: 'locus-guide-cursor-blink 1s step-end infinite' }}
            />
          </div>
        </div>
        <button
          onClick={() => setBooting(false)}
          className="mt-6 font-dot text-[10px] uppercase tracking-widest text-zinc-600 hover:text-red-500 transition-colors"
        >
          [ skip intro ]
        </button>
      </div>
    );
  }

  // --- RENDER MAIN GUIDE ---
  return (
    <div
      className="relative min-h-screen w-full bg-black text-white bg-dots cursor-crosshair overflow-x-hidden"
      style={{ filter: stealthMode ? 'grayscale(1)' : 'grayscale(0)', transition: 'filter 0.5s' }}
    >
      {/* SCROLL PROGRESS */}
      <div className="fixed top-0 left-0 h-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] z-[10000] transition-[width] duration-75" style={{ width: scrollProgress }} />

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-[500] flex items-center justify-between h-14 px-6 md:px-10 bg-black/95 backdrop-blur-md border-b border-white/20">
        <div className="font-dot text-sm tracking-widest text-white">
          LOCUS <span className="text-zinc-600 text-[10px]">V 4.0</span>
        </div>
        <ul className="hidden md:flex items-center gap-7 list-none">
          {NAV_LINKS.map(link => (
            <li key={link.href}>
              <a href={link.href} className="font-dot text-[11px] uppercase tracking-widest text-zinc-500 hover:text-red-500 transition-colors">
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStealthMode(!stealthMode)}
            className="font-dot text-[9px] uppercase tracking-widest px-3 py-1.5 border border-white/20 text-zinc-400 hover:text-red-500 hover:border-red-500/50 transition-colors"
          >
            {stealthMode ? '● Tactical' : '○ Stealth'}
          </button>
          <div className="hidden sm:flex items-center gap-2 font-dot text-[10px] uppercase tracking-widest text-zinc-600">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Online
          </div>
          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="md:hidden flex flex-col gap-1 p-2"
          >
            <span className={`block w-5 h-px bg-white transition-transform ${mobileNavOpen ? 'translate-y-1.5 rotate-45' : ''}`} />
            <span className={`block w-5 h-px bg-white transition-opacity ${mobileNavOpen ? 'opacity-0' : ''}`} />
            <span className={`block w-5 h-px bg-white transition-transform ${mobileNavOpen ? '-translate-y-1.5 -rotate-45' : ''}`} />
          </button>
        </div>
      </nav>

      {mobileNavOpen && (
        <div className="md:hidden fixed top-14 left-0 right-0 z-[490] bg-black/98 backdrop-blur-md border-b border-white/20 flex flex-col gap-5 p-6">
          {NAV_LINKS.map(link => (
            <a key={link.href} href={link.href} onClick={() => setMobileNavOpen(false)} className="font-dot text-xs uppercase tracking-widest text-zinc-400 hover:text-red-500">
              {link.label}
            </a>
          ))}
        </div>
      )}

      {/* HERO */}
      <div id="hero" className="relative z-[1] min-h-screen flex flex-col items-center justify-center text-center px-6 pt-28 pb-16 overflow-hidden">
        <div className="absolute w-[420px] h-[420px] rounded-full border border-white/[0.08]" style={{ animation: 'locus-guide-ring-spin 30s linear infinite' }} />
        <div className="absolute w-[620px] h-[620px] rounded-full border border-red-500/[0.06]" style={{ animation: 'locus-guide-ring-spin 50s linear infinite reverse' }} />
        <div className="absolute w-[820px] h-[820px] rounded-full border border-white/[0.04]" style={{ animation: 'locus-guide-ring-spin 80s linear infinite' }} />

        <p className="relative font-dot text-[11px] uppercase tracking-[0.3em] text-red-500 mb-6">// SRM KTR Campus Network //</p>
        <h1 className="locus-glitch relative font-dot uppercase leading-none text-[clamp(3.5rem,10vw,7rem)] tracking-widest text-white drop-shadow-[0_0_40px_rgba(239,68,68,0.35)] mb-2" data-text="LOCUS">
          LOCUS
        </h1>
        <p className="relative font-dot text-[11px] uppercase tracking-widest text-zinc-600 mb-8">
          V 4.0 &nbsp;·&nbsp; Tactical Positioning &nbsp;·&nbsp; Decentralized
        </p>
        <p className="relative font-inter text-lg font-light text-zinc-400 max-w-xl leading-relaxed mb-10">
          A hyper-accurate <strong className="font-medium text-white">tactical tracking network</strong> for squads navigating the SRM KTR campus. Real-time telemetry. Predictive routing. One-tap emergency alerts.
        </p>
        <div className="relative flex gap-4 flex-wrap justify-center">
          <button onClick={onInitialize} className="px-8 py-3 bg-red-500 text-white font-dot text-xs uppercase tracking-widest hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-colors">
            Initialize Secure Link
          </button>
          <a href="#start" className="px-8 py-3 border border-white/30 text-white font-dot text-xs uppercase tracking-widest hover:bg-white hover:text-black transition-colors">
            Explore Systems
          </a>
        </div>
      </div>

      {/* STATS */}
      <div className="reveal relative z-[1] grid grid-cols-2 md:grid-cols-4 gap-px bg-white/10 border-y border-white/10">
        {[
          { v: '<70ms', l: 'Sync Latency' },
          { v: '3', l: 'Stealth Modes' },
          { v: '360°', l: 'Campus Coverage' },
          { v: 'AR', l: 'Compass Tracking' },
        ].map(s => (
          <div key={s.l} className="bg-black text-center py-6 px-4">
            <span className="block font-dot text-xl text-red-500">{s.v}</span>
            <span className="block font-dot text-[10px] uppercase tracking-widest text-zinc-600 mt-1">{s.l}</span>
          </div>
        ))}
      </div>

      {/* GETTING STARTED */}
      <section id="start" className="relative z-[1] max-w-5xl mx-auto px-6 py-24">
        <SectionHeader n="01" title="Getting Started" />
        <div className="reveal grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-white/10 border border-white/10">
          {[
            { icon: '🔐', step: 'STEP_01', title: 'Authenticate', desc: 'Sign in via Google OAuth or create an independent ID. Tactical avatars auto-assigned.' },
            { icon: '📡', step: 'STEP_02', title: 'Join a Channel', desc: 'Enter a squad channel. The Commander reviews and grants your handshake request.' },
            { icon: '🗺️', step: 'STEP_03', title: 'Go Live', desc: 'See all connected squad members, speed, battery, and ping on the tactical map.' },
            { icon: '🎯', step: 'STEP_04', title: 'AR Track', desc: 'Point your camera at a target and follow the live compass bearing straight to it.' },
          ].map(s => (
            <div key={s.step} className="group bg-black p-8 relative overflow-hidden hover:bg-zinc-950 transition-colors">
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500 scale-x-0 group-hover:scale-x-100 origin-left transition-transform" />
              <span className="text-3xl mb-4 block">{s.icon}</span>
              <span className="font-dot text-[11px] tracking-widest text-red-500 mb-3 block">{s.step}</span>
              <h3 className="font-dot text-sm uppercase tracking-widest text-white mb-3">{s.title}</h3>
              <p className="font-inter text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CORE SYSTEMS */}
      <section id="features" className="relative z-[1] max-w-5xl mx-auto px-6 py-24">
        <SectionHeader n="02" title="Core Systems" />
        <div className="reveal flex flex-col gap-px bg-white/10 border border-white/10">
          {[
            { label: 'Squad Matrix', desc: <>Live HUD displaying every connected node — their <strong className="text-white font-medium">GPS coordinates, speed, battery level, and ping</strong>.</> },
            { label: 'Dead Reckoning', desc: <>Lost signal? LOCUS projects a <strong className="text-white font-medium">Ghost Marker</strong> based on last known heading, speed, and time offline.</> },
            { label: 'Tactical Routing', desc: <>Admins unlock <strong className="text-white font-medium">Secret Routes</strong> — custom shortcut paths hidden from standard maps for the fastest lines.</> },
            { label: 'Geofence Alerts', desc: <>Define a perimeter. When a squad member <strong className="text-white font-medium">breaches or departs</strong> the boundary, alerts fire instantly.</> },
          ].map(f => (
            <div key={f.label} className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-px bg-white/10">
              <div className="bg-black px-7 py-6 flex items-center gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                <span className="font-dot text-[11px] uppercase tracking-widest text-red-500">{f.label}</span>
              </div>
              <div className="bg-black px-7 py-6">
                <p className="font-inter text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* STEALTH MODES */}
      <section id="modes" className="relative z-[1] max-w-5xl mx-auto px-6 py-24">
        <SectionHeader n="03" title="Stealth Controls" />
        <div className="reveal grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/10 border border-white/10">
          {[
            { dot: 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)]', label: 'Active', color: 'text-emerald-500', desc: 'Standard broadcast. Real-time location visible to squad.' },
            { dot: 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]', label: 'Frozen', color: 'text-blue-400', desc: 'Locks your avatar at your last position. You move freely offline.' },
            { dot: 'bg-zinc-600', label: 'Ghost', color: 'text-zinc-400', desc: 'Full dark mode. Vanish from the map entirely.' },
          ].map(m => (
            <div key={m.label} className="bg-black p-8 text-center hover:bg-zinc-950 transition-colors">
              <div className={`w-3.5 h-3.5 rounded-full mx-auto mb-4 ${m.dot}`} />
              <h3 className={`font-dot text-xs uppercase tracking-[0.25em] font-bold mb-3 ${m.color}`}>{m.label}</h3>
              <p className="font-inter text-[13px] text-zinc-500 leading-relaxed">{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ACCESS CONTROL */}
      <section id="access" className="relative z-[1] max-w-5xl mx-auto px-6 py-24">
        <SectionHeader n="04" title="Access Control" />
        <div className="reveal grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/10 border border-white/10">
          {[
            { icon: '🔑', title: 'Auth Node', desc: 'Secure gateway. No anonymous nodes permitted.' },
            { icon: '⏳', title: 'Waiting Room', desc: 'Join requests held until Commander manually approves.' },
            { icon: '🛡️', title: 'Commander', desc: 'Owner controls approvals and can blacklist rogue nodes.' },
          ].map(a => (
            <div key={a.title} className="bg-black p-7 hover:bg-zinc-950 transition-colors">
              <div className="w-10 h-10 border border-white/20 flex items-center justify-center text-lg mb-4">{a.icon}</div>
              <h3 className="font-dot text-xs uppercase tracking-widest text-white mb-2">{a.title}</h3>
              <p className="font-inter text-[13px] text-zinc-500 leading-relaxed">{a.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* EMERGENCY PROTOCOL */}
      <section id="sos" className="relative z-[1] max-w-5xl mx-auto px-6 py-24">
        <SectionHeader n="05" title="Emergency Protocol" />
        <div className="reveal relative border border-red-500/40 bg-red-500/[0.04] p-10 overflow-hidden">
          <span className="absolute top-4 right-6 font-dot text-[9px] uppercase tracking-widest text-red-500/50">SOS Trigger</span>
          <h3 className="font-dot text-lg uppercase tracking-widest text-red-500 mb-4">⚠ Press-and-Hold Distress Beacon</h3>
          <p className="font-inter text-sm text-zinc-400 leading-relaxed max-w-2xl">
            Arm the SOS button with a press-and-hold, then confirm with a second press-and-hold within four seconds —
            a deliberate two-step gesture so it can never fire by accident in your pocket. Once confirmed, it
            broadcasts a <strong className="text-white font-medium">high-priority distress beacon with your live coordinates</strong> to
            your squad, triggering a native push notification and sonar alarm on every receiving device.
          </p>
        </div>
      </section>

      {/* CAMPUS NODES */}
      <section id="campus" className="relative z-[1] max-w-5xl mx-auto px-6 py-24">
        <SectionHeader n="06" title="Campus Nodes" />
        <div className="reveal grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/10 border border-white/10">
          {[
            { name: 'University Building', tag: 'ADMIN // PRIMARY', color: 'bg-red-500' },
            { name: 'Java Green', tag: 'FOOD // HIGH TRAFFIC', color: 'bg-amber-500' },
            { name: 'T.P. Ganesan', tag: 'AUDITORIUM // EVENT', color: 'bg-cyan-400' },
            { name: 'Tech Park', tag: 'LABS // SIGNAL WEAK', color: 'bg-red-500' },
          ].map(n => (
            <div key={n.name} className="bg-black p-6 hover:bg-zinc-950 transition-colors">
              <div className={`w-2 h-2 rounded-full mb-3 ${n.color}`} />
              <div className="font-dot text-[11px] uppercase tracking-widest text-white mb-1.5">{n.name}</div>
              <div className="font-dot text-[9px] uppercase tracking-widest text-zinc-600">{n.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative z-[1] max-w-5xl mx-auto px-6 py-24">
        <SectionHeader n="07" title="FAQ // Command Log" />
        <div className="reveal flex flex-col gap-px bg-white/10 border border-white/10">
          {FAQS.map((item, i) => (
            <div key={item.q} className="bg-black">
              <button onClick={() => toggleFaq(i)} className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-zinc-950 transition-colors">
                <span className="font-inter text-[13px] text-zinc-300"><span className="text-zinc-600">{'> '}</span>{item.q}</span>
                <span className={`text-zinc-600 transition-transform shrink-0 ${openFaq === i ? 'rotate-90 text-red-500' : ''}`}>›</span>
              </button>
              <div className={`overflow-hidden transition-[max-height] duration-400 ${openFaq === i ? 'max-h-52' : 'max-h-0'}`}>
                <p className="font-inter text-[13px] text-zinc-500 leading-relaxed px-6 pb-5 border-t border-white/10 pt-4">{item.a}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative z-[1] border-t border-white/20 bg-black/90 px-8 py-8 flex flex-wrap items-center justify-between gap-4">
        <div className="font-dot text-sm tracking-widest text-white">LOCUS</div>
        <div className="font-dot text-[10px] uppercase tracking-widest text-zinc-600">SRM KTR Campus Network &nbsp;·&nbsp; All Rights Reserved</div>
        <div className="flex items-center gap-2 font-dot text-[10px] uppercase tracking-widest text-zinc-600">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> Signal Active
        </div>
      </footer>
    </div>
  );
};

export default LocusGuide;
