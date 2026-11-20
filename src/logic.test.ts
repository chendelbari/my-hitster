import { describe, expect, it } from 'vitest';
import { cleanTitle, matchingYears, normalize, type MbRecording } from './year';
import { reconcile, shuffle } from './queue';

describe('cleanTitle', () => {
  it.each([
    ['Bohemian Rhapsody - Remastered 2011', 'Bohemian Rhapsody'],
    ["Don't Stop Me Now - 2011 Mix", "Don't Stop Me Now"],
    ['Levitating (feat. DaBaby)', 'Levitating'],
    ['Dancing Queen (Live)', 'Dancing Queen'],
    ['Smells Like Teen Spirit [Remastered]', 'Smells Like Teen Spirit'],
    ["(I Can't Get No) Satisfaction - Mono Version", "(I Can't Get No) Satisfaction"],
    ['Somebody (Alive)', 'Somebody (Alive)'],
  ])('%s → %s', (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
  });
});

describe('normalize', () => {
  it('ignores case, accents, punctuation and &', () => {
    expect(normalize('Beyoncé')).toBe(normalize('BEYONCE'));
    expect(normalize('Simon & Garfunkel')).toBe(normalize('Simon and Garfunkel'));
    expect(normalize('Don’t Stop')).toBe(normalize("Don't stop"));
  });
});

describe('matchingYears', () => {
  const rec = (title: string, artist: string, date?: string, status = 'Official'): MbRecording => ({
    title,
    'artist-credit': [{ name: artist }],
    releases: [{ date, status }],
  });

  it('keeps only same title by same artist, not live/remix versions', () => {
    const years = matchingYears(
      [
        rec('Bohemian Rhapsody', 'Queen', '1975-10-31'),
        rec('Bohemian Rhapsody (live)', 'Queen', '1979'),
        rec('Bohemian Rhapsody', 'Queen Latifah', '1970'),
        rec('Intro: Bohemian Rhapsody', 'Queen', '1960'),
        rec('Bohemian Rhapsody', 'Queen'),
      ],
      'Bohemian Rhapsody - Remastered 2011',
      ['Queen'],
    );
    expect(years).toEqual([1975]);
  });

  it('ignores bootleg releases', () => {
    expect(matchingYears([rec('Billie Jean', 'Michael Jackson', '1978', 'Bootleg')], 'Billie Jean', ['Michael Jackson'])).toEqual([]);
  });

  it('matches any credited artist', () => {
    expect(matchingYears([rec('Under Pressure', 'David Bowie', '1981')], 'Under Pressure', ['Queen', 'David Bowie'])).toEqual([1981]);
  });
});

describe('queue', () => {
  const seq = (...values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it('shuffle keeps every item exactly once', () => {
    const items = Array.from({ length: 50 }, (_, i) => String(i));
    expect([...shuffle(items)].sort()).toEqual([...items].sort());
  });

  it('starts a fresh shuffle when nothing is saved', () => {
    const q = reconcile(null, ['a', 'b', 'c']);
    expect(q.index).toBe(0);
    expect([...q.order].sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops removed songs and stays on the current song', () => {
    const q = reconcile({ order: ['a', 'b', 'c', 'd'], index: 2 }, ['a', 'c', 'd']);
    expect(q).toEqual({ order: ['a', 'c', 'd'], index: 1 });
  });

  it('inserts new songs only ahead of the current position', () => {
    const q = reconcile({ order: ['a', 'b', 'c'], index: 1 }, ['a', 'b', 'c', 'x', 'y'], seq(0, 0.99, 0.5));
    expect(q.order.slice(0, 2)).toEqual(['a', 'b']);
    expect(q.index).toBe(1);
    expect([...q.order].sort()).toEqual(['a', 'b', 'c', 'x', 'y']);
  });

  it('handles the current song being removed', () => {
    const q = reconcile({ order: ['a', 'b', 'c'], index: 2 }, ['a', 'b']);
    expect(q).toEqual({ order: ['a', 'b'], index: 1 });
  });
});
