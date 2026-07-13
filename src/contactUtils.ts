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

/** Visible labels = categories minus the reserved Favorite marker. */
export function contactLabels(c: Contact): string[] {
  return contactCategories(c).filter((x) => x.toLowerCase() !== FAVORITE_LABEL.toLowerCase());
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
