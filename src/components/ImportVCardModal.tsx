import { useState } from "react";
import { AddressBook } from "../types";

interface Props {
  addressBooks: AddressBook[];
  defaultBookId: string | null;
  onClose: () => void;
  onImported: () => void;
}

type Summary = { canceled?: boolean; total?: number; labeled?: number; matched?: number; created?: number; skipped?: number };

/** Import contacts from a .vcf file, optionally stamping a label onto every
 *  contact in the file. Existing contacts are matched (by CardDAV UID, then by
 *  name + shared email) and updated in place rather than duplicated -- the
 *  workaround for Synology labels that don't travel over CardDAV. */
export default function ImportVCardModal({ addressBooks, defaultBookId, onClose, onImported }: Props) {
  const [label, setLabel] = useState("");
  const [bookId, setBookId] = useState(defaultBookId || addressBooks[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setError(""); setResult(null); setBusy(true);
    try {
      const r = await window.api.contacts?.import({ label: label.trim(), bookId, createNew: true });
      if (!r || r.canceled) { setBusy(false); return; } // dialog dismissed
      setResult(r);
      onImported();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="settings-modal" style={{ position: "relative", maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>Import from vCard</h2>

        <p style={{ color: "#9aa0a6", fontSize: 13, marginTop: 0 }}>
          Pick a <code>.vcf</code> file. Contacts already here are matched and updated (not duplicated);
          any label below is added to every contact in the file.
        </p>

        <label>Add label to all imported contacts (optional)</label>
        <input
          type="text"
          value={label}
          placeholder="e.g. DP21"
          onChange={(e) => setLabel(e.target.value)}
          disabled={busy}
        />

        <label style={{ marginTop: 10 }}>Contacts not already here are added to</label>
        <select value={bookId} onChange={(e) => setBookId(e.target.value)} disabled={busy}>
          {addressBooks.map((b) => (
            <option key={b.id} value={b.id}>{b.name}{b.carddav_addressbook_url ? " (synced)" : ""}</option>
          ))}
        </select>

        {error && <div style={{ color: "#e5484d", marginTop: 12, fontSize: 13 }}>{error}</div>}

        {result && !result.canceled && (
          <div style={{ marginTop: 14, background: "#26272a", borderRadius: 6, padding: "10px 12px", fontSize: 13, color: "#c8c8c8" }}>
            Read {result.total} contact(s): matched {result.matched}, labeled {result.labeled}, added {result.created}.
            <div style={{ color: "#9aa0a6", marginTop: 6 }}>
              Labels are added as a change to sync — they'll push to your server on the next sync.
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button onClick={onClose}>{result ? "Done" : "Cancel"}</button>
          <button className="primary" onClick={run} disabled={busy || !bookId}>
            {busy ? "Importing…" : "Choose file & import"}
          </button>
        </div>
      </div>
    </div>
  );
}
