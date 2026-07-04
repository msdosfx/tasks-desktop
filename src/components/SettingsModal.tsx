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
  // Pending (unsaved) dropdown selections, keyed by calendar URL. Nothing here
  // takes effect until the single "Save changes" button is clicked.
  const [pendingByCal, setPendingByCal] = useState<Record<string, string>>({});
  const [advancedLinking, setAdvancedLinking] = useState(() => localStorage.getItem("advancedListLinking") === "1");
  const [version, setVersion] = useState<string>("");
  const [update, setUpdate] = useState<{ state: string; detail?: any } | null>(null);
  const [prefs, setPrefs] = useState<Record<string, string>>({});

  useEffect(() => {
    window.api.app?.version().then(setVersion).catch(() => {});
    window.api.settings?.all().then(setPrefs).catch(() => {});
    return window.api.on("update:status", (state: string, detail?: any) => setUpdate({ state, detail }));
  }, []);

  function setPref(key: string, value: string) {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    window.api.settings?.set(key, value);
  }

  useEffect(() => {
    localStorage.setItem("advancedListLinking", advancedLinking ? "1" : "0");
  }, [advancedLinking]);

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
      if (!(await window.api.accounts.ensureHostPermission(serverUrl))) {
        setTestMsg("Permission to contact that server was denied.");
        return;
      }
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
      if (!(await window.api.accounts.ensureHostPermission(serverUrl))) {
        setTestMsg("Permission to contact that server was denied.");
        return;
      }
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
      const account = accounts.find((a) => a.id === accountId);
      if (account && !(await window.api.accounts.ensureHostPermission(account.server_url))) {
        setTestMsg("Permission to contact that server was denied.");
        return;
      }
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
      if (!(await window.api.accounts.ensureHostPermission(account.server_url))) {
        setTestMsg("Permission to contact that server was denied.");
        return;
      }
      const res = await window.api.accounts.testConnection(account);
      setTestMsg(res.message);
    } finally {
      setBusy(false);
    }
  }

  /** Commits every pending calendar-link change across all accounts at once:
   *  links, creates+links, or unlinks as needed, then runs one sync per affected
   *  account so newly-linked lists show up right away. Nothing is written until
   *  this is called — closing the modal beforehand discards pending choices. */
  async function saveAllChanges() {
    const entries = Object.entries(pendingByCal);
    if (entries.length === 0) return;
    setBusy(true);
    setTestMsg(null);
    const accountsToSync = new Set<string>();
    const errors: string[] = [];
    try {
      for (const [calUrl, selected] of entries) {
        let accountId: string | undefined;
        let cal: DiscoveredCalendar | undefined;
        for (const [accId, cals] of Object.entries(calendarsByAccount)) {
          const found = cals.find((c) => c.url === calUrl);
          if (found) { accountId = accId; cal = found; break; }
        }
        if (!accountId || !cal) continue;
        const linkedList = lists.find((l) => l.caldav_calendar_url === calUrl);
        try {
          if (selected === "__new__") {
            const newList = await window.api.lists.create(cal.displayName, cal.color ?? undefined);
            await window.api.accounts.linkList(newList.id, accountId, calUrl);
            accountsToSync.add(accountId);
          } else if (selected === "") {
            if (linkedList) {
              // Unlink first so no future sync touches the server, then remove the
              // list (and its locally-synced tasks) from this app. The remote
              // calendar and its items are untouched.
              await window.api.accounts.unlinkList(linkedList.id);
              await window.api.lists.delete(linkedList.id);
            }
          } else {
            await window.api.accounts.linkList(selected, accountId, calUrl);
            accountsToSync.add(accountId);
          }
        } catch (err: any) {
          errors.push(`${cal.displayName}: ${err?.message || err}`);
        }
      }
    } finally {
      // The link/unlink/create calls above are already committed to the database
      // at this point (each has its own try/catch, so one failure doesn't stop
      // the rest). The pending selections have effectively been "saved" no
      // matter what happens next, so clear them now -- otherwise a slow or
      // failing sync below would leave the UI stuck showing "unsaved changes"
      // with no way to clear it, even though the actual link already succeeded.
      onListsChanged();
      setPendingByCal({});
    }

    try {
      for (const accId of accountsToSync) {
        const res = await onSyncAccount(accId);
        errors.push(...res.flatMap((r) => r.errors));
      }
    } catch (err: any) {
      errors.push(err?.message || String(err));
    }
    setTestMsg(errors.length ? `Saved with errors: ${errors[0]}` : "Changes saved.");
    setBusy(false);
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
      const account = accounts.find((a) => a.id === accountId);
      if (account && !(await window.api.accounts.ensureHostPermission(account.server_url))) {
        setTestMsg("Permission to contact that server was denied.");
        return;
      }
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
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9aa0a6", marginBottom: 10 }}>
          <input type="checkbox" checked={advancedLinking} onChange={(e) => setAdvancedLinking(e.target.checked)} />
          Additional list linking options (link a calendar to an existing list)
        </label>

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
              const isConnected = current !== "";
              const pending = pendingByCal[cal.url];
              const selected = pending ?? current;
              const dirty = pending !== undefined;
              return (
                <div className="calendar-pick" key={cal.url}>
                  <span>{cal.displayName}</span>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {dirty && <span style={{ fontSize: 11, color: "#e8a23d" }}>Unsaved</span>}
                    <select
                      value={selected}
                      disabled={busy}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPendingByCal((prev) => {
                          const next = { ...prev };
                          if (val === current) delete next[cal.url];
                          else next[cal.url] = val;
                          return next;
                        });
                      }}
                    >
                      {isConnected ? (
                        <>
                          <option value={current} disabled>Connected</option>
                          <option value="">Not linked</option>
                        </>
                      ) : (
                        <>
                          <option value="">Not linked</option>
                          <option value="__new__">Connected</option>
                        </>
                      )}
                      {advancedLinking &&
                        lists.filter((l) => l.id !== current).map((l) => (
                          <option key={l.id} value={l.id}>Add to {l.name}</option>
                        ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {accounts.length > 0 && (
          <div className="settings-save-bar">
            {Object.keys(pendingByCal).length > 0 && (
              <span style={{ fontSize: 12, color: "#9aa0a6" }}>
                {Object.keys(pendingByCal).length} unsaved change{Object.keys(pendingByCal).length === 1 ? "" : "s"}
              </span>
            )}
            <button
              className="primary"
              disabled={busy || Object.keys(pendingByCal).length === 0}
              onClick={saveAllChanges}
            >
              Save changes
            </button>
          </div>
        )}

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

        {window.api.settings && (
          <>
            <h3 style={{ marginTop: 18 }}>Sync</h3>
            <div className="prefs-grid">
              <label className="pref-row" title="Syncs all CalDAV accounts in the background. Manual sync (Ctrl+R) always works too.">
                Sync automatically every
                <select
                  value={prefs.syncIntervalMinutes ?? "5"}
                  onChange={(e) => setPref("syncIntervalMinutes", e.target.value)}
                >
                  <option value="1">1 minute</option>
                  <option value="5">5 minutes</option>
                  <option value="10">10 minutes</option>
                  <option value="30">30 minutes</option>
                  <option value="0">Off — manual only</option>
                </select>
              </label>
              <label className="pref-row" title="Change or disable this if it conflicts with another app's hotkey. Applies immediately.">
                "Sync Now" hotkey
                <select
                  value={prefs.syncHotkey ?? "CmdOrCtrl+R"}
                  onChange={(e) => setPref("syncHotkey", e.target.value)}
                >
                  <option value="CmdOrCtrl+R">Ctrl+R</option>
                  <option value="CmdOrCtrl+Shift+S">Ctrl+Shift+S</option>
                  <option value="CmdOrCtrl+Alt+R">Ctrl+Alt+R</option>
                  <option value="F9">F9</option>
                  <option value="">No hotkey (menu only)</option>
                </select>
              </label>
            </div>

            <h3 style={{ marginTop: 18 }}>Notifications &amp; startup</h3>
            <div className="prefs-grid">
              <label className="pref-row">
                <input
                  type="checkbox"
                  checked={prefs.notificationsEnabled === "1"}
                  onChange={(e) => setPref("notificationsEnabled", e.target.checked ? "1" : "0")}
                />
                Remind me when tasks are due
              </label>
              <label className="pref-row pref-indent" title="Tasks with a due time are reminded at that time; tasks with only a date are reminded at this time of day">
                Remind date-only tasks at
                <input
                  type="time"
                  value={prefs.reminderTime || "18:00"}
                  disabled={prefs.notificationsEnabled !== "1"}
                  onChange={(e) => setPref("reminderTime", e.target.value || "18:00")}
                />
              </label>
              <label className="pref-row" title="Closing the window keeps the app in the tray so reminders and sync keep working">
                <input
                  type="checkbox"
                  checked={prefs.closeToTray === "1"}
                  onChange={(e) => setPref("closeToTray", e.target.checked ? "1" : "0")}
                />
                Keep running in the tray when the window is closed
              </label>
              <label className="pref-row">
                <input
                  type="checkbox"
                  checked={prefs.launchAtLogin === "1"}
                  onChange={(e) => setPref("launchAtLogin", e.target.checked ? "1" : "0")}
                />
                Start Tasks Desktop when the computer starts
              </label>
            </div>
          </>
        )}

        <div className="about-row">
          <span>Tasks Desktop{version ? ` v${version}` : ""}</span>
          <span>
            {update?.state === "checking" && "Checking for updates…"}
            {update?.state === "none" && "Up to date"}
            {update?.state === "available" && `Downloading v${update.detail}…`}
            {update?.state === "downloading" && `Downloading update… ${update.detail}%`}
            {update?.state === "error" && `Update check failed: ${update.detail}`}
            {update?.state === "downloaded" && (
              <button className="primary" onClick={() => window.api.app?.installUpdate()}>
                Restart to update to v{update.detail}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
