import React, { useState, useEffect, useRef } from 'react';
import './LocusGuide.css';

const BOOT_SEQUENCE = [
  "> INITIALIZING LOCUS NETWORK...",
  "> AUTH NODE v4.0 QUANTUM ONLINE",
  "> SCANNING CREDENTIALS...",
  "> IDENTITY VERIFIED: OPERATIVE",
  "> CONNECTING TO SRM KTR GRID...",
  "  [████████████████████] 100%",
  "> SQUAD MATRIX: ONLINE",
  "> DEAD RECKONING ENGINE: ACTIVE",
  "> SYS_ORACLE: NEURAL LINK UP",
  "> ALL SYSTEMS NOMINAL",
  "  WELCOME TO LOCUS, OPERATIVE."
];

const LocusGuide = ({ onInitialize }) => {
  const [booting, setBooting] = useState(true);
  const [bootLines, setBootLines] = useState([]);
  const [stealthMode, setStealthMode] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  // Interactive States from original HTML
  const [selectedMode, setSelectedMode] = useState('active');
  const [openFaq, setOpenFaq] = useState(null);

  // Oracle State
  const [chatQuery, setChatQuery] = useState('');
  const [chatMsgs, setChatMsgs] = useState([
    { text: 'SYS_ORACLE online. Spatial link established. Awaiting your query, operative.', type: 'o' }
  ]);
  const [isProcessing, setIsProcessing] = useState(false);
  const chatBoxRef = useRef(null);

  // --- TERMINAL BOOT EFFECT ---
  useEffect(() => {
    let currentLine = 0;
    const interval = setInterval(() => {
      if (currentLine < BOOT_SEQUENCE.length) {
        setBootLines(prev => [...prev, BOOT_SEQUENCE[currentLine]]);
        currentLine++;
      } else {
        clearInterval(interval);
        setTimeout(() => setBooting(false), 800);
      }
    }, 300);
    return () => clearInterval(interval);
  }, []);

  // --- SCROLL & REVEAL ---
  useEffect(() => {
    const handleScroll = () => {
      const totalScroll = document.documentElement.scrollTop;
      const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      setScrollProgress(`${(totalScroll / windowHeight) * 100}%`);
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

  // --- SYS_ORACLE LOGIC ---
  const handleSendChat = (presetQuery = null) => {
    const query = presetQuery || chatQuery;
    if (!query.trim() || isProcessing) return;

    setChatMsgs(prev => [...prev, { text: query, type: 'u' }]);
    if (!presetQuery) setChatQuery('');
    setIsProcessing(true);

    setTimeout(() => {
      let reply = 'Analyzing spatial data... Query processed. Standby for tactical intel.';
      const lq = query.toLowerCase();
      if (lq.includes('java')) reply = 'JAVA GREEN NODE — bearing 247°, 340m from your current position. Squad member GHOST_X detected 18m from target.';
      if (lq.includes('medical')) reply = 'MEDICAL COLLEGE — northeast quadrant, 820m. Fastest route: Secret Route DELTA-7 via Tech Park shortcut.';
      if (lq.includes('squad') || lq.includes('where')) reply = 'Active nodes: GHOST_X near Java Green, VIPER_7 in Tech Park (signal intermittent). Total: 3 nodes confirmed online.';
      if (lq.includes('ganesan') || lq.includes('tp')) reply = 'T.P. GANESAN AUDITORIUM — node status: ACCESSIBLE. No active event flagged. Entry via main corridor. Distance from your position: 510m.';
      
      setChatMsgs(prev => [...prev, { text: reply, type: 'o' }]);
      setIsProcessing(false);
    }, 1000 + Math.random() * 800);
  };

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatMsgs, isProcessing]);

  const toggleFaq = (index) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  // --- RENDER BOOT SCREEN ---
  if (booting) {
    return (
      <div id="terminal-overlay" style={{ display: 'flex' }}>
        <div className="t-box">
          <div id="t-out">
            {bootLines.map((line, i) => (
              <div key={i} className={line?.includes('100%') || line?.includes('WELCOME') ? 'tb' : 'tc'}>
                {line}
              </div>
            ))}
            <span className="t-cursor"></span>
          </div>
        </div>
        <button id="t-skip" onClick={() => setBooting(false)}>[ skip intro ]</button>
      </div>
    );
  }

  // --- RENDER MAIN GUIDE ---
  return (
    <div className={`locus-guide-wrapper ${stealthMode ? 'stealth' : ''}`}>
      <div id="prog" style={{ width: scrollProgress }}></div>

      {/* NAV */}
      <nav>
        <div className="nav-logo">LOCUS <span>V 4.0 QUANTUM</span></div>
        <ul className="nav-links">
          <li><a href="#start">Start</a></li>
          <li><a href="#features">Features</a></li>
          <li><a href="#modes">Stealth</a></li>
          <li><a href="#access">Access</a></li>
          <li><a href="#intel">Intel</a></li>
          <li><a href="#faq">FAQ</a></li>
        </ul>
        <div className="nav-right">
          <button className="theme-btn" onClick={() => setStealthMode(!stealthMode)}>
            {stealthMode ? '🟢 Tactical' : '⬛ Stealth'}
          </button>
          <div className="nav-status"><div className="pulse"></div> ONLINE</div>
          <button className={`ham ${mobileNavOpen ? 'open' : ''}`} onClick={() => setMobileNavOpen(!mobileNavOpen)}>
            <span></span><span></span><span></span>
          </button>
        </div>
      </nav>

      <div className={`mobile-nav ${mobileNavOpen ? 'open' : ''}`}>
        <a href="#start" onClick={() => setMobileNavOpen(false)}>Start</a>
        <a href="#features" onClick={() => setMobileNavOpen(false)}>Features</a>
        <a href="#modes" onClick={() => setMobileNavOpen(false)}>Stealth</a>
        <a href="#access" onClick={() => setMobileNavOpen(false)}>Access</a>
        <a href="#intel" onClick={() => setMobileNavOpen(false)}>Intel</a>
        <a href="#faq" onClick={() => setMobileNavOpen(false)}>FAQ</a>
      </div>

      {/* HERO */}
      <div className="hero" id="hero">
        <div className="h-ring r1"></div><div className="h-ring r2"></div><div className="h-ring r3"></div>
        <div className="hero-tag">// SRM KTR Campus Network //</div>
        <div className="hero-title"><span className="glitch" data-text="LOCUS">LOCUS</span></div>
        <div className="hero-ver">V 4.0 &nbsp;·&nbsp; QUANTUM POSITIONING &nbsp;·&nbsp; DECENTRALIZED</div>
        <p className="hero-desc">A hyper-accurate <strong>tactical tracking network</strong> for squads navigating the SRM KTR campus. Real-time telemetry. Predictive routing. AI-driven intelligence.</p>
        <div className="hero-cta">
          {/* 🚨 THE BUTTON THAT OPENS YOUR APP 🚨 */}
          <button onClick={onInitialize} className="btn-p">INITIALIZE SECURE LINK</button>
          <a href="#start" className="btn-g">Explore Systems</a>
        </div>
      </div>

      {/* STATS */}
      <div className="stats-bar reveal">
        <div className="stat-it"><span className="sv">&lt;70ms</span><span className="sl">Sync Latency</span></div>
        <div className="stat-it"><span className="sv">3</span><span className="sl">Stealth Modes</span></div>
        <div className="stat-it"><span className="sv">360°</span><span className="sl">Campus Coverage</span></div>
        <div className="stat-it"><span className="sv">SYS_AI</span><span className="sl">Oracle Core</span></div>
      </div>

      {/* GETTING STARTED */}
      <section id="start">
        <div className="sh reveal"><span className="sn">01</span><span className="st glitch" data-text="Getting Started">Getting Started</span><div className="sl2"></div></div>
        <div className="steps-grid reveal">
          <div className="step-card"><span className="sico">🔐</span><span className="snum">STEP_01</span><div className="stit">Authenticate</div><p className="sdesc">Sign in via Google OAuth or create an independent ID. Tactical avatars auto-assigned.</p></div>
          <div className="step-card"><span className="sico">📡</span><span className="snum">STEP_02</span><div className="stit">Join a Channel</div><p className="sdesc">Enter a squad channel. The Commander reviews and grants your handshake request.</p></div>
          <div className="step-card"><span className="sico">🗺️</span><span className="snum">STEP_03</span><div className="stit">Go Live</div><p className="sdesc">See all connected squad members, speed, battery, and ping on the tactical map.</p></div>
          <div className="step-card"><span className="sico">🤖</span><span className="snum">STEP_04</span><div className="stit">Query Oracle</div><p className="sdesc">Ask SYS_ORACLE about squad positions, fastest routes, and facility intel.</p></div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features">
        <div className="sh reveal"><span className="sn">02</span><span className="st glitch" data-text="Core Systems">Core Systems</span><div className="sl2"></div></div>
        <div className="feat-list reveal">
          <div className="feat-row"><div className="feat-lbl"><div className="feat-dot"></div><span className="feat-txt">Squad Matrix</span></div><div className="feat-con"><p>Live HUD displaying every connected node — their <strong>GPS coordinates, speed, battery level, and ping</strong>.</p></div></div>
          <div className="feat-row"><div className="feat-lbl"><div className="feat-dot"></div><span className="feat-txt">Dead Reckoning</span></div><div className="feat-con"><p>Lost signal? LOCUS projects a <strong>Ghost Marker</strong> based on last known heading, speed, and time offline.</p></div></div>
          <div className="feat-row"><div className="feat-lbl"><div className="feat-dot"></div><span className="feat-txt">Tactical Routing</span></div><div className="feat-con"><p>Admins unlock <strong>Secret Routes</strong> — custom shortcut paths hidden from standard maps for the fastest lines.</p></div></div>
          <div className="feat-row"><div className="feat-lbl"><div className="feat-dot"></div><span className="feat-txt">Geofence Alerts</span></div><div className="feat-con"><p>Define a perimeter. When a squad member <strong>breaches or departs</strong> the boundary, alerts fire instantly.</p></div></div>
        </div>
      </section>

      {/* STEALTH MODES */}
      <section id="modes">
        <div className="sh reveal"><span className="sn">03</span><span className="st glitch" data-text="Stealth Controls">Stealth Controls</span><div className="sl2"></div></div>
        <div className="modes-grid reveal">
          <div className={`mode-card ${selectedMode === 'active' ? 'sel' : ''}`} onClick={() => setSelectedMode('active')}><div className="mind a"></div><div className="mlbl">Active</div><p className="mdesc">Standard broadcast. Real-time location visible to squad.</p></div>
          <div className={`mode-card ${selectedMode === 'frozen' ? 'sel' : ''}`} onClick={() => setSelectedMode('frozen')}><div className="mind f"></div><div className="mlbl">Frozen</div><p className="mdesc">Locks your avatar at your last position. You move freely offline.</p></div>
          <div className={`mode-card ${selectedMode === 'ghost' ? 'sel' : ''}`} onClick={() => setSelectedMode('ghost')}><div className="mind g"></div><div className="mlbl">Ghost</div><p className="mdesc">Full dark mode. Vanish from the map entirely.</p></div>
        </div>
      </section>

      {/* ACCESS */}
      <section id="access">
        <div className="sh reveal"><span className="sn">04</span><span className="st glitch" data-text="Access Control">Access Control</span><div className="sl2"></div></div>
        <div className="acc-grid reveal">
          <div className="acc-card"><div className="acc-ico">🔑</div><div className="acc-tit">Auth Node</div><p className="acc-desc">Secure gateway. No anonymous nodes permitted.</p></div>
          <div className="acc-card"><div className="acc-ico">⏳</div><div className="acc-tit">Waiting Room</div><p className="acc-desc">Join requests held until Commander manually approves.</p></div>
          <div className="acc-card"><div className="acc-ico">🛡️</div><div className="acc-tit">Commander</div><p className="acc-desc">Owner controls approvals and can blacklist rogue nodes.</p></div>
        </div>
      </section>

      {/* INTEL & ORACLE */}
      <section id="intel">
        <div className="sh reveal"><span className="sn">05</span><span className="st glitch" data-text="Emergency & AI Intel">Emergency & AI Intel</span><div className="sl2"></div></div>
        <div className="sos-blk reveal">
          <div className="sos-tit">⚠ SOS Protocol</div>
          <p className="sos-d">A single tap broadcasts a <strong>high-priority distress beacon</strong>. Receiving devices are hit with a native push notification and a sonar alarm — ensuring the signal is never missed.</p>
        </div>
        <div className="orc-blk reveal">
          <div className="orc-tit">◈ SYS_ORACLE — Tactical AI</div>
          <p className="orc-d">LOCUS ships with an onboard AI assistant spatially aware of your position. Ask it anything.</p>
          <div className="qchips">
            <button className="qchip" onClick={() => handleSendChat("Who is closest to Java Green?")}>Who is closest to Java Green?</button>
            <button className="qchip" onClick={() => handleSendChat("Fastest route to Medical College?")}>Fastest route to Medical College?</button>
          </div>
          <div className="chat-box">
            <div className="chat-msgs" ref={chatBoxRef}>
              {chatMsgs.map((msg, i) => (
                <div key={i} className={`cmsg ${msg.type}`}>
                  {msg.text}
                </div>
              ))}
              {isProcessing && <div className="cmsg p" style={{color: 'rgba(255,184,0,0.5)', animation: 'pulse 1.5s infinite'}}>Processing neural request...</div>}
            </div>
            <div className="chat-row">
              <input 
                type="text" 
                placeholder="enter query..." 
                value={chatQuery}
                onChange={(e) => setChatQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              />
              <button className="chat-send" onClick={() => handleSendChat()}>TRANSMIT</button>
            </div>
          </div>
        </div>
      </section>

      {/* CAMPUS NODES */}
      <section id="campus">
        <div className="sh reveal"><span className="sn">06</span><span className="st glitch" data-text="Campus Nodes">Campus Nodes</span><div className="sl2"></div></div>
        <div className="campus-grid reveal">
          <div className="cn"><div className="nd"></div><div className="nn">University Building</div><div className="nt">ADMIN // PRIMARY</div></div>
          <div className="cn"><div className="nd" style={{background:'#ffb800', boxShadow:'0 0 6px #ffb800'}}></div><div className="nn">Java Green</div><div className="nt">FOOD // HIGH TRAFFIC</div></div>
          <div className="cn"><div className="nd" style={{background:'#00e5ff', boxShadow:'0 0 6px #00e5ff'}}></div><div className="nn">T.P. Ganesan</div><div className="nt">AUDITORIUM // EVENT</div></div>
          <div className="cn"><div className="nd"></div><div className="nn">Tech Park</div><div className="nt">LABS // SIGNAL WEAK</div></div>
        </div>
      </section>

      {/* COMMS */}
      <section id="comms">
        <div className="sh reveal"><span className="sn">07</span><span className="st glitch" data-text="Intercepted Comms">Intercepted Comms</span><div className="sl2"></div></div>
        <div className="comms-list reveal">
          <div className="comm"><div className="cav">GX</div><div><div className="chdr"><span className="ccod">GHOST_X</span><span className="ctim">14:32 // KTR GRID</span></div><p className="ctxt">"Frozen mode saved me during the faculty inspection. My marker stayed in the hostel."</p></div></div>
          <div className="comm"><div className="cav">V7</div><div><div className="chdr"><span className="ccod">VIPER_7</span><span className="ctim">09:15 // TECH PARK</span></div><p className="ctxt">"Dead Reckoning Ghost Marker found me when I lost signal in the basement labs. Precision tracking."</p></div></div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq">
        <div className="sh reveal"><span className="sn">08</span><span className="st glitch" data-text="FAQ // Command Log">FAQ // Command Log</span><div className="sl2"></div></div>
        <div className="faq-list reveal">
          {[
            { q: "How accurate is the GPS tracking?", a: "LOCUS applies a Kalman filter to raw GPS sensor data, smoothing erratic phone sensor noise. Accuracy is within 3–5 meters under open sky." },
            { q: "Can the Commander track me without my knowledge?", a: "No. You control your broadcast mode at all times. FROZEN locks your avatar in place, GHOST removes you from the map entirely." },
            { q: "What happens to my location data when I close the app?", a: "Your live telemetry session ends on app close. The system records your last known ping position, visible to squad members as an offline marker." },
            { q: "How do Secret Routes work?", a: "Secret Routes are custom path overlays recorded and published by administrators. They bypass standard walking paths and show the actual fastest shortcuts." }
          ].map((item, i) => (
            <div key={i} className={`faq-item ${openFaq === i ? 'open' : ''}`}>
              <button className="faq-q" onClick={() => toggleFaq(i)}>
                <span className="faq-qt">{item.q}</span><span className="faq-arr">›</span>
              </button>
              <div className="faq-ans"><div className="faq-ans-in">{item.a}</div></div>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="f-logo">LOCUS</div>
        <div className="f-copy">SRM KTR Campus Network &nbsp;·&nbsp; All Rights Reserved</div>
        <div className="f-sig"><div className="pulse"></div> SIGNAL ACTIVE</div>
      </footer>
    </div>
  );
};

export default LocusGuide;