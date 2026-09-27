export interface CheckoutSplitPostavka {
  id: number;
  parentPostavkaId?: number | null;
}

/**
 * Expand a split selection to the full connected modifier component, matching
 * the server's rule that ancestors and all their descendants stay together.
 */
export function expandCheckoutSplitPostavkaIds(
  selectedIds: Iterable<number>,
  postavke: readonly CheckoutSplitPostavka[],
): Set<number> {
  const postavkeById = new Map(postavke.map(postavka => [postavka.id, postavka]));
  const childrenByParentId = new Map<number, number[]>();
  for (const postavka of postavke) {
    if (postavka.parentPostavkaId == null) continue;
    const children = childrenByParentId.get(postavka.parentPostavkaId) ?? [];
    children.push(postavka.id);
    childrenByParentId.set(postavka.parentPostavkaId, children);
  }

  const expanded = new Set([...selectedIds].filter(id => postavkeById.has(id)));
  const pending = [...expanded];
  while (pending.length > 0) {
    const id = pending.pop()!;
    const postavka = postavkeById.get(id)!;
    const relatedIds = [
      ...(postavka.parentPostavkaId != null && postavkeById.has(postavka.parentPostavkaId)
        ? [postavka.parentPostavkaId]
        : []),
      ...(childrenByParentId.get(id) ?? []),
    ];
    for (const relatedId of relatedIds) {
      if (expanded.has(relatedId)) continue;
      expanded.add(relatedId);
      pending.push(relatedId);
    }
  }
  return expanded;
}

export function toggleCheckoutSplitPostavka(
  selectedIds: Iterable<number>,
  postavkaId: number,
  checked: boolean,
  postavke: readonly CheckoutSplitPostavka[],
): Set<number> {
  const relatedIds = expandCheckoutSplitPostavkaIds([postavkaId], postavke);
  if (checked) {
    return expandCheckoutSplitPostavkaIds([...selectedIds, postavkaId], postavke);
  }

  const next = expandCheckoutSplitPostavkaIds(selectedIds, postavke);
  relatedIds.forEach(id => next.delete(id));
  return next;
}