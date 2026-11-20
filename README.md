# My Hitster

A tiny single-player take on Hitster: plays a random song from one Spotify playlist
without showing what it is, and reveals the title, artist and **original** release year
on demand.

Live at **https://chendelbari.github.io/my-hitster/**. Open it on your phone, log in with
Spotify once, and optionally add it to the home screen.

## How it works

- **Playback**: the page is a remote control. It tells the Spotify app on your phone
  (Spotify Connect, Web API) which song to play, so the Spotify app must be open or
  recently used. Spotify Premium is required.
- **Order**: the playlist is shuffled once; back/forward walk that order. Progress is
  remembered. Songs added to the playlist later are slotted in ahead of you. The shuffle
  button in the corner starts over.
- **Original year**: Spotify's date is often a remaster/compilation. The app asks
  [MusicBrainz](https://musicbrainz.org) for the earliest *official* release of the same
  recording title by the same artist, and falls back to Spotify's year if nothing earlier
  is known. Years are looked up in the background, starting with the current song, and
  cached on the phone.

Settings (Client ID, playlist) are in `src/config.ts`.

## Development

```sh
npm install
npm run dev     # http://127.0.0.1:5173 (must be 127.0.0.1, not localhost, for Spotify login)
npm test
```

Spotify app redirect URIs: `http://127.0.0.1:5173/callback` (dev) and
`https://chendelbari.github.io/my-hitster/` (production). Pushing to `main` deploys via
GitHub Actions.
