// The play order: the playlist shuffled once, walked with back/forward.

export interface Queue {
  order: string[]; // track ids
  index: number;
}

export function shuffle<T>(items: T[], random = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Brings a saved queue in line with the playlist's current contents: removed songs
 * drop out, newly added songs are slotted in at random spots still ahead of you.
 */
export function reconcile(saved: Queue | null, trackIds: string[], random = Math.random): Queue {
  if (!saved) return { order: shuffle(trackIds, random), index: 0 };

  const current = new Set(trackIds);
  const known = new Set(saved.order);
  const currentId = saved.order[saved.index];

  const order = saved.order.filter((id) => current.has(id));
  // Stay on the same song if it still exists; otherwise on whatever slid into its place.
  let index = currentId && current.has(currentId) ? order.indexOf(currentId) : Math.min(saved.index, order.length - 1);
  index = Math.max(index, 0);

  for (const id of shuffle(trackIds.filter((id) => !known.has(id)), random)) {
    const at = index + 1 + Math.floor(random() * (order.length - index));
    order.splice(Math.min(at, order.length), 0, id);
  }
  return { order, index };
}
