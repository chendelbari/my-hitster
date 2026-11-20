// Finds a song's ORIGINAL release year. Spotify's album date is often a remaster or
// compilation, so we ask MusicBrainz for the earliest release of a recording with the
// same title by the same artist.

const VERSION_WORDS =
  /\b(remaster(ed)?|version|edit|re-?mix|mix|mono|stereo|live|single|radio|deluxe|anniversary|bonus|demo|acoustic|feat|ft|with|from|recorded)\b/i;

/** "Bohemian Rhapsody - Remastered 2011" → "Bohemian Rhapsody"; "Song (feat. X)" → "Song". */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, (m) => (VERSION_WORDS.test(m) ? '' : m))
    .trim();
}

/** Loose comparison key: case, accents, punctuation and "&"/"and" don't matter. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\p{L}]/gu, '');
}

export interface MbRecording {
  title: string;
  'artist-credit'?: { name: string; artist?: { name: string } }[];
  releases?: { date?: string; status?: string }[];
}

/**
 * Release years of the recordings that really are this song by this artist.
 * Only the Spotify title is cleaned: in MusicBrainz, remixes/live/long versions are
 * separate recordings with their own titles, and they must not count (they're later,
 * or carry bogus dates). Only official releases count: bootlegs often carry made-up dates.
 */
export function matchingYears(recordings: MbRecording[], title: string, artists: string[]): number[] {
  const wantTitle = normalize(cleanTitle(title));
  const wantArtists = new Set(artists.map(normalize));
  return recordings
    .filter((r) => normalize(r.title) === wantTitle)
    .filter((r) =>
      (r['artist-credit'] ?? []).some(
        (c) => wantArtists.has(normalize(c.name)) || wantArtists.has(normalize(c.artist?.name ?? '')),
      ),
    )
    .flatMap((r) => r.releases ?? [])
    .filter((rel) => rel.status === 'Official')
    .map((rel) => parseInt(rel.date?.slice(0, 4) ?? '', 10))
    .filter((y) => Number.isFinite(y) && y > 1800);
}

function phrase(s: string): string {
  return `"${s.replace(/[’‘]/g, "'").replace(/["\\]/g, '\\$&')}"`;
}

// MusicBrainz allows ~1 request/second per client and answers 503 when busy.
let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function searchRecordings(query: string): Promise<MbRecording[]> {
  const url = `https://musicbrainz.org/ws/2/recording?fmt=json&limit=100&query=${encodeURIComponent(query)}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const wait = lastRequestAt + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const res = await fetch(url);
    if (res.ok) return ((await res.json()).recordings ?? []) as MbRecording[];
    if (res.status === 400) return []; // query MusicBrainz can't parse: treat as "not found"
    await sleep(Math.min(1500 * (attempt + 1), 8000));
  }
  throw new Error('MusicBrainz is busy');
}

/**
 * Earliest year MusicBrainz knows for this song, or null if it knows nothing earlier
 * than Spotify's year. Each round asks only for releases *before* the best year so
 * far, so popular songs with hundreds of versions still take just a few requests.
 */
export async function findEarliestYear(
  title: string,
  artists: string[],
  spotifyYear: number | null,
): Promise<number | null> {
  const base = `recording:${phrase(cleanTitle(title))} AND artist:${phrase(artists[0] ?? '')}`;
  let best: number | null = null;
  let before = spotifyYear;
  for (let round = 0; round < 8; round++) {
    const query = before === null ? base : `${base} AND firstreleasedate:[0000 TO ${before - 1}-12-31]`;
    const years = matchingYears(await searchRecordings(query), title, artists).filter(
      (y) => before === null || y < before,
    );
    if (years.length === 0) break;
    best = Math.min(...years);
    before = best;
  }
  return best;
}
