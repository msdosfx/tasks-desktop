// Round-trip + merge-preservation check for the vCard layer.
// Compile first: tsc electron/vcard.ts --outDir dist-electron --rootDir electron ...
import { parseVCard, contactToVCard } from "../dist-electron/vcard.js";

function assert(cond, msg) {
  if (!cond) { console.log("FAIL:", msg); process.exitCode = 1; }
  else console.log("ok:  ", msg);
}

// 1. Round-trip a built contact
const c = {
  uid: "abc@test", fn: "Jane Q. Public", prefix: "Dr.", first_name: "Jane", middle_name: "Q",
  last_name: "Public", suffix: "PhD", nickname: "JQ", org: "Acme, Inc.", title: "Engineer",
  bday: "1990-04-15", anniversary: null, notes: "met at conf", categories: "Work, VIP", photo: "",
  phones: [{ type: "cell", value: "+1-555-1234" }, { type: "work", value: "+1-555-9999" }],
  emails: [{ type: "home", value: "jane@example.com" }],
  addresses: [{ type: "home", street: "1 Main St", city: "Springfield", region: "IL", postal: "62701", country: "USA" }],
  urls: [{ type: "", value: "https://jane.example.com" }], impps: [], related: []
};
const { vcf } = contactToVCard(c);
console.log("----- vCARD -----\n" + vcf);
const p = parseVCard(vcf);
console.log("----- PARSED -----\n" + JSON.stringify(p, null, 2));
assert(!!p, "parse returned a contact");
assert(p.fn === "Jane Q. Public", "fn");
assert(p.first_name === "Jane" && p.last_name === "Public", "name parts");
assert(p.prefix === "Dr." && p.suffix === "PhD", "prefix/suffix");
assert(p.org === "Acme, Inc.", "org: " + p.org);
assert(p.bday === "1990-04-15", "bday: " + p.bday);
assert(p.phones.length === 2 && p.phones.some((x) => x.value.includes("555-1234")), "phones");
assert(p.emails.length === 1 && p.emails[0].value === "jane@example.com", "email");
assert(p.addresses.length === 1 && p.addresses[0].city === "Springfield", "address city");
assert(p.categories.split(",").map((s) => s.trim()).sort().join(",") === "VIP,Work", "categories: " + p.categories);

// 2. Parse a realistic server vCard 3.0
const raw = [
  "BEGIN:VCARD", "VERSION:3.0", "UID:server-1", "FN:John Doe", "N:Doe;John;;;",
  "TEL;TYPE=CELL:+15551112222", "EMAIL;TYPE=WORK:john@work.com", "BDAY:1985-12-25",
  "X-CUSTOM-THING:keepme", "END:VCARD"
].join("\r\n");
const p2 = parseVCard(raw);
assert(!!p2 && p2.fn === "John Doe" && p2.first_name === "John", "raw parse name");
assert(!!p2 && p2.bday === "1985-12-25", "raw bday: " + (p2 && p2.bday));
assert(!!p2 && p2.phones[0] && p2.phones[0].value === "+15551112222", "raw phone");

// 3. Merge over raw preserves unknown X- property
const edited = { ...p2, title: "Manager" };
const { vcf: merged } = contactToVCard(edited, raw);
console.log("----- MERGED -----\n" + merged);
assert(merged.includes("X-CUSTOM-THING:keepme"), "unknown X- property preserved on merge");
assert(/TITLE:Manager/.test(merged), "edited title written");

console.log(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: PASS");
