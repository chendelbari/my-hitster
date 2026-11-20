// The Client ID is public by design (PKCE flow, no client secret).
export const CLIENT_ID = '1d89ad3b522b4192bf55b4b03aa1ab22';
export const PLAYLIST_ID = '2guGSyYpzXYeggO1B2xLGi';

// Must exactly match a Redirect URI registered in the Spotify app settings.
export const REDIRECT_URI = import.meta.env.DEV
  ? 'http://127.0.0.1:5173/callback'
  : `${location.origin}${import.meta.env.BASE_URL}`;

export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-playback-state',
  'user-modify-playback-state',
];
