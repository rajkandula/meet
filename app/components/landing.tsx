import Link from "next/link";
import {
  ArrowRight,
  Cloud,
  Disc,
  Globe,
  Link2,
  Lock,
  MessageCircle,
  Mic2,
  MonitorUp,
  MoreHorizontal,
  Radio,
  Sparkles,
  Users,
  Video,
} from "lucide-react";

/**
 * The public face of Meet — what a signed-out visitor sees at "/".
 * Every claim on this page is a shipped feature, not aspiration.
 */
export function Landing() {
  return (
    <div className="landing">
      <header className="landing-header">
        <div className="landing-brand"><div className="brand-mark"><span /><span /><span /></div>meet</div>
        <nav className="landing-nav">
          <Link className="button ghost-button" href="/login">Sign in</Link>
          <Link className="button button-primary" href="/signup">Get started <ArrowRight size={15} /></Link>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow"><span className="status-dot" /> A quieter way to meet</p>
          <h1>Meetings that feel<br /><em>more human.</em></h1>
          <p className="landing-sub">
            Start a room in seconds and bring everyone together — crisp group calls,
            end-to-end encrypted rooms, and invite links that work without a download.
          </p>
          <div className="landing-cta-row">
            <Link className="button button-primary landing-cta" href="/signup"><Video size={16} /> Start meeting free</Link>
            <Link className="button ghost-button landing-cta" href="/login">Sign in</Link>
          </div>
          <p className="landing-facts">Free and open source · Runs in the browser · No downloads</p>
        </div>
        <div className="landing-hero-visual hero-visual" aria-label="Preview of a live Meet room">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="meeting-window">
            <div className="meeting-window-top"><span><i className="window-dot red" /><i className="window-dot yellow" /><i className="window-dot green" /></span><span className="window-title"><Radio size={11} /> willow-huddle</span><MoreHorizontal size={14} /></div>
            <div className="video-grid">
              <div className="video-tile tile-lilac"><span className="tile-initials">OC</span><span className="tile-name">Olivia</span><span className="tile-mic"><Mic2 size={11} /></span></div>
              <div className="video-tile tile-peach"><span className="tile-face">JM</span><span className="tile-name">Jamie</span><span className="tile-mic"><Mic2 size={11} /></span></div>
              <div className="video-tile tile-blue"><span className="tile-face">MK</span><span className="tile-name">Maya</span><span className="tile-mic"><Mic2 size={11} /></span></div>
              <div className="video-tile tile-cream"><span className="tile-face">AL</span><span className="tile-name">Alex</span><span className="tile-mic"><Mic2 size={11} /></span></div>
            </div>
            <div className="meeting-window-bottom"><span className="live-pill"><i /> Live now</span><span className="call-duration">00:24:18</span><span className="mini-controls"><i /><i /><i /></span></div>
          </div>
        </div>
      </section>

      <section className="landing-features" aria-label="What Meet does">
        <h2>Everything a good conversation needs</h2>
        <div className="landing-feature-grid">
          <article className="landing-feature">
            <span className="landing-feature-icon"><Users size={18} /></span>
            <h3>Group calls that scale</h3>
            <p>Everyone connects once to the cloud instead of to each other, so calls stay smooth as the room grows.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature-icon"><Lock size={18} /></span>
            <h3>End-to-end encrypted rooms</h3>
            <p>One click re-keys a room so only people with the link can see or hear it — the key never touches a server.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature-icon"><Sparkles size={18} /></span>
            <h3>Spotlight who&apos;s speaking</h3>
            <p>The room highlights whoever is talking and can put presenters and speakers front and center.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature-icon"><MonitorUp size={18} /></span>
            <h3>Share your screen</h3>
            <p>Present a window, a tab, or everything — swapped in live without interrupting the call.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature-icon"><Disc size={18} /></span>
            <h3>Record to your cloud</h3>
            <p>Capture the whole room — every tile and voice — and it lands in your own storage, ready to replay.</p>
          </article>
          <article className="landing-feature">
            <span className="landing-feature-icon"><Globe size={18} /></span>
            <h3>Works on any network</h3>
            <p>Home wifi, office firewalls, mobile data — a global relay finds a path where ordinary calls give up.</p>
          </article>
        </div>
      </section>

      <section className="landing-steps" aria-label="How it works">
        <h2>Three steps to talking</h2>
        <ol className="landing-step-row">
          <li className="landing-step">
            <span className="landing-step-number">1</span>
            <h3><Video size={15} /> Start a room</h3>
            <p>One click from your dashboard — or schedule it for later.</p>
          </li>
          <li className="landing-step">
            <span className="landing-step-number">2</span>
            <h3><Link2 size={15} /> Share the link</h3>
            <p>Guests join straight from the browser. No account, no install.</p>
          </li>
          <li className="landing-step">
            <span className="landing-step-number">3</span>
            <h3><MessageCircle size={15} /> Talk it out</h3>
            <p>Video, chat, screen share, and recording — all in the room.</p>
          </li>
        </ol>
      </section>

      <section className="landing-band">
        <div>
          <h2>Make room for better conversations.</h2>
          <p>Free and open source. Guests join from a link, with no account and no install.</p>
        </div>
        <Link className="button light-button landing-cta" href="/signup"><Cloud size={16} /> Create your space</Link>
      </section>

      <footer className="landing-footer">
        <div className="landing-brand"><div className="brand-mark"><span /><span /><span /></div>meet</div>
        <span>Open source · Meet with intention.</span>
      </footer>
    </div>
  );
}
