"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, AtSign, Check, Eye, EyeOff, LockKeyhole, Sparkles, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { AuthVisual } from "@/app/components/auth-visual";
import { requestJson } from "@/lib/client-api";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Your passwords do not match.");
      return;
    }
    if (!terms) {
      setError("Please agree to the terms to create your account.");
      return;
    }
    setIsLoading(true);

    try {
      await requestJson("/api/auth/register", { method: "POST", body: { name, username, password, confirmPassword }, fallbackError: "We could not create your account." });
      router.push("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We could not create your account.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <AuthVisual />
      <section className="auth-form-side">
        <div className="auth-mobile-brand"><div className="brand-mark"><span /><span /><span /></div>meet</div>
        <div className="auth-form-wrap">
          <button className="auth-back" onClick={() => router.push("/")}><ArrowLeft size={14} /> Back to home</button>
          <span className="auth-form-kicker"><Sparkles size={13} /> Start together</span>
          <h2>Make space for<br />better work.</h2>
          <p>Create your workspace in less than a minute. No noise, just room to connect.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="auth-field"><label htmlFor="signup-name">Full name</label><div className="auth-input-wrap"><UserRound size={16} /><input id="signup-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Olivia Carter" autoComplete="name" required /></div></div>
            <div className="auth-field"><label htmlFor="signup-username">Username</label><div className="auth-input-wrap"><AtSign size={16} /><input id="signup-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="olivia.carter" autoComplete="username" required /><span className="input-suffix">meet</span></div></div>
            <div className="auth-field"><label htmlFor="signup-password">Password <span className="field-hint">8+ characters</span></label><div className="auth-input-wrap"><LockKeyhole size={16} /><input id="signup-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Create a password" autoComplete="new-password" required /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            <div className="auth-field"><label htmlFor="signup-confirm-password">Confirm password</label><div className="auth-input-wrap"><Check size={16} /><input id="signup-confirm-password" type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat your password" autoComplete="new-password" required /><button className="auth-password-toggle" type="button" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? "Hide password" : "Show password"}>{showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            <label className="auth-check auth-terms"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} /> <span>I agree to the <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</span></label>
            <button className="button button-primary auth-submit" disabled={isLoading}>{isLoading ? "Creating your space..." : "Create account"} {!isLoading && <ArrowRight size={15} />}</button>
          </form>

          <p className="auth-switch"><Link className="auth-link" href="/login">Already have an account? Sign in instead</Link></p>
        </div>
      </section>
    </main>
  );
}
