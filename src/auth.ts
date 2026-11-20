import { CLIENT_ID, REDIRECT_URI, SCOPES } from './config';

// Spotify Authorization Code flow with PKCE: no client secret, safe for a static site.
// Tokens live in localStorage so the phone stays logged in between sessions.

const TOKEN_KEY = 'hitster.token';
// localStorage, not sessionStorage: on Android the login may bounce through the
// Spotify app and come back in a different browser tab.
const VERIFIER_KEY = 'hitster.pkce';

interface Token {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function loadToken(): Token | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  return raw ? (JSON.parse(raw) as Token) : null;
}

function saveToken(res: TokenResponse, previousRefresh?: string): void {
  const token: Token = {
    accessToken: res.access_token,
    // Spotify may or may not rotate the refresh token.
    refreshToken: res.refresh_token ?? previousRefresh ?? '',
    expiresAt: Date.now() + res.expires_in * 1000,
  };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  if (!res.ok) throw new AuthError(res.status, `Spotify login failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export function isLoggedIn(): boolean {
  return loadToken() !== null;
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function login(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  localStorage.setItem(VERIFIER_KEY, verifier);

  const url = new URL('https://accounts.spotify.com/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: base64url(new Uint8Array(digest)),
  }).toString();
  location.assign(url.toString());
}

/** Completes the login if Spotify just redirected back with ?code=. Returns an error message if the login was refused. */
export async function handleRedirect(): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const error = params.get('error');
  if (!code && !error) return null;

  history.replaceState(null, '', import.meta.env.BASE_URL);
  if (error) return `Spotify login was cancelled (${error}).`;

  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) return 'Login expired, please try again.';
  localStorage.removeItem(VERIFIER_KEY);

  saveToken(
    await requestToken({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  );
  return null;
}

/** Returns a valid access token, refreshing it if needed. */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  const token = loadToken();
  if (!token) throw new Error('Not logged in');
  if (!forceRefresh && Date.now() < token.expiresAt - 60_000) return token.accessToken;

  try {
    saveToken(
      await requestToken({ grant_type: 'refresh_token', refresh_token: token.refreshToken }),
      token.refreshToken,
    );
  } catch (e) {
    // A revoked/invalid refresh token means a fresh login is needed; a network blip doesn't.
    if (e instanceof AuthError && e.status === 400) logout();
    throw e;
  }
  return loadToken()!.accessToken;
}
