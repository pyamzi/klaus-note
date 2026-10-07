/** A Shift selection is an inclusive range; an additive click toggles one row. */
export function selectRows(ids: bigint[], current: Set<bigint>, id: bigint, anchor: bigint | undefined, range: boolean, additive: boolean): Set<bigint> {
  if (range && anchor !== undefined && ids.includes(anchor)) {
    const a = ids.indexOf(anchor), b = ids.indexOf(id);
    if (b < 0) return new Set(current);
    return new Set([...(additive ? current : []), ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)]);
  }
  if (!additive) return new Set([id]);
  const next = new Set(current);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function selectionSearch(ids: bigint[], notes: boolean): string {
  if (!ids.length) throw new Error("Select at least one row.");
  return `${notes ? "nid" : "cid"}:${ids.join(",")}`;
}
