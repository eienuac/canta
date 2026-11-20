/**
 * Auth cookie options for every Supabase client (browser, server, proxy).
 * `secure` keeps the session cookie off plain-HTTP requests in production; it stays readable
 * by client JS (httpOnly: false) because the browser client manages the session itself.
 */
export const supabaseCookieOptions = {
  path: '/',
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
}
