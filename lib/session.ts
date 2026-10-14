/**
 * The session cookie's name, alone in its own module: middleware runs on the
 * Edge runtime and must not drag lib/auth's MongoDB import into its bundle.
 */
export const SESSION_COOKIE_NAME = "converge_session";
