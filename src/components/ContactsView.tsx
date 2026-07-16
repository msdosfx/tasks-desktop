import { useMemo, useState } from "react";
import { Contact } from "../types";
import { ContactFilter, LabelColors, matchesFilter, isFavorite, contactLabels, initials } from "../contactUtils";

interface Props {
  contacts: Contact[];
  filter: ContactFilter;
  labelColors: LabelColors;
  selectedContactId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onImport: () => void;
  onFindDuplicates: () => void;
  duplicateCount: number;
  onToggleFavorite: (c: Contact) => void;
}

/** First value out of a JSON-text typed-value column ([{type,value}, ...]). */
function firstValue(json: string): string {
  try {
    const a = JSON.parse(json || "[]");
    return Array.isArray(a) && a[0] && a[0].value ? String(a[0].value) : "";
  } catch { return ""; }
}

const avatarStyle = {
  width: 30, height: 30, borderRadius: "50%", background: "#34353a", color: "#c8c8c8",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600,
  flexShrink: 0, marginTop: 1
} as const;

export default function ContactsView({ contacts, filter, labelColors, selectedContactId, onSelect, onCreate, onImport, onFindDuplicates, duplicateCount, onToggleFavorite }: Props) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let base = contacts.filter((c) => !c.deleted && matchesFilter(c, filter));
    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((c) =>
        c.fn.toLowerCase().includes(q) ||
        c.first_name.toLowerCase().includes(q) ||
        c.last_name.toLowerCase().includes(q) ||
        c.nickname.toLowerCase().includes(q) ||
        c.org.toLowerCase().includes(q) ||
        c.emails.toLowerCase().includes(q) ||
        c.phones.toLowerCase().includes(q) ||
        c.categories.toLowerCase().includes(q) ||
        (c.group_labels || "").toLowerCase().includes(q)
      );
    }
    return [...base].sort((a, b) => (a.fn || "").localeCompare(b.fn || ""));
  }, [contacts, filter, search]);

  return (
    <>
      <div className="toolbar">
        <h2>Contacts</h2>
        <input
          className="search-box"
          placeholder="Search name, nickname, phone, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {duplicateCount > 0 && (
          <button onClick={onFindDuplicates} title="Review possible duplicate contacts">
            Merge duplicates ({duplicateCount})
          </button>
        )}
        <button onClick={onImport}>Import vCard…</button>
        <button className="primary" onClick={onCreate}>+ New contact</button>
      </div>
      <div className="task-table">
        {visible.length === 0 ? (
          <div className="empty-state">No contacts here yet.</div>
        ) : (
          visible.map((c) => {
            const sub = c.org || firstValue(c.emails) || firstValue(c.phones);
            const labels = contactLabels(c);
            const fav = isFavorite(c);
            return (
              <div
                key={c.id}
                className={`task-row ${c.id === selectedContactId ? "selected" : ""}`}
                onClick={() => onSelect(c.id)}
              >
                <div style={avatarStyle}>{initials(c)}</div>
                <div className="title-col">
                  <div className="title">{c.fn || "Unnamed"}</div>
                  {sub && <div className="meta">{sub}</div>}
                  {labels.length > 0 && (
                    <div className="meta" style={{ gap: 5 }}>
                      {labels.slice(0, 5).map((l) => (
                        <span
                          key={l}
                          title={l}
                          style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: labelColors[l] || "#6f7378" }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <button
                  title={fav ? "Remove favorite" : "Add favorite"}
                  onClick={(e) => { e.stopPropagation(); onToggleFavorite(c); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: fav ? "#e8a23d" : "#5b5c61", fontSize: 16, alignSelf: "center", padding: "0 2px" }}
                >{fav ? "★" : "☆"}</button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
