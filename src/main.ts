import './style.css';
import { handleRedirect, isLoggedIn, login } from './auth';
import { PLAYLIST_ID } from './config';
import { reconcile, shuffle, type Queue } from './queue';
import {
  findDevice,
  getPlaybackState,
  getPlaylistTracks,
  pause,
  playTrack,
  resume,
  SpotifyError,
  type Track,
} from './spotify';
import { cleanTitle, findEarliestYear } from './year';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const QUEUE_KEY = `hitster.queue.${PLAYLIST_ID}`;
const YEARS_KEY = 'hitster.years';

const tracks = new Map<string, Track>();
let queue: Queue = { order: [], index: 0 };
// Original release year per track id; null = unknown. Missing key = not looked up yet.
const years: Record<string, number | null> = JSON.parse(localStorage.getItem(YEARS_KEY) ?? '{}');
const yearLookupFailed = new Set<string>();

let revealed = false;
let isPlaying = false;
/** The track we last started on Spotify, so play after pause resumes instead of restarting. */
let startedUri: string | null = null;
let deviceId: string | null = null;
let busy = false;
let lastCommandAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const currentTrack = () => tracks.get(queue.order[queue.index])!;

function show(section: 'login' | 'loading' | 'game', loadingText = 'Loading…') {
  for (const id of ['login', 'loading', 'game']) $(id).hidden = id !== section;
  $('loading-text').textContent = loadingText;
}

let toastTimer = 0;
function toast(message: string) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 6000);
}

function saveQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function render() {
  const track = currentTrack();
  $('counter').textContent = `Song ${queue.index + 1} / ${queue.order.length}`;
  $<HTMLButtonElement>('prev').disabled = queue.index === 0;
  $('play-icon').hidden = isPlaying;
  $('pause-icon').hidden = !isPlaying;
  $('play').setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  $('card').classList.toggle('playing', isPlaying);

  $('hidden-face').hidden = revealed;
  $('revealed-face').hidden = !revealed;
  $('reveal').textContent = revealed ? 'Hide' : 'Reveal';
  if (!revealed) return;

  $('title').textContent = cleanTitle(track.name);
  $('artist').textContent = track.artists.join(', ');
  if (track.id in years) {
    $('year').textContent = String(years[track.id] ?? '?');
    $('year-note').textContent = '';
  } else if (yearLookupFailed.has(track.id)) {
    $('year').textContent = String(track.spotifyYear ?? '?');
    $('year-note').textContent = "Spotify's date — couldn't check the original year yet";
  } else {
    $('year').textContent = '…';
    $('year-note').textContent = 'Looking up the original year';
  }
}

// --- Playback ---------------------------------------------------------------

function explain(e: unknown): string {
  if (e instanceof SpotifyError) {
    if (e.status === 404) return 'Open the Spotify app on your phone, then tap play again.';
    if (e.reason === 'PREMIUM_REQUIRED') return 'Spotify Premium is required for playback.';
    return `Spotify error: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Runs a playback command on the user's device, finding the device (once more) if Spotify lost it. */
async function onDevice(command: (device: string) => Promise<void>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    deviceId ??= await findDevice();
    if (!deviceId) throw new SpotifyError(404, 'NO_ACTIVE_DEVICE', 'No device');
    try {
      return await command(deviceId);
    } catch (e) {
      if (!(e instanceof SpotifyError && e.status === 404) || attempt === 1) throw e;
      deviceId = null;
    }
  }
}

async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  lastCommandAt = Date.now();
  try {
    await action();
  } catch (e) {
    toast(explain(e));
  } finally {
    busy = false;
    lastCommandAt = Date.now();
    render();
  }
}

async function startCurrent() {
  const uri = currentTrack().uri;
  await onDevice((d) => playTrack(d, uri));
  startedUri = uri;
  isPlaying = true;
}

function togglePlay() {
  run(async () => {
    if (isPlaying) {
      await pause();
      isPlaying = false;
    } else if (startedUri === currentTrack().uri) {
      await onDevice(resume);
      isPlaying = true;
    } else {
      await startCurrent();
    }
  });
}

function go(delta: number) {
  if (busy) return;
  let next = queue.index + delta;
  if (next < 0) return;
  if (next >= queue.order.length) {
    queue.order = shuffle(queue.order);
    next = 0;
    toast('That was the last song — reshuffled for a new round!');
  }
  queue.index = next;
  revealed = false;
  saveQueue();
  render();
  run(startCurrent);
}

function reshuffle() {
  if (!confirm('Start over with a new shuffle?')) return;
  queue = { order: shuffle(queue.order), index: 0 };
  revealed = false;
  startedUri = null;
  saveQueue();
  render();
  if (isPlaying)
    run(async () => {
      await pause();
      isPlaying = false;
    });
}

/** Keeps the play/pause button honest when playback changes outside the app (song ended, paused from notification…). */
async function syncPlayback() {
  if (document.hidden || busy || Date.now() - lastCommandAt < 3000) return;
  try {
    const state = await getPlaybackState();
    if (busy || Date.now() - lastCommandAt < 3000) return;
    const onOurSong = !!state && state.uri === currentTrack().uri;
    if (!onOurSong) startedUri = null;
    isPlaying = onOurSong && state!.isPlaying;
    render();
  } catch {
    // Polling is best effort.
  }
}

// --- Original-year lookups --------------------------------------------------

/** Next track without a year, starting from the current song so it's ready by the time you reveal. */
function nextTrackNeedingYear(): Track | undefined {
  const n = queue.order.length;
  for (let i = 0; i < n; i++) {
    const id = queue.order[(queue.index + i) % n];
    if (!(id in years)) return tracks.get(id);
  }
}

async function yearWorker() {
  for (;;) {
    const track = nextTrackNeedingYear();
    if (!track) {
      await sleep(5000);
      continue;
    }
    try {
      const earliest = await findEarliestYear(track.name, track.artists, track.spotifyYear);
      years[track.id] = earliest ?? track.spotifyYear;
      localStorage.setItem(YEARS_KEY, JSON.stringify(years));
    } catch {
      yearLookupFailed.add(track.id);
      await sleep(15_000);
    }
    if (track.id === currentTrack().id) render();
  }
}

// --- Start-up ---------------------------------------------------------------

async function start() {
  $('login-btn').onclick = () => login();
  $('play').onclick = togglePlay;
  $('prev').onclick = () => go(-1);
  $('next').onclick = () => go(1);
  $('reshuffle').onclick = reshuffle;
  $('reveal').onclick = () => {
    revealed = !revealed;
    render();
  };
  $('toast').onclick = () => ($('toast').hidden = true);

  try {
    const loginError = await handleRedirect();
    if (loginError) toast(loginError);
  } catch (e) {
    toast(explain(e));
  }
  if (!isLoggedIn()) return show('login');

  show('loading', 'Loading your playlist…');
  let list: Track[];
  try {
    list = await getPlaylistTracks(PLAYLIST_ID);
  } catch (e) {
    if (!isLoggedIn()) return show('login');
    const msg =
      e instanceof SpotifyError && e.status === 403
        ? "Spotify won't share this playlist's songs — it must be a playlist you created."
        : explain(e);
    return show('loading', msg);
  }
  if (list.length === 0) return show('loading', 'The playlist is empty — add some songs in Spotify.');

  for (const t of list) tracks.set(t.id, t);
  const saved = localStorage.getItem(QUEUE_KEY);
  queue = reconcile(saved ? JSON.parse(saved) : null, [...tracks.keys()]);
  saveQueue();

  show('game');
  render();
  yearWorker();
  setInterval(syncPlayback, 5000);
  document.addEventListener('visibilitychange', syncPlayback);
}

start();
