import { useMemo, useState, type ReactNode } from "react";
import { Contact } from "../types";
import { contactCategories, dupPairKey, initials } from "../contactUtils";

interface Props {
  clusters: Contact[][];
  onMerge: (keeperId: string, loserIds: string[], patch: Partial<Contact>) => Promise<void> | void;
  onDismiss: (pairKeys: string[]) => void;
  onBack: () => void;
}

type TV = { type: string; value: string };
type Addr = { type: string; street: string; city: string; region: string; postal: string; country: string };

function parseTV(json: string): TV[] {
  try { const a = JSON.parse(json || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}
function parseAddr(json: string): Addr[] {
  try { const a = JSON.parse(json || "[]"); return Array.isArray(a) ? a : []; } catch { return []; }
}
function addrLine(a: Addr): string {
  return [a.street, a.city, a.region, a.postal, a.country].map((s) => (s || "").trim()).filter(Boolean).join(", ");
}

/** All pair keys inside a cluster (for dismiss). */
function clusterPairs(cluster: Contact[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cluster.length; i++)
    for (let j = i + 1; j < cluster.length; j++) out.push(dupPairKey(cluster[i].id, cluster[j].id));
  return out;
}

export default function MergeDuplicatesView({ clusters, onMerge, onDismiss, onBack }: Props) {
  const [active, setActive] = useState<Contact[] | null>(null);

  if (active) {
    return <MergeEditor cluster={active} onCancel={() => setActive(null)} onMerge={onMerge} />;
  }

  return (
    <>
      <div className="toolbar">
        <button onClick={onBack}>‹ Back to contacts</button>
        <h2 style={{ flex: 1 }}>Review duplicates</h2>
      </div>
      <div className="task-table">
        {clusters.length === 0 ? (
          <div className="empty-state">No possible duplicates found. 🎉</div>
        ) : (
          clusters.map((cluster) => (
            <div key={cluster.map((c) => c.id).join("-")} style={{ borderBottom: "1px solid #2a2b2f", padding: "12px 14px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                {cluster.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#34353a", color: "#c8c8c8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600 }}>{initials(c)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="title" style={{ fontSize: 13 }}>{c.fn || "Unnamed"}</div>
                      <div className="meta">{c.org || parseTV(c.emails)[0]?.value || parseTV(c.phones)[0]?.value || ""}</div>
                    </div>
                  </div>
                ))}
                <div style={{ flex: 1 }} />
                <button className="primary" onClick={() => setActive(cluster)}>Review &amp; merge</button>
                <button onClick={() => onDismiss(clusterPairs(cluster))}>Not duplicates</button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ---------- The per-cluster merge editor ----------

function MergeEditor({ cluster, onCancel, onMerge }: {
  cluster: Contact[];
  onCancel: () => void;
  onMerge: (keeperId: string, loserIds: string[], patch: Partial<Contact>) => Promise<void> | void;
}) {
  // Default keeper: prefer a synced contact (has carddav_href), else the first.
  const defaultKeeper = cluster.find((c) => c.carddav_href) ?? cluster[0];
  const [keeperId, setKeeperId] = useState(defaultKeeper.id);
  const keeper = cluster.find((c) => c.id === keeperId) ?? cluster[0];

  // Editable display name, defaulting to the keeper's.
  const [name, setName] = useState(keeper.fn || "");

  // Multi-value fields: union across the cluster, deduped, each toggleable.
  const unionTV = (field: "phones" | "emails" | "urls" | "impps") => {
    const seen = new Set<string>();
    const out: TV[] = [];
    for (const c of cluster) for (const v of parseTV(c[field])) {
      const k = (field === "phones" ? v.value.replace(/\D/g, "") : v.value.trim().toLowerCase());
      if (!v.value || seen.has(k)) continue;
      seen.add(k); out.push(v);
    }
    return out;
  };
  const unionAddr = () => {
    const seen = new Set<string>(); const out: Addr[] = [];
    for (const c of cluster) for (const a of parseAddr(c.addresses)) {
      const k = addrLine(a).toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(a);
    }
    return out;
  };
  const unionCats = () => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const c of cluster) for (const cat of contactCategories(c)) {
      if (seen.has(cat.toLowerCase())) continue;
      seen.add(cat.toLowerCase()); out.push(cat);
    }
    return out;
  };
  const distinct = (field: "org" | "title" | "bday" | "anniversary") => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const c of cluster) { const v = (c[field] || "").trim(); if (v && !seen.has(v)) { seen.add(v); out.push(v); } }
    return out;
  };

  const phones = useMemo(unionTV.bind(null, "phones"), [cluster]);
  const emails = useMemo(unionTV.bind(null, "emails"), [cluster]);
  const urls = useMemo(unionTV.bind(null, "urls"), [cluster]);
  const impps = useMemo(unionTV.bind(null, "impps"), [cluster]);
  const addresses = useMemo(unionAddr, [cluster]);
  const cats = useMemo(unionCats, [cluster]);
  const orgs = useMemo(() => distinct("org"), [cluster]);
  const titles = useMemo(() => distinct("title"), [cluster]);
  const bdays = useMemo(() => distinct("bday"), [cluster]);
  const annis = useMemo(() => distinct("anniversary"), [cluster]);

  // Selection state: everything included by default.
  const [pick, setPick] = useState<Record<string, boolean>>(() => {
    const p: Record<string, boolean> = {};
    phones.forEach((_, i) => (p["ph" + i] = true));
    emails.forEach((_, i) => (p["em" + i] = true));
    urls.forEach((_, i) => (p["ur" + i] = true));
    impps.forEach((_, i) => (p["im" + i] = true));
    addresses.forEach((_, i) => (p["ad" + i] = true));
    cats.forEach((_, i) => (p["ct" + i] = true));
    return p;
  });
  const toggle = (k: string) => setPick((p) => ({ ...p, [k]: !p[k] }));

  const [org, setOrg] = useState(keeper.org || orgs[0] || "");
  const [title, setTitle] = useState(keeper.title || titles[0] || "");
  const [bday, setBday] = useState(keeper.bday || bdays[0] || "");
  const [anniversary, setAnniversary] = useState(keeper.anniversary || annis[0] || "");
  const [notes, setNotes] = useState(keeper.notes || "");
  const [busy, setBusy] = useState(false);

  const otherNotes = cluster.filter((c) => c.id !== keeperId && (c.notes || "").trim() && c.notes !== notes);

  async function doMerge() {
    setBusy(true);
    const patch: Partial<Contact> = {
      fn: name.trim() || keeper.fn,
      org, title, bday: bday || null, anniversary: anniversary || null, notes,
      phones: JSON.stringify(phones.filter((_, i) => pick["ph" + i])),
      emails: JSON.stringify(emails.filter((_, i) => pick["em" + i])),
      urls: JSON.stringify(urls.filter((_, i) => pick["ur" + i])),
      impps: JSON.stringify(impps.filter((_, i) => pick["im" + i])),
      addresses: JSON.stringify(addresses.filter((_, i) => pick["ad" + i])),
      categories: cats.filter((_, i) => pick["ct" + i]).join(", ")
    };
    const loserIds = cluster.filter((c) => c.id !== keeperId).map((c) => c.id);
    await onMerge(keeperId, loserIds, patch);
    setBusy(false);
  }

  const section = (label: string, body: ReactNode) => (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#8a8f96", marginBottom: 6 }}>{label}</div>
      {body}
    </div>
  );
  const checkRow = (key: string, text: string) => (
    <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13, color: "#d0d0d0" }}>
      <input type="checkbox" checked={!!pick[key]} onChange={() => toggle(key)} style={{ width: "auto" }} />
      {text}
    </label>
  );

  return (
    <>
      <div className="toolbar">
        <button onClick={onCancel}>‹ Back</button>
        <h2 style={{ flex: 1 }}>Merge {cluster.length} contacts</h2>
        <button className="primary" onClick={doMerge} disabled={busy}>{busy ? "Merging…" : "Merge into one"}</button>
      </div>

      <div style={{ padding: "8px 16px 24px", overflow: "auto" }}>
        {section("Keep as the primary record", (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {cluster.map((c) => (
              <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#d0d0d0" }}>
                <input type="radio" name="keeper" checked={keeperId === c.id} onChange={() => { setKeeperId(c.id); setName(c.fn || ""); }} style={{ width: "auto" }} />
                <strong>{c.fn || "Unnamed"}</strong>
                <span className="meta">{c.carddav_href ? "synced" : "local"}{c.org ? ` · ${c.org}` : ""}</span>
              </label>
            ))}
            <div style={{ color: "#8a8f96", fontSize: 12, marginTop: 4 }}>The others are removed after merging (and deleted from the server on the next sync).</div>
          </div>
        ))}

        {section("Name", (
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        ))}

        {phones.length > 0 && section("Phone numbers", phones.map((v, i) => checkRow("ph" + i, `${v.value}${v.type ? `  (${v.type})` : ""}`)))}
        {emails.length > 0 && section("Emails", emails.map((v, i) => checkRow("em" + i, `${v.value}${v.type ? `  (${v.type})` : ""}`)))}
        {addresses.length > 0 && section("Addresses", addresses.map((a, i) => checkRow("ad" + i, addrLine(a) + (a.type ? `  (${a.type})` : ""))))}
        {urls.length > 0 && section("Websites", urls.map((v, i) => checkRow("ur" + i, v.value)))}
        {impps.length > 0 && section("IM / social", impps.map((v, i) => checkRow("im" + i, `${v.value}${v.type ? `  (${v.type})` : ""}`)))}
        {cats.length > 0 && section("Labels", cats.map((v, i) => checkRow("ct" + i, v)))}

        {orgs.length > 0 && section("Organization", (
          <select value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">(none)</option>
            {orgs.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        {titles.length > 0 && section("Title", (
          <select value={title} onChange={(e) => setTitle(e.target.value)}>
            <option value="">(none)</option>
            {titles.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        {bdays.length > 0 && section("Birthday", (
          <select value={bday} onChange={(e) => setBday(e.target.value)}>
            <option value="">(none)</option>
            {bdays.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}
        {annis.length > 0 && section("Anniversary", (
          <select value={anniversary} onChange={(e) => setAnniversary(e.target.value)}>
            <option value="">(none)</option>
            {annis.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        ))}

        {section("Notes", (
          <>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: "100%", resize: "vertical" }} />
            {otherNotes.map((c) => (
              <button key={c.id} onClick={() => setNotes((n) => (n ? `${n}\n\n${c.notes}` : c.notes))} style={{ marginTop: 6, fontSize: 12 }}>
                + Append note from “{c.fn || "other"}”
              </button>
            ))}
          </>
        ))}
      </div>
    </>
  );
}
