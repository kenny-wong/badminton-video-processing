// JSON responses for the API routes in api/.

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** An error the page can show: a short `error` code and a sentence for people. */
export const fail = (status, error, message = '') => json({ error, message }, status);

/** Logs the error and answers 500 with its message (the app runs only on this PC). */
export function serverError(err, where) {
  console.error(where, err);
  return fail(500, 'server', err?.message ?? String(err));
}

export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

/** A positive whole-number id from a route parameter, or null. */
export const idParam = (v) => (/^\d{1,9}$/.test(v ?? '') && Number(v) > 0 ? Number(v) : null);
