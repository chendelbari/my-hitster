import { getAccessToken } from './auth';

const API = 'https://api.spotify.com/v1';

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  /** Year of the specific album/release on Spotify — often a remaster or compilation. */
  spotifyYear: number | null;
}

export class SpotifyError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: RequestInit = {}, retried = false, refreshToken = false): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getAccessToken(refreshToken)}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 401 && !retried) return api(path, init, true, true);
  if (res.status === 429 && !retried) {
    const wait = Number(res.headers.get('Retry-After') ?? '1');
    await new Promise((r) => setTimeout(r, wait * 1000));
    return api(path, init, true);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new SpotifyError(res.status, body?.error?.reason, body?.error?.message ?? res.statusText);
  }
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : null;
}

interface PlaylistPage {
  next: string | null;
  // Since Feb 2026 the track sits under `item`; `track` is the deprecated alias.
  items: { is_local?: boolean; item?: RawTrack | null; track?: RawTrack | null }[];
}

interface RawTrack {
  id: string | null;
  uri: string;
  type: string;
  name: string;
  artists: { name: string }[];
  album?: { release_date?: string };
}

export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const tracks: Track[] = [];
  for (let offset = 0; ; offset += 50) {
    const page = await api<PlaylistPage>(`/playlists/${playlistId}/items?limit=50&offset=${offset}`);
    for (const entry of page?.items ?? []) {
      const t = entry.item ?? entry.track;
      if (!t || entry.is_local || t.type !== 'track' || !t.id) continue;
      const year = parseInt(t.album?.release_date?.slice(0, 4) ?? '', 10);
      tracks.push({
        id: t.id,
        uri: t.uri,
        name: t.name,
        artists: t.artists.map((a) => a.name),
        spotifyYear: Number.isFinite(year) && year > 0 ? year : null,
      });
    }
    if (!page?.next) break;
  }
  return tracks;
}

interface Device {
  id: string | null;
  is_active: boolean;
  is_restricted: boolean;
  type: string;
  name: string;
}

/** Picks the device to play on: the active one, else a phone, else anything. Null if Spotify isn't open anywhere. */
export async function findDevice(): Promise<string | null> {
  const res = await api<{ devices: Device[] }>('/me/player/devices');
  const devices = (res?.devices ?? []).filter((d) => d.id && !d.is_restricted);
  const device =
    devices.find((d) => d.is_active) ??
    devices.find((d) => d.type === 'Smartphone') ??
    devices[0];
  return device?.id ?? null;
}

export async function playTrack(deviceId: string, uri: string): Promise<void> {
  await api(`/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri], position_ms: 0 }),
  });
}

export async function resume(deviceId: string): Promise<void> {
  await api(`/me/player/play?device_id=${deviceId}`, { method: 'PUT' });
}

export async function pause(): Promise<void> {
  await api('/me/player/pause', { method: 'PUT' });
}

export interface PlaybackState {
  isPlaying: boolean;
  uri: string | null;
}

export async function getPlaybackState(): Promise<PlaybackState | null> {
  const res = await api<{ is_playing: boolean; item?: { uri: string } | null }>('/me/player');
  return res ? { isPlaying: res.is_playing, uri: res.item?.uri ?? null } : null;
}
