/**
 * The one way client components call the app's API.
 *
 * Every screen used to repeat the same dance — fetch, parse JSON, check `ok`,
 * dig out `data.error`, fall back to a generic message. `requestJson` owns that
 * dance: it resolves with the parsed body or throws an `Error` whose message is
 * already the right thing to show the user.
 */

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON-serialized and sent with the right Content-Type. */
  body?: unknown;
  /** Shown when the server gave no usable error message. */
  fallbackError?: string;
};

export async function requestJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, fallbackError = "Something went wrong. Please try again." } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Offline / DNS failure: the browser's TypeError message ("Failed to fetch")
    // is not something to show a person — use the caller's words instead.
    throw new Error(fallbackError);
  }

  // Error responses may not be JSON (proxies, crashes) — never let parsing mask the failure.
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
    throw new Error(message || fallbackError);
  }
  return data as T;
}
