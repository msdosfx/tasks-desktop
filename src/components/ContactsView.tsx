import { useMemo, useState } from "react";
import { Contact, AddressBook } from "../types";
import { selectWidth } from "../selectWidth";

interface Props {
  contacts: Contact[];
  addressBooks: AddressBook[];
  selectedContactId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  bookFilter: string;
  onSetBookFilter: (id: string) => void;
}

/** First value out of a JSON-text typed-value column ([{type,value}, ...]). */
function firstValue(json: string): string {
  try {
    const a = JSON.parse(json || "[]");
    return Array.isArray(a) && a[0] && a[0].value ? String(a[0].value) : "";
  } catch { return ""; }
}

export default function ContactsView({ contacts, addressBooks, selectedContactId, onSelect, onCreate, bookFilter, onSetBookFilter }: Props) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let base = contacts;
    if (bookFilter !== "all") base = base.filter((c) => c.address_book_id === bookFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      base = base.filter((c) =>
        c.fn.toLowerCase().includes(q) ||
        c.org.toLowerCase().includes(q) ||
        c.emails.toLowerCase().includes(q) ||
        c.phones.toLowerCase().includes(q) ||
        c.categories.toLowerCase().includes(q)
      );
    }
    return [...base].sort((a, b) => (a.fn || "").localeCompare(b.fn || ""));
  }, [contacts, bookFilter, search]);

  const bookName = bookFilter === "all" ? "All" : addressBooks.find((b) => b.id === bookFilter)?.name ?? "All";

  return (
    <>
      <div className="toolbar">
        <h2>Contacts</h2>
        <input
          className="search-box"
          placeholder="Search contacts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="primary" onClick={onCreate}>+ New contact</button>
      </div>
      <div className="toolbar-filters">
        <select
          className="due-filter-select"
          value={bookFilter}
          style={{ width: selectWidth(`Book: ${bookName}`) }}
          onChange={(e) => onSetBookFilter(e.target.value)}
        >
          <option value="all">Book: All</option>
          {addressBooks.map((b) => <option key={b.id} value={b.id}>Book: {b.name}</option>)}
        </select>
        <div className="toolbar-filters-right">
          <span style={{ fontSize: 12, color: "#8a8d93" }}>{visible.length} contact{visible.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      <div className="task-table">
        {visible.length === 0 ? (
          <div className="empty-state">No contacts yet. Click “+ New contact” to add one.</div>
        ) : (
          visible.map((c) => {
            const sub = c.org || firstValue(c.emails) || firstValue(c.phones);
            return (
              <div
                key={c.id}
                className={`task-row ${c.id === selectedContactId ? "selected" : ""}`}
                onClick={() => onSelect(c.id)}
              >
                <div className="title-col">
                  <div className="title">{c.fn || "Unnamed"}</div>
                  {sub && <div className="meta">{sub}</div>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
