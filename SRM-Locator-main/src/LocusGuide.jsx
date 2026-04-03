import React, { useState, useEffect, useRef } from 'react';
import './LocusGuide.css';

const BOOT_SEQUENCE = [
  "> INITIALIZING LOCUS NETWORK...",
  "> AUTH NODE v4.0 QUANTUM ONLINE",
  "> ESTABLISHING SECURE HANDSHAKE...",
  "> BYPASSING STANDARD PROTOCOLS...",
  "> DECRYPTING CAMPUS TOPOLOGY...",
  "  [████████████████████] 100%",
  "> SQUAD MATRIX: ONLINE",
  "> SYS_ORACLE: NEURAL LINK UP",
  "> ALL SYSTEMS NOMINAL.",
  "  WELCOME TO LOCUS, OPERATIVE."
];

const LocusGuide = ({ onInitialize }) => {
  const [booting, setBooting] = useState(true);
  const [bootLines, setBootLines] = useState([]);
  const [stealthMode, setStealthMode] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

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
        setTimeout(() => setBooting(false), 1000); // Wait 1s after text finishes
      }
    }, 400); // Speed of the boot text

    return () => clearInterval(interval);
  }, []);

  // --- SCROLL BAR & REVEAL ---
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
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    return () => {
      window.removeEventListener('scroll', handleScroll);
      observer.disconnect();
    };
  }, [booting]); // Re-run when booting finishes so it finds the elements

  // --- SYS_ORACLE LOGIC ---
  const handleSendChat = () => {
    if (!chatQuery.trim() || isProcessing) return;

    const query = chatQuery;
    setChatMsgs(prev => [...prev, { text: query, type: 'u' }]);
    setChatQuery('');
    setIsProcessing(true);

    // AI Processing Delay
    setTimeout(() => {
      let reply = 'Analyzing spatial data... Query processed. Standby for tactical intel.';
      const lq = query.toLowerCase();
      if (lq.includes('java')) reply = 'JAVA GREEN NODE — bearing 247°, 340m from your current position. Squad member GHOST_X detected 18m from target.';
      if (lq.includes('medical')) reply = 'MEDICAL COLLEGE — northeast quadrant, 820m. Fastest route: Secret Route DELTA-7 via Tech Park shortcut.';
      if (lq.includes('squad')) reply = 'Active nodes: GHOST_X near Java Green, VIPER_7 in Tech Park. Total: 3 nodes confirmed online.';
      
      setChatMsgs(prev => [...prev, { text: reply, type: 'o' }]);
      setIsProcessing(false);
    }, 1500 + Math.random() * 1000); // Realistic 1.5s - 2.5s delay
  };

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatMsgs, isProcessing]);

  // --- RENDER ---
  if (booting) {
    return (
      <div className="terminal-overlay">
        <div className="t-box">
          <div className="t-out">
            {bootLines.map((line, i) => <div key={i} style={{ color: line.includes('100%') || line.includes('WELCOME') ? '#00ff9d' : '#00c97a' }}>{line}</div>)}
            <span className="t-cursor"></span>
          </div>
        </div>
        <button className="t-skip" onClick={() => setBooting(false)}>[ SKIP OVERRIDE ]</button>
      </div>
    );
  }

  return (
    <div className={`locus-guide-wrapper ${stealthMode ? 'stealth' : ''}`}>
      <div className="lg-prog" style={{ width: scrollProgress }}></div>

      <nav className="lg-nav">
        <div className="nav-logo">LOCUS <span>V 4.0 QUANTUM</span></div>
        <div className="nav-right">
          <button className="theme-btn" onClick={() => setStealthMode(!stealthMode)}>
            {stealthMode ? '🟢 Tactical' : '⬛ Stealth'}
          </button>
        </div>
      </nav>

      {/* HERO SECTION */}
      <section className="hero">
        <div className="hero-title">LOCUS</div>
        <p className="hero-desc">A hyper-accurate <strong>tactical tracking network</strong> for squads navigating the SRM KTR campus. Real-time telemetry. Predictive routing. AI-driven intelligence.</p>
        
        {/* THIS LAUNCHES YOUR MAIN APP */}
        <button onClick={onInitialize} className="btn-p">INITIALIZE SECURE LINK</button>
      </section>

      {/* ORACLE SECTION */}
      <section className="orc-blk reveal">
        <div className="orc-tit">◈ SYS_ORACLE — Tactical AI</div>
        <div className="chat-box">
          <div className="chat-msgs" ref={chatBoxRef}>
            {chatMsgs.map((msg, i) => (
              <div key={i} className={`cmsg ${msg.type}`}>{msg.text}</div>
            ))}
            {isProcessing && <div className="cmsg p">Processing neural request...</div>}
          </div>
          <div className="chat-row">
            <input 
              type="text" 
              value={chatQuery}
              onChange={(e) => setChatQuery(e.target.value)}
              placeholder="ASK THE ORACLE..." 
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              disabled={isProcessing}
            />
            <button className="chat-send" onClick={handleSendChat} disabled={isProcessing}>TRANSMIT</button>
          </div>
        </div>
      </section>

      {/* CAMPUS NODES WITH HOVER COORDS */}
      <section className="campus-grid reveal">
        {[
          { name: "University Building", desc: "ADMIN // PRIMARY NODE", coords: "LAT: 12.8243 LNG: 80.0422" },
          { name: "Java Green", desc: "FOOD // HIGH TRAFFIC", coords: "LAT: 12.8233 LNG: 80.0444" },
          { name: "Tech Park", desc: "LABS // SIGNAL WEAK", coords: "LAT: 12.8250 LNG: 80.0453" },
          { name: "Medical College", desc: "MEDICAL // SECURE", coords: "LAT: 12.8210 LNG: 80.0481" }
        ].map((node, i) => (
          <div className="cn" key={i}>
            <div className="nn">{node.name}</div>
            <div className="nt">{node.desc}</div>
            <div className="cn-coords">{node.coords}</div>
          </div>
        ))}
      </section>

    </div>
  );
};

export default LocusGuide;