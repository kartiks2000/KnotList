import { useState } from 'react'
import { Heart, House, Menu, Plus, Settings2, Sparkles, Users, X } from 'lucide-react'

const navigation = [
  { label: 'Overview', icon: House },
  { label: 'Your space', icon: Users },
]

function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#home" aria-label="Knotlist home">
          <span className="brand-mark"><Heart size={17} strokeWidth={1.8} /></span>
          <span>knotlist</span>
        </a>
        <div className="side-caption">YOUR WEDDING</div>
        <nav aria-label="Main navigation">
          {navigation.map(({ label, icon: Icon }, index) => (
            <button className={`nav-item ${index === 0 ? 'active' : ''}`} key={label} onClick={() => setMenuOpen(false)}>
              <Icon size={18} strokeWidth={1.8} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="nav-item settings" onClick={() => setMenuOpen(false)}><Settings2 size={18} /> <span>Settings</span></button>
        <div className="sidebar-bottom">
          <div className="help-card"><Sparkles size={18} /><p>A little space for all the things that make this yours.</p></div>
          <div className="profile"><div className="avatar">A</div><div><strong>Your account</strong><small>Welcome to knotlist</small></div><span className="profile-dots">•••</span></div>
        </div>
      </aside>
      {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close menu' : 'Open menu'}>{menuOpen ? <X /> : <Menu />}</button>
          <div className="breadcrumb">Your space <span>/</span> Overview</div>
          <button className="top-avatar" aria-label="Account menu">A</button>
        </header>

        <section className="welcome">
          <div className="eyebrow"><span className="eyebrow-dot" /> YOUR PLANNING SPACE</div>
          <h1>Make room for <em>the good stuff.</em></h1>
          <p className="intro">A calm little home for everything you’re planning together.</p>
        </section>

        <section className="setup-card" aria-labelledby="setup-title">
          <div className="card-art" aria-hidden="true"><span className="art-sun" /><span className="art-line line-one" /><span className="art-line line-two" /><span className="art-flower">✳</span><span className="art-heart">♡</span></div>
          <div className="setup-copy">
            <div className="setup-label">A FRESH START</div>
            <h2 id="setup-title">Your space is ready.</h2>
            <p>Start with a name for your celebration, or take a moment to look around. This space is yours to shape.</p>
            <button className="primary-button"> <Plus size={17} /> Set up your space</button>
          </div>
          <div className="card-number">01 <span>—</span> 01</div>
        </section>

        <section className="lower-row">
          <div className="note-card"><div className="note-icon"><Heart size={18} /></div><div><span className="section-kicker">A NOTE FOR YOU</span><h3>There’s no wrong place to begin.</h3><p>Take it one little step at a time. You can make this space your own as you go.</p></div><span className="note-sparkle">✳</span></div>
          <div className="side-note"><span className="section-kicker">MADE FOR TWO</span><div className="tiny-hearts">♡ <span>♡</span></div><p>Good plans are better<br />when they’re shared.</p></div>
        </section>

        <footer className="page-footer"><span>Made with care, for your next chapter.</span><span className="footer-heart">♡</span><span>knotlist</span></footer>
      </main>
    </div>
  )
}

export default App
