import { Contact } from "./types";

/** Favorites are implemented the Google way: a reserved CATEGORIES value, so a
 *  starred contact rides vCard `CATEGORIES` (syncs, and is a filter value) while
 *  being special-cased in the UI (rendered as a star, hidden from label chips). */
export const FAVORITE_LABEL = "Favorite";

export function contactCategories(c: Contact): string[] {
  return (c.categories || "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function isFavorite(c: Contact): boolean {
  return contactCategories(c).some((x) => x.toLowerCase() === FAVORITE_LABEL.toLowerCase());
}

/** Labels this contact carries via CardDAV group cards (Synology labels),
 *  decorated onto the row by the main process. */
export function contactGroupLabels(c: Contact): string[] {
  return (c.group_labels || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Visible labels = own categories (minus the Favorite marker) merged with any
 *  labels inherited from group cards, de-duplicated case-insensitively. */
export function contactLabels(c: Contact): string[] {
  const own = contactCategories(c).filter((x) => x.toLowerCase() !== FAVORITE_LABEL.toLowerCase());
  const out: string[] = [...own];
  const seen = new Set(own.map((x) => x.toLowerCase()));
  for (const g of contactGroupLabels(c)) {
    if (!seen.has(g.toLowerCase())) { out.push(g); seen.add(g.toLowerCase()); }
  }
  return out;
}

/** The categories string with the Favorite marker toggled on/off. */
export function toggleFavoriteCategories(c: Contact): string {
  const cats = contactCategories(c);
  const has = cats.some((x) => x.toLowerCase() === FAVORITE_LABEL.toLowerCase());
  const next = has
    ? cats.filter((x) => x.toLowerCase() !== FAVORITE_LABEL.toLowerCase())
    : [...cats, FAVORITE_LABEL];
  return next.join(", ");
}

export type ContactFilter =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "book"; value: string }
  | { kind: "label"; value: string };

export function matchesFilter(c: Contact, f: ContactFilter): boolean {
  switch (f.kind) {
    case "all": return true;
    case "favorites": return isFavorite(c);
    case "book": return c.address_book_id === f.value;
    case "label": return contactLabels(c).includes(f.value);
    default: return true;
  }
}

/** Persisted map of label name -> color hex (stored as a settings JSON blob). */
export type LabelColors = Record<string, string>;

/** Initials for the avatar circle when there's no photo. */
export function initials(c: Contact): string {
  const a = (c.first_name || "").trim();
  const b = (c.last_name || "").trim();
  if (a || b) return `${a[0] || ""}${b[0] || ""}`.toUpperCase();
  const fn = (c.fn || "").trim();
  return (fn[0] || "?").toUpperCase();
}

// ---------- Duplicate detection (for the manual merge review) ----------

/** Typed-value JSON column ([{type,value}]) -> array of value strings. */
function jsonValues(json: string): string[] {
  try {
    const a = JSON.parse(json || "[]");
    return Array.isArray(a) ? a.map((x) => String(x?.value ?? "")).filter(Boolean) : [];
  } catch { return []; }
}

export function contactNameKey(c: Contact): string {
  return (c.fn || `${c.first_name} ${c.last_name}`).trim().toLowerCase().replace(/\s+/g, " ");
}
export function contactEmailKeys(c: Contact): string[] {
  return jsonValues(c.emails).map((v) => v.trim().toLowerCase()).filter(Boolean);
}
/** Last 10 digits, so formatting and a +1 country code don't defeat matching. */
export function contactPhoneKeys(c: Contact): string[] {
  return jsonValues(c.phones)
    .map((v) => v.replace(/\D/g, ""))
    .map((d) => (d.length > 10 ? d.slice(-10) : d))
    .filter((d) => d.length >= 7);
}

/** Stable key for a pair of contact ids (order-independent), used to remember
 *  "not a duplicate" dismissals. */
export function dupPairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Cluster contacts that likely refer to the same person: any two that share a
 *  normalized name OR an email OR a phone are linked, and connected groups of
 *  2+ are returned as suggestions. A dismissed pair (in `dismissed`) does not
 *  create a link, so declining a suggestion (e.g. the Sandlins, who only share
 *  a household phone) keeps it from reappearing. Nothing here merges anything —
 *  it only proposes; the user approves each merge manually. */
export function findDuplicateClusters(contacts: Contact[], dismissed: Set<string> = new Set()): Contact[][] {
  const live = contacts.filter((c) => !c.deleted);
  const n = live.length;

  // Build candidate links via shared signal buckets (name/email/phone).
  const buckets = new Map<string, number[]>();
  const add = (key: string, i: number) => {
    if (!key) return;
    const arr = buckets.get(key) ?? buckets.set(key, []).get(key)!;
    arr.push(i);
  };
  live.forEach((c, i) => {
    add("n:" + contactNameKey(c), i);
    for (const e of contactEmailKeys(c)) add("e:" + e, i);
    for (const p of contactPhoneKeys(c)) add("p:" + p, i);
  });

  // Union-find over indices, linking members that share a bucket (unless that
  // specific pair was dismissed).
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    for (let k = 1; k < arr.length; k++) {
      const a = arr[0], b = arr[k];
      if (dismissed.has(dupPairKey(live[a].id, live[b].id))) continue;
      union(a, b);
    }
  }

  const groups = new Map<number, Contact[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(live[i]);
  }
  // Only clusters of 2+, and drop clusters where every internal pair was
  // dismissed (they can still form via a chain, so re-check).
  const out: Contact[][] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const anyLive = g.some((a, i) => g.some((b, j) => j > i && !dismissed.has(dupPairKey(a.id, b.id))));
    if (anyLive) out.push(g.sort((a, b) => (a.fn || "").localeCompare(b.fn || "")));
  }
  return out.sort((a, b) => b.length - a.length);
}
