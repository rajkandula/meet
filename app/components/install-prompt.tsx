"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MonitorDown, X } from "lucide-react";

/**
 * The gentle "install the app" reminder.
 *
 * Chrome/Edge on Windows, Mac, and Android fire `beforeinstallprompt`; we hold
 * that event and offer a one-tap install. iPhones never fire it, so Safari
 * users get a one-line hint about Share → Add to Home Screen instead.
 *
 * Politeness rules: never shown inside a meeting room, never shown when the
 * app is already installed (standalone display), and a dismissal keeps it
 * away for 14 days.
 */

const DISMISS_KEY = "meet_install_dismissed_at";
const DISMISS_DAYS = 14;

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallPrompt() {
  const pathname = usePathname();
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - dismissedAt < DISMISS_DAYS * 86400 * 1000) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // iOS Safari never fires the event — show the Add-to-Home-Screen hint.
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setShowIosHint(true);
      setVisible(true);
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible || pathname.startsWith("/room/")) return null;

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => ({ outcome: "dismissed" }));
    if (choice.outcome !== "accepted") window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  return (
    <div className="install-banner" role="dialog" aria-label="Install Meet">
      <span className="install-banner-icon"><MonitorDown size={16} /></span>
      <div className="install-banner-copy">
        <strong>Install Meet</strong>
        {showIosHint && !installEvent
          ? <small>Open Share and choose “Add to Home Screen” for the full-screen app.</small>
          : <small>Its own window, quicker to open — works like a native app.</small>}
      </div>
      {installEvent && <button className="install-banner-action" onClick={() => void install()}>Install</button>}
      <button className="install-banner-close" onClick={dismiss} aria-label="Not now"><X size={15} /></button>
    </div>
  );
}
