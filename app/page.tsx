import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import Dashboard from "./dashboard";
import { Landing } from "./components/landing";

/**
 * "/" wears two hats: the marketing landing for visitors, the Overview
 * dashboard for people who are signed in. A present cookie is enough to pick
 * the dashboard — if the session turns out to be dead, the dashboard's own
 * auth check sends them to /login.
 */
export default function HomePage() {
  const hasSession = Boolean(cookies().get(SESSION_COOKIE_NAME)?.value);
  return hasSession ? <Dashboard view="Overview" /> : <Landing />;
}
