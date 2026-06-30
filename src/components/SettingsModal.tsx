import React, { useEffect, useState } from "react";
import { CaldavAccountPublic, DiscoveredCalendar, TaskList } from "../types";

interface Props {
  lists: TaskList[];
  onClose: () => void;
  onListsChanged: () => void;
  onSyncAccount: (accountId: string) => Promise<{ listId: string; pulled: number; pushed: number; errors: string[] }[]>;
}

export default function SettingsModal({ lists, onClose, onListsChanged, onSyncAccount }: Props) {
  const [accounts, setAccounts] = useState<CaldavAccountPublic[]>([]);
  const [label, setLabel] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [calendarsByAccount, setCalendarsByAccount] = useState<Record<string, DiscoveredCalendar[]>>({});
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Pending (unsaved) dropdown selection per calendar URL, keyed so changing
  // the select doesn't take effect until the row's Save button is clicked.
  const [pendingByCal, setPendingByCal] = useState<Record<string, string>>({});

  async function refresh() {
    setAccounts(await window.api.accounts.all());
  }
  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function addAccount() {
    if (!serverUrl || !username || !password) {
      setTestMsg("Fill in server URL, username, and password before saving.");
      return;
    }
    setBusy(true);
    setTestMsg(null);
    try {
      const created = await window.api.accounts.create({ label: label || serverUrl, server_url: serverUrl, username, password });
      setLabel(""); setServerUrl(""); setUsername(""); setPassword("");
      await refresh();
      await discover(created.id);
    } catch (err: any) {
      setTestMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function testDraft() {
    if (!serverUrl || !username || !password) {
      setTestMsg("Fill in server URL, username, and password before testing.");
      return;
    }
    setBusy(true);
    setTestMsg(null);
    try {
      const res = await window.api.accounts.testConnection({ server_url: serverUrl, username, password });
      setTestMsg(res.message);
    } catch (err: any) {
      setTestMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function discover(accountId: string) {
    setBusy(true);
    try {
      const cals = await window.api.accounts.discoverCalendars(accountId);
      setCalendarsByAccount((prev) => ({ ...prev, [accountId]: cals }));
    } catch (err: any) {
      setTestMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function test(account: CaldavAccountPublic) {
    setBusy(true);
    try {
      const res = await window.api.accounts.testConnection(account);
      setTestMsg(res.message);
    } finally {
      setBusy(false);
    }
  }

  /** Commits the pending dropdown choice for one calendar: links it to an existing
   *  list, creates+links a new list, or unlinks it — then runs an immediate sync
   *  for that account so the list's tasks show up right away instead of waiting
   *  for the next manual Sync Now. */
  async function saveCalendarLink(accountId: string, cal: DiscoveredCalendar, linkedListId: string | undefined) {
    const selected = pendingByCal[cal.url] ?? (linkedListId ?? "");
    setBusy(true);
    setTestMsg(null);
    try {
      if (selected === "__new__") {
        const newList = await window.api.lists.create(cal.displayName, cal.color ?? undefined);
        await window.api.accounts.linkList(newList.id, accountId, cal.url);
      } else if (selected === "") {
        if (linkedListId) await window.api.accounts.unlinkList(linkedListId);
      } else {
        await window.api.accounts.linkList(selected, accountId, cal.url);
      }
      onListsChanged();
      if (selected !== "") {
        const results = await onSyncAccount(accountId);
        const pulled = results.reduce((sum, r) => sum + r.pulled, 0);
        const errors = results.flatMap((r) => r.errors);
        setTestMsg(errors.length ? `Linked, but sync had errors: ${errors[0]}` : `Linked and synced — ${pulled} task(s) pulled.`);
      }
      setPendingByCal((prev) => {
        const next = { ...prev };
        delete next[cal.url];
        return next;
      });
    } catch (err: any) {
      setTestMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeAccount(id: string) {
    await window.api.accounts.delete(id);
    await refresh();
    onListsChanged();
  }

  async function syncNow(accountId: string) {
    setBusy(true);
    setTestMsg(null);
    try {
      const results = await onSyncAccount(accountId);
      await refresh();
      const pulled = results.reduce((sum, r) => sum + r.pulled, 0);
      const pushed = results.reduce((sum, r) => sum + r.pushed, 0);
      const errors = results.flatMap((r) => r.errors);
      if (!results.length) {
        setTestMsg("No lists are linked to a calendar on this account yet.");
      } else {
        setTestMsg(errors.length ? `Sync had errors: ${errors[0]}` : `Synced — ${pulled} pulled, ${pushed} pushed.`);
      }
    } catch (err: any) {
      setTestMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay">
      <div className="settings-modal" style={{ position: "relative" }}>
        <button className="modal-close" onClick={onClose}>×</button>
        <h2>CalDAV accounts</h2>
        <p style={{ color: "#9aa0a6", fontSize: 12 }}>
          Connect a CalDAV server (Nextcloud, Tasks.org sync provider, DAVx5-compatible server, etc.) to sync tasks
          with your existing Tasks.org setup.
        </p>

        {accounts.map((acc) => (
          <div className="account-card" key={acc.id}>
            <div className="row">
              <strong>{acc.label}</strong>
              <div>
                <button onClick={() => test(acc)} disabled={busy}>Test</button>{" "}
                <button onClick={() => discover(acc.id)} disabled={busy}>Find calendars</button>{" "}
                <button onClick={() => syncNow(acc.id)} disabled={busy}>Sync now</button>{" "}
                <button onClick={() => removeAccount(acc.id)} disabled={busy}>Remove</button>
              </div>
            </div>
            <div className="status">{acc.server_url} — {acc.username}</div>
            {acc.last_sync_at && (
              <div className={`status ${acc.last_sync_status === "error" ? "error" : ""}`}>
                Last sync: {new Date(acc.last_sync_at).toLocaleString()} ({acc.last_sync_status})
              </div>
            )}
            {calendarsByAccount[acc.id]?.map((cal) => {
              const linkedList = lists.find((l) => l.caldav_calendar_url === cal.url);
              const current = linkedList?.id ?? "";
              const selected = pendingByCal[cal.url] ?? current;
              const dirty = selected !== current;
              return (
                <div className="calendar-pick" key={cal.url}>
                  <span>{cal.displayName}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      value={selected}
                      disabled={busy}
                      onChange={(e) => setPendingByCal((prev) => ({ ...prev, [cal.url]: e.target.value }))}
                    >
                      <option value="">Not linked</option>
                      <option value="__new__">Add as new list</option>
                      {lists.map((l) => <option key={l.id} value={l.id}>Add to {l.name}</option>)}
                    </select>
                    <button
                      className={dirty ? "primary" : undefined}
                      disabled={busy || !dirty}
                      onClick={() => saveCalendarLink(acc.id, cal, linkedList?.id)}
                    >
                      {dirty ? "Save" : "Saved"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <h3 style={{ marginTop: 18 }}>Add account</h3>
        <div className="form-grid">
          <input placeholder="Label (e.g. My Nextcloud)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <input placeholder="Server URL (https://...)" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} />
          <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <div className="password-field">
            <input
              placeholder="Password / app token"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>
          <div className="form-actions">
            <button onClick={testDraft} disabled={busy}>Test connection</button>
            <button className="primary" onClick={addAccount} disabled={busy}>Save account</button>
          </div>
        </div>
        {testMsg && <p style={{ fontSize: 12, color: "#9aa0a6" }}>{testMsg}</p>}
      </div>
    </div>
  );
}
