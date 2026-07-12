import ICAL from "ical.js";
import { nanoid } from "nanoid";

// Pure vCard (CardDAV) serialization layer -- mirrors ical.ts for calendars.
// Deliberately has NO dependency on db.ts: it speaks a plain ParsedContact
// (arrays for multi-value fields); the sync/UI layer maps that to/from the
// Contact row (which stores the arrays as JSON-text columns). vCard 3.0 on the
// wire for maximum client compatibility (Synology, DAVx5, iOS).

export interface TypedValue {
  type: string; // lowercased vCard TYPE (home/work/cell/...), or ""
  value: string;
}
export interface PostalAddress {
  type: string;
  street: string;
  city: string;
  region: string;
  postal: string;
  country: string;
}
export interface ParsedContact {
  uid: string | null;
  fn: string;
  prefix: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  nickname: string;
  org: string;
  title: string;
  bday: string | null; // "YYYY-MM-DD" or "--MM-DD" (year-less)
  anniversary: string | null;
  notes: string;
  categories: string; // comma-separated
  photo: string; // data URI or ""
  phones: TypedValue[];
  emails: TypedValue[];
  addresses: PostalAddress[];
  urls: TypedValue[];
  impps: TypedValue[];
  related: TypedValue[];
}

export function newContactUid(): string {
  return `${nanoid()}@tasks-desktop`;
}

export function displayName(c: ParsedContact): string {
  const joined = [c.prefix, c.first_name, c.middle_name, c.last_name, c.suffix]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  return joined || "Unnamed";
}

/** A property's TYPE parameter as a single lowercased string (vCard allows
 *  several; we keep the first meaningful one). */
function typeOf(prop: ICAL.Property): string {
  const t = prop.getParameter("type");
  if (!t) return "";
  const val = Array.isArray(t) ? t[0] : t;
  return String(val || "").toLowerCase();
}

/** Components of a structured value (N, ADR), as plain strings. */
function structuredParts(prop: ICAL.Property | null): string[] {
  if (!prop) return [];
  const v = prop.getFirstValue();
  if (Array.isArray(v)) return v.map((x) => (x == null ? "" : String(x)));
  return [String(v ?? "")];
}

/** A date-ish value (BDAY/ANNIVERSARY) as a stored string, preserving
 *  year-less forms. */
function dateStr(prop: ICAL.Property | null): string | null {
  if (!prop) return null;
  const v = prop.getFirstValue();
  const s = v == null ? "" : (typeof v === "string" ? v : (v as any).toString?.() ?? String(v));
  return s || null;
}

function readPhoto(comp: ICAL.Component): string {
  const p = comp.getFirstProperty("photo");
  if (!p) return "";
  const v = String(p.getFirstValue() ?? "");
  if (!v) return "";
  if (v.startsWith("data:") || v.startsWith("http")) return v;
  // vCard 3.0 inline: PHOTO;ENCODING=b;TYPE=JPEG:<base64>
  const enc = p.getParameter("encoding");
  const type = p.getParameter("type");
  if (enc || type) {
    const t = type ? String(Array.isArray(type) ? type[0] : type).toLowerCase() : "jpeg";
    return `data:image/${t};base64,${v}`;
  }
  return v;
}

export function parseVCard(vcf: string): ParsedContact | null {
  try {
    const comp = new ICAL.Component(ICAL.parse(vcf));
    // N: [family, given, additional, prefixes, suffixes]
    const n = structuredParts(comp.getFirstProperty("n"));
    const orgProp = comp.getFirstProperty("org");
    const orgVal = orgProp
      ? (Array.isArray(orgProp.getFirstValue())
          ? (orgProp.getFirstValue() as unknown as string[]).filter(Boolean).join(", ")
          : String(orgProp.getFirstValue() ?? ""))
      : "";
    const cats = comp.getFirstProperty("categories");

    const mapTyped = (name: string): TypedValue[] =>
      comp.getAllProperties(name).map((p) => ({ type: typeOf(p), value: String(p.getFirstValue() ?? "") })).filter((v) => v.value);

    const addresses: PostalAddress[] = comp.getAllProperties("adr").map((p) => {
      // ADR: [pobox, ext, street, city, region, postal, country]
      const a = structuredParts(p);
      return {
        type: typeOf(p),
        street: a[2] || "",
        city: a[3] || "",
        region: a[4] || "",
        postal: a[5] || "",
        country: a[6] || ""
      };
    });

    return {
      uid: (comp.getFirstPropertyValue("uid") as string) || null,
      fn: (comp.getFirstPropertyValue("fn") as string) || "",
      last_name: n[0] || "",
      first_name: n[1] || "",
      middle_name: n[2] || "",
      prefix: n[3] || "",
      suffix: n[4] || "",
      nickname: (comp.getFirstPropertyValue("nickname") as string) || "",
      org: orgVal,
      title: (comp.getFirstPropertyValue("title") as string) || "",
      bday: dateStr(comp.getFirstProperty("bday")),
      anniversary: dateStr(comp.getFirstProperty("anniversary")),
      notes: (comp.getFirstPropertyValue("note") as string) || "",
      categories: cats ? (cats.getValues() as string[]).join(", ") : "",
      photo: readPhoto(comp),
      phones: mapTyped("tel"),
      emails: mapTyped("email"),
      addresses,
      urls: mapTyped("url"),
      impps: mapTyped("impp"),
      related: mapTyped("related")
    };
  } catch (err) {
    console.error("Failed to parse vCard", err);
    return null;
  }
}

function removeAll(comp: ICAL.Component, name: string) {
  let p = comp.getFirstProperty(name);
  while (p) {
    comp.removeProperty(p);
    p = comp.getFirstProperty(name);
  }
}

function setOrClear(comp: ICAL.Component, name: string, value: string) {
  removeAll(comp, name);
  if (value) comp.updatePropertyWithValue(name, value);
}

function rebuildTyped(comp: ICAL.Component, name: string, values: TypedValue[]) {
  removeAll(comp, name);
  for (const v of values) {
    if (!v.value) continue;
    const p = new ICAL.Property(name, comp);
    p.setValue(v.value);
    if (v.type) p.setParameter("type", v.type);
    comp.addProperty(p);
  }
}

/** Serialize a contact to a vCard 3.0 string. If `rawVCard` is given (the card
 *  we last received from the server), we start from it and overwrite only the
 *  fields we model -- so photos and any properties we don't understand survive
 *  the round-trip. */
export function contactToVCard(c: ParsedContact, rawVCard?: string): { uid: string; vcf: string } {
  let comp: ICAL.Component;
  try {
    comp = rawVCard ? new ICAL.Component(ICAL.parse(rawVCard)) : new ICAL.Component("vcard");
  } catch {
    comp = new ICAL.Component("vcard");
  }

  const uid = c.uid || (comp.getFirstPropertyValue("uid") as string) || newContactUid();

  comp.updatePropertyWithValue("version", "3.0");
  comp.updatePropertyWithValue("uid", uid);
  comp.updatePropertyWithValue("fn", c.fn || displayName(c));

  // N (structured): family, given, additional, prefixes, suffixes
  removeAll(comp, "n");
  const n = new ICAL.Property("n", comp);
  n.setValue([c.last_name || "", c.first_name || "", c.middle_name || "", c.prefix || "", c.suffix || ""] as any);
  comp.addProperty(n);

  setOrClear(comp, "nickname", c.nickname);
  setOrClear(comp, "org", c.org);
  setOrClear(comp, "title", c.title);
  setOrClear(comp, "bday", c.bday || "");
  setOrClear(comp, "anniversary", c.anniversary || "");
  setOrClear(comp, "note", c.notes);

  removeAll(comp, "categories");
  const catList = c.categories.split(",").map((s) => s.trim()).filter(Boolean);
  if (catList.length) {
    const cp = new ICAL.Property("categories", comp);
    cp.setValues(catList);
    comp.addProperty(cp);
  }

  rebuildTyped(comp, "tel", c.phones);
  rebuildTyped(comp, "email", c.emails);
  rebuildTyped(comp, "url", c.urls);
  rebuildTyped(comp, "impp", c.impps);
  rebuildTyped(comp, "related", c.related);

  removeAll(comp, "adr");
  for (const a of c.addresses) {
    if (![a.street, a.city, a.region, a.postal, a.country].some(Boolean)) continue;
    const p = new ICAL.Property("adr", comp);
    p.setValue(["", "", a.street || "", a.city || "", a.region || "", a.postal || "", a.country || ""] as any);
    if (a.type) p.setParameter("type", a.type);
    comp.addProperty(p);
  }

  return { uid, vcf: comp.toString() };
}
