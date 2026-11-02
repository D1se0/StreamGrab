import React, { useEffect, useRef, useState } from 'react';
import { content, REPO, RELEASES } from './content.jsx';

/** Reveal-on-scroll: adds .in when the element enters the viewport (jsdom-safe). */
function Reveal({ children, className = '', delay = 0 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${visible ? 'in' : ''} ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>{children}</div>;
}

function Nav({ t, lang, setLang }) {
  const go = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a className="logo" href="#top" onClick={go('top')}>
          <span className="logo-mark">⬇</span> StreamGrab
        </a>
        <div className="nav-links">
          <a href="#about" onClick={go('about')}>{t.nav.about}</a>
          <a href="#how" onClick={go('how')}>{t.nav.how}</a>
          <a href="#install" onClick={go('install')}>{t.nav.install}</a>
          <a href="#faq" onClick={go('faq')}>{t.nav.faq}</a>
          <a className="btn btn-sm btn-outline" href={REPO} target="_blank" rel="noreferrer">★ GitHub</a>
          <button className="lang-toggle" onClick={() => setLang(lang === 'es' ? 'en' : 'es')} aria-label={t.footer.langLabel}>
            <span className={lang === 'es' ? 'on' : ''}>ES</span><span className={lang === 'en' ? 'on' : ''}>EN</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

function MockPopup({ c }) {
  return (
    <div className="mock-wrap">
      <div className="mock-glow" aria-hidden="true" />
      <div className="mockpopup">
        <div className="mock-bar"><span className="dot r" /><span className="dot y" /><span className="dot g" /><b>{c.mockTitle}</b></div>
        <div className="mock-tabs">
          <span className="mock-tab on">{c.mockVideosTab}</span>
          <span className="mock-tab">{c.mockHistTab}</span>
        </div>
        <div className="mock-card">
          <div className="mock-card-title">{c.mockCardTitle}<i className="mock-kind">HLS</i></div>
          <div className="mock-sub">{c.mockCardQuality}</div>
          <div className="mock-opts">
            <span className="mock-opt sel">{c.mockOpt1}</span>
            <span className="mock-opt">{c.mockOpt2}</span>
          </div>
          <div className="mock-progress"><div className="mock-progress-fill" /></div>
          <div className="mock-status"><span className="spin">◌</span> {c.mockDownloading}… <b>{c.mockPct}</b></div>
        </div>
        <div className="mock-hist">
          <span className="mock-chip">🎞 {c.mockHist1}</span>
          <span className="mock-chip">🎞 {c.mockHist2}</span>
        </div>
      </div>
    </div>
  );
}

function Hero({ t }) {
  return (
    <header className="hero" id="top">
      <div className="bg-blobs" aria-hidden="true"><i /><i /><i /></div>
      <div className="bg-grid" aria-hidden="true" />
      <div className="container hero-inner">
        <div className="hero-copy">
          <Reveal><span className="pill" data-testid="hero-pill">{t.hero.pill}</span></Reveal>
          <Reveal delay={80}>
            <h1 className="hero-title">
              {t.hero.title.replace(t.hero.gradient, '')}
              <span className="grad-text">{t.hero.gradient}</span>
            </h1>
          </Reveal>
          <Reveal delay={160}><p className="hero-sub">{t.hero.subtitle}</p></Reveal>
          <Reveal delay={240}>
            <div className="hero-ctas">
              <a className="btn btn-primary" href={RELEASES} target="_blank" rel="noreferrer">{t.hero.ctaChrome}</a>
              <a className="btn btn-primary" href={RELEASES} target="_blank" rel="noreferrer">{t.hero.ctaFirefox}</a>
              <a className="btn btn-outline" href="#how">{t.hero.ctaSecondary}</a>
            </div>
          </Reveal>
          <Reveal delay={320}><div className="hero-browsers">{t.hero.browsers}</div></Reveal>
        </div>
        <Reveal delay={200} className="hero-mock"><MockPopup c={t.hero} /></Reveal>
      </div>
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[...t.marquee, ...t.marquee].map((m, i) => <span key={i}>{m}</span>)}
        </div>
      </div>
    </header>
  );
}

function How({ t }) {
  return (
    <section className="section" id="how">
      <div className="container">
        <Reveal><span className="eyebrow">{t.how.eyebrow}</span></Reveal>
        <Reveal delay={60}><h2>{t.how.title}</h2></Reveal>
        <Reveal delay={120}><p className="section-sub">{t.how.subtitle}</p></Reveal>
        <div className="pipeline">
          {t.how.steps.map(([icon, title, text], i) => (
            <Reveal key={title} delay={i * 120} className="step">
              <div className="step-card">
                <div className="step-icon">{icon}</div>
                <h3>{String(i + 1).padStart(2, '0')} · {title}</h3>
                <p>{text}</p>
              </div>
              {i < t.how.steps.length - 1 && <div className="step-link" aria-hidden="true">→</div>}
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}><p className="fidelity">✅ ffprobe: {t.how.fidelity}</p></Reveal>
      </div>
    </section>
  );
}

function Features({ t }) {
  return (
    <section className="section" id="about">
      <div className="container">
        <Reveal><span className="eyebrow">{t.features.eyebrow}</span></Reveal>
        <Reveal delay={60}><h2>{t.features.title}</h2></Reveal>
        <div className="grid8">
          {t.features.items.map(([icon, title, text], i) => (
            <Reveal key={title} delay={(i % 4) * 90}>
              <div className="fcard">
                <div className="ficon">{icon}</div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function Install({ t }) {
  return (
    <section className="section" id="install">
      <div className="container">
        <Reveal><span className="eyebrow">{t.install.eyebrow}</span></Reveal>
        <Reveal delay={60}><h2>{t.install.title}</h2></Reveal>
        <div className="install-grid">
          <Reveal delay={80}>
            <div className="icard">
              <h3>{t.install.chromeTitle}</h3>
              <ol data-testid="steps-chrome">{t.install.stepsChrome.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          </Reveal>
          <Reveal delay={160}>
            <div className="icard">
              <h3>{t.install.firefoxTitle}</h3>
              <ol data-testid="steps-firefox">{t.install.stepsFirefox.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          </Reveal>
        </div>
        <Reveal delay={220}><p className="muted-note">⚙️ {t.install.note}</p></Reveal>
      </div>
    </section>
  );
}

function Faq({ t }) {
  return (
    <section className="section" id="faq">
      <div className="container narrow">
        <Reveal><span className="eyebrow">{t.faq.eyebrow}</span></Reveal>
        <Reveal delay={60}><h2>{t.faq.title}</h2></Reveal>
        <div className="badges-row">
          {t.faq.dlBadges.map((b) => <span className="pill-soft" key={b}>{b}</span>)}
        </div>
        {t.faq.items.map(([q, a], i) => (
          <Reveal key={q} delay={i * 60}>
            <details className="faq-item">
              <summary>{q}<i>▾</i></summary>
              <p>{a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Footer({ t }) {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span className="logo">⬇️ StreamGrab</span>
        <span>{t.footer.madeWith}</span>
        <div className="footer-links">
          <a href={REPO} target="_blank" rel="noreferrer">{t.footer.repo}</a>
          <a href={RELEASES} target="_blank" rel="noreferrer">{t.footer.releases}</a>
          <span className="muted">{t.footer.license} · v1.1.0</span>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  const [lang, setLang] = useState(() => (typeof navigator !== 'undefined' && navigator.language?.startsWith('es') ? 'es' : 'en'));
  const t = content[lang];
  return (
    <div lang={lang}>
      <Nav t={t} lang={lang} setLang={setLang} />
      <Hero t={t} />
      <How t={t} />
      <Features t={t} />
      <Install t={t} />
      <Faq t={t} />
      <Footer t={t} />
    </div>
  );
}
