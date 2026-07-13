import { useEffect, useState, type CSSProperties } from "react";
import { Contact, AddressBook, TypedValue, PostalAddress } from "../types";

interface Props {
  contact: Contact | null;
  addressBooks: AddressBook[];
  onUpdate: (id: string, patch: Partial<Contact>) => void;
  onDelete: (id: string) => void;
}

function parseArr<T>(s: string | undefined): T[] {
  try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}

const PHONE_TYPES = ["cell", "home", "work", "main", "fax", "other"];
const EMAIL_TYPES = ["home", "work", "other"];
const ADDR_TYPES = ["home", "work", "other"];

const addBtnStyle: CSSProperties = {
  background: "transparent", border: "1px dashed #3a3b3f", color: "#9aa0a6",
  borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer", marginTop: 4
};
const rmBtnStyle: CSSProperties = {
  background: "none", border: "none", color: "#9aa0a6", cursor: "pointer", fontSize: 14, padding: "0 4px"
};

export default function ContactDetailPanel({ contact, addressBooks, onUpdate, onDelete }: Props) {
  const [bookId, setBookId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [org, setOrg] = useState("");
  const [title, setTitle] = useState("");
  const [bday, setBday] = useState("");
  const [bdayNoYear, setBdayNoYear] = useState(false);
  const [phones, setPhones] = useState<TypedValue[]>([]);
  const [emails, setEmails] = useState<TypedValue[]>([]);
  const [addresses, setAddresses] = useState<PostalAddress[]>([]);
  const [categories, setCategories] = useState("");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setBookId(contact?.address_book_id ?? "");
    setFirstName(contact?.first_name ?? "");
    setLastName(contact?.last_name ?? "");
    setOrg(contact?.org ?? "");
    setTitle(contact?.title ?? "");
    {
      const b = (contact?.bday ?? "").trim();
      if (b.startsWith("--")) {
        // year-less "--MM-DD"/"--MMDD": show with a placeholder year so the date
        // picker works; save strips the year back off.
        const digits = b.replace(/[^0-9]/g, "");
        setBday(`2000-${digits.slice(0, 2)}-${digits.slice(2, 4)}`);
        setBdayNoYear(true);
      } else {
        setBday(b.slice(0, 10));
        setBdayNoYear(false);
      }
    }
    setPhones(parseArr<TypedValue>(contact?.phones));
    setEmails(parseArr<TypedValue>(contact?.emails));
    setAddresses(parseArr<PostalAddress>(contact?.addresses));
    setCategories(contact?.categories ?? "");
    setNotes(contact?.notes ?? "");
    setDirty(false);
  }, [contact?.id]);

  if (!contact) {
    return <div className="detail-panel"><div className="no-selection">Select a contact to see details.</div></div>;
  }
  const mark = () => setDirty(true);

  function handleSave() {
    const fn = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || org.trim() || "Unnamed";
    onUpdate(contact!.id, {
      address_book_id: bookId,
      fn,
      first_name: firstName,
      last_name: lastName,
      org,
      title,
      bday: bday ? (bdayNoYear ? `--${bday.slice(5, 7)}-${bday.slice(8, 10)}` : bday) : null,
      phones: JSON.stringify(phones.filter((p) => p.value.trim())),
      emails: JSON.stringify(emails.filter((e) => e.value.trim())),
      addresses: JSON.stringify(addresses.filter((a) => [a.street, a.city, a.region, a.postal, a.country].some((x) => (x || "").trim()))),
      categories,
      notes
    });
    setDirty(false);
  }

  function patchTyped(list: TypedValue[], set: (v: TypedValue[]) => void, i: number, patch: Partial<TypedValue>) {
    set(list.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
    mark();
  }
  function patchAddr(i: number, patch: Partial<PostalAddress>) {
    setAddresses(addresses.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    mark();
  }

  return (
    <div className="detail-panel">
      <h3>Contact details</h3>

      <div className="detail-row">
        <div>
          <label>First name</label>
          <input type="text" value={firstName} onChange={(e) => { setFirstName(e.target.value); mark(); }} />
        </div>
        <div>
          <label>Last name</label>
          <input type="text" value={lastName} onChange={(e) => { setLastName(e.target.value); mark(); }} />
        </div>
      </div>

      <label>Organization</label>
      <input type="text" value={org} onChange={(e) => { setOrg(e.target.value); mark(); }} />
      <label>Title</label>
      <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); mark(); }} />
      <label>Birthday</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="date" style={{ flex: 1 }} value={bday} onChange={(e) => { setBday(e.target.value); mark(); }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#9aa0a6", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={bdayNoYear} onChange={(e) => { setBdayNoYear(e.target.checked); mark(); }} /> no year
        </label>
      </div>

      <label>Phones</label>
      {phones.map((p, i) => (
        <div key={i} className="detail-row" style={{ alignItems: "center", gap: 6 }}>
          <select value={p.type || "cell"} onChange={(e) => patchTyped(phones, setPhones, i, { type: e.target.value })} style={{ flex: "0 0 90px" }}>
            {PHONE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="text" style={{ flex: 1 }} value={p.value} onChange={(e) => patchTyped(phones, setPhones, i, { value: e.target.value })} />
          <button style={rmBtnStyle} onClick={() => { setPhones(phones.filter((_, idx) => idx !== i)); mark(); }}>×</button>
        </div>
      ))}
      <button style={addBtnStyle} onClick={() => { setPhones([...phones, { type: "cell", value: "" }]); mark(); }}>+ Add phone</button>

      <label>Emails</label>
      {emails.map((em, i) => (
        <div key={i} className="detail-row" style={{ alignItems: "center", gap: 6 }}>
          <select value={em.type || "home"} onChange={(e) => patchTyped(emails, setEmails, i, { type: e.target.value })} style={{ flex: "0 0 90px" }}>
            {EMAIL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="text" style={{ flex: 1 }} value={em.value} onChange={(e) => patchTyped(emails, setEmails, i, { value: e.target.value })} />
          <button style={rmBtnStyle} onClick={() => { setEmails(emails.filter((_, idx) => idx !== i)); mark(); }}>×</button>
        </div>
      ))}
      <button style={addBtnStyle} onClick={() => { setEmails([...emails, { type: "home", value: "" }]); mark(); }}>+ Add email</button>

      <label>Addresses</label>
      {addresses.map((a, i) => (
        <div key={i} style={{ border: "1px solid #2c2d30", borderRadius: 6, padding: 8, marginBottom: 6 }}>
          <div className="detail-row" style={{ alignItems: "center", gap: 6 }}>
            <select value={a.type || "home"} onChange={(e) => patchAddr(i, { type: e.target.value })} style={{ flex: "0 0 90px" }}>
              {ADDR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button style={{ ...rmBtnStyle, marginLeft: "auto" }} onClick={() => { setAddresses(addresses.filter((_, idx) => idx !== i)); mark(); }}>×</button>
          </div>
          <input type="text" placeholder="Street" value={a.street} onChange={(e) => patchAddr(i, { street: e.target.value })} />
          <div className="detail-row">
            <input type="text" placeholder="City" value={a.city} onChange={(e) => patchAddr(i, { city: e.target.value })} />
            <input type="text" placeholder="Region" value={a.region} onChange={(e) => patchAddr(i, { region: e.target.value })} />
          </div>
          <div className="detail-row">
            <input type="text" placeholder="Postal" value={a.postal} onChange={(e) => patchAddr(i, { postal: e.target.value })} />
            <input type="text" placeholder="Country" value={a.country} onChange={(e) => patchAddr(i, { country: e.target.value })} />
          </div>
        </div>
      ))}
      <button style={addBtnStyle} onClick={() => { setAddresses([...addresses, { type: "home", street: "", city: "", region: "", postal: "", country: "" }]); mark(); }}>+ Add address</button>

      <label>Categories (comma-separated)</label>
      <input type="text" value={categories} onChange={(e) => { setCategories(e.target.value); mark(); }} />

      <label>Notes</label>
      <textarea value={notes} onChange={(e) => { setNotes(e.target.value); mark(); }} />

      {addressBooks.length > 1 && (
        <>
          <label>Address book</label>
          <select value={bookId} onChange={(e) => { setBookId(e.target.value); mark(); }}>
            {addressBooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </>
      )}

      <div className="detail-actions">
        <button className="primary" onClick={handleSave} disabled={!dirty}>{dirty ? "Save" : "Saved"}</button>
        <button className="danger" onClick={() => onDelete(contact.id)}>Delete</button>
      </div>
      {contact.carddav_uid && <div style={{ marginTop: 10, fontSize: 11, color: "#777" }}>Synced via CardDAV</div>}
    </div>
  );
}
