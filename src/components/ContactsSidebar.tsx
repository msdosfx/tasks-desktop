import { useState } from "react";
import { Contact, AddressBook } from "../types";
import ContextMenu from "./ContextMenu";
import { ContactFilter, LabelColors, isFavorite, contactLabels } from "../contactUtils";

const PALETTE: { name: string; color: string }[] = [
  { name: "Blue", color: "#4a90d9" },
  { name: "Red", color: "#e5484d" },
  { name: "Amber", color: "#e8a23d" },
  { name: "Green", color: "#3fb950" },
  { name: "Purple", color: "#a371f7" },
  { name: "Pink", color: "#db61a2" },
  { name: "Gray", color: "#6f7378" }
];

interface Props {
  addressBooks: AddressBook[];
  contacts: Contact[];
  filter: ContactFilter;
  onSelect: (f: ContactFilter) => void;
  onCreateBook: (name: string) => void;
  labelColors: LabelColors;
  onSetLabelColor: (label: string, color: string | null) => void;
  onSync: () => void;
  syncing: boolean;
  onOpenSettings: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function ContactsSidebar({
  addressBooks, contacts, filter, onSelect, onCreateBook, labelColors, onSetLabelColor,
  onSync, syncing, onOpenSettings, collapsed, onToggleCollapsed
}: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [labelMenu, setLabelMenu] = useState<{ x: number; y: number; label: string } | null>(null);

  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed">
        <button className="rail-toggle" onClick={onToggleCollapsed} title="Show Contacts">›</button>
      </div>
    );
  }

  const active = (f: ContactFilter) => JSON.stringify(f) === JSON.stringify(filter);
  const live = contacts.filter((c) => !c.deleted);
  const favCount = live.filter(isFavorite).length;
  const bookCount = (id: string) => live.filter((c) => c.address_book_id === id).length;
  const labels = (() => {
    const set = new Set<string>();
    for (const c of live) for (const l of contactLabels(c)) set.add(l);
    return [...set].sort((a, b) => a.localeCompare(b));
  })();

  function submit() {
    const t = name.trim();
    if (t) onCreateBook(t);
    setName(""); setAdding(false);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Contacts</span>
        <button className="today-pane-collapse-btn" onClick={onToggleCollapsed} title="Hide panel">‹</button>
      </div>
      <div className="sidebar-list">
        <div className={`sidebar-item ${active({ kind: "all" }) ? "active" : ""}`} onClick={() => onSelect({ kind: "all" })}>
          <span className="sidebar-dot" style={{ background: "#888" }} />
          <span style={{ flex: 1 }}>All contacts</span>
          {live.length > 0 && <span className="count">{live.length}</span>}
        </div>
        <div className={`sidebar-item ${active({ kind: "favorites" }) ? "active" : ""}`} onClick={() => onSelect({ kind: "favorites" })}>
          <span className="sidebar-dot" style={{ background: "#e8a23d" }} />
          <span style={{ flex: 1 }}>★ Favorites</span>
          {favCount > 0 && <span className="count">{favCount}</span>}
        </div>

        <div style={{ height: 8 }} />
        <div className="sidebar-section-label">Address books</div>
        {addressBooks.map((b) => (
          <div
            key={b.id}
            className={`sidebar-item ${active({ kind: "book", value: b.id }) ? "active" : ""}`}
            style={{ "--accent": b.color } as any}
            onClick={() => onSelect({ kind: "book", value: b.id })}
          >
            <span className="sidebar-dot" style={{ background: b.color }} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {b.name}{b.carddav_addressbook_url ? " ⇄" : ""}
            </span>
            {bookCount(b.id) > 0 && <span className="count">{bookCount(b.id)}</span>}
          </div>
        ))}
        {adding ? (
          <div style={{ padding: "6px 14px" }}>
            <input
              autoFocus
              style={{ width: "100%", background: "#26272a", border: "1px solid #34353a", borderRadius: 6, color: "#fff", padding: "4px 6px" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") { setAdding(false); setName(""); } }}
              onBlur={submit}
            />
          </div>
        ) : (
          <button className="sidebar-add" onClick={() => setAdding(true)}>+ New address book</button>
        )}

        {labels.length > 0 && (
          <>
            <div style={{ height: 8 }} />
            <div className="sidebar-section-label">Labels</div>
            {labels.map((l) => (
              <div
                key={l}
                className={`sidebar-item ${active({ kind: "label", value: l }) ? "active" : ""}`}
                onClick={() => onSelect({ kind: "label", value: l })}
                onContextMenu={(e) => { e.preventDefault(); setLabelMenu({ x: e.clientX, y: e.clientY, label: l }); }}
                title="Right-click to set a color"
              >
                <span className="sidebar-dot" style={{ background: labelColors[l] || "#6f7378" }} />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{l}</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="sidebar-footer">
        <button onClick={onSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now (Ctrl+R)"}</button>
        <div style={{ height: 6 }} />
        <button onClick={onOpenSettings}>CardDAV accounts…</button>
      </div>

      {labelMenu && (
        <ContextMenu
          x={labelMenu.x}
          y={labelMenu.y}
          onClose={() => setLabelMenu(null)}
          items={[
            ...PALETTE.map((p) => ({ label: `● ${p.name}`, onClick: () => onSetLabelColor(labelMenu.label, p.color) })),
            { label: "No color", onClick: () => onSetLabelColor(labelMenu.label, null) }
          ]}
        />
      )}
    </div>
  );
}
