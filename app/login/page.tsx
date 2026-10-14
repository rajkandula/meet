"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, AtSign, Eye, EyeOff, LockKeyhole, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { AuthVisual } from "@/app/components/auth-visual";
import { requestJson } from "@/lib/client-api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await requestJson("/api/auth/login", { method: "POST", body: { username, password, remember }, fallbackError: "We could not sign you in." });
      router.push("/");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We could not sign you in.");
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
          <span className="auth-form-kicker"><Sparkles size={13} /> Welcome back</span>
          <h2>Good to see you<br />again.</h2>
          <p>Sign in to pick up where your best conversations left off.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            {error && <div className="auth-error" role="alert">{error}</div>}
            <div className="auth-field"><label htmlFor="login-username">Username</label><div className="auth-input-wrap"><AtSign size={16} /><input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="olivia.carter" autoComplete="username" required /></div></div>
            <div className="auth-field"><label htmlFor="login-password">Password</label><div className="auth-input-wrap"><LockKeyhole size={16} /><input id="login-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></div>
            <div className="auth-form-row"><label className="auth-check"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Keep me signed in</label><button type="button" className="auth-link" onClick={() => setError("Password reset will be available soon.")}>Forgot password?</button></div>
            <button className="button button-primary auth-submit" disabled={isLoading}>{isLoading ? "Signing you in..." : "Sign in"} {!isLoading && <ArrowRight size={15} />}</button>
          </form>

          <p className="auth-switch">New to Meet? <Link className="auth-link" href="/signup">Create an account</Link></p>
        </div>
      </section>
    </main>
  );
}
