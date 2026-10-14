/**
 * The branded left panel both auth screens share. It was duplicated verbatim
 * in login and signup, which meant every copy tweak had to be made twice.
 */
export function AuthVisual() {
  return (
    <section className="auth-visual">
      <div className="auth-brand"><div className="brand-mark"><span /><span /><span /></div>meet</div>
      <div className="auth-visual-copy">
        <p className="eyebrow"><span className="status-dot" /> A quieter way to meet</p>
        <h1>Good work<br />starts with<br /><em>good space.</em></h1>
        <p>Bring your people together in rooms that feel focused, thoughtful, and easy to be in.</p>
        <div className="auth-proof">
          <div className="auth-proof-avatars"><i>JD</i><i>MK</i><i>AL</i><i>+8</i></div>
          <div><strong>Free and open source</strong><p>MIT licensed. Run it on your own server.</p></div>
        </div>
      </div>
      <div className="auth-preview">
        <div className="auth-preview-bar"><span>● ● ●</span><span>willow-huddle</span></div>
        <div className="auth-preview-grid"><span>OC</span><span>JM</span><span>MK</span><span>AL</span></div>
      </div>
      <div className="auth-visual-footer"><span>Open source</span><span>Meet with intention.</span></div>
    </section>
  );
}
