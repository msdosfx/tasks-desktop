// Round-trip check for per-occurrence recurring serialization/parsing.
// Run after `npm run build` (needs the compiled dist-electron/ical.js).
import { eventToVEvent, parseVEvent } from "../dist-electron/ical.js";

const master = {
  id: "e1", list_id: "l1", title: "Standup", notes: "", location: "",
  start_date: "2026-07-13T13:00:00.000Z", end_date: "2026-07-13T13:15:00.000Z",
  all_day: 0, recurrence: "FREQ=WEEKLY;BYDAY=MO", tags: "",
  caldav_uid: null, caldav_href: null, caldav_etag: null, deleted: 0, dirty: 1,
  sequence: 3, created_at: "2026-07-12T00:00:00.000Z", updated_at: "2026-07-12T00:00:00.000Z"
};
const exdates = ["2026-07-20T13:00:00.000Z"];               // skip the Jul 20 standup
const overrides = [{
  recurrence_id: "2026-07-27T13:00:00.000Z",                // Jul 27 occurrence...
  start_date: "2026-07-27T15:00:00.000Z",                   // ...moved to 15:00
  end_date: "2026-07-27T15:15:00.000Z", all_day: 0, title: "Standup (moved)"
}];

const { ics } = eventToVEvent(master, "uid-123@test", [], exdates, overrides);
console.log("----- ICS -----\n" + ics);
const p = parseVEvent(ics);
console.log("----- PARSED -----\n" + JSON.stringify(p, null, 2));

const ok = p && p.recurrence === "FREQ=WEEKLY;BYDAY=MO" &&
  p.exdates.length === 1 && p.exdates[0].startsWith("2026-07-20") &&
  p.overrides.length === 1 && p.overrides[0].recurrence_id.startsWith("2026-07-27") &&
  p.overrides[0].start_date.startsWith("2026-07-27T15") && p.overrides[0].title === "Standup (moved)";
console.log("\nROUND-TRIP:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
