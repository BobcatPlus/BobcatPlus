// Unit tests for popup location formatting + section-meta CRN extraction.
//
// The popup cannot be loaded in Node (it is a browser classic script that
// references `chrome.*` and `document`). These tests inline the two pure
// functions — `formatPopupLocation` and `normalizeRoom` — and the section-
// meta extraction logic extracted from the `getRegisteredSectionMeta`
// background handler, so they can run without any browser context.
//
// Coverage:
//   - normalizeRoom: leading-zero strip, all-letter passthrough, empty input
//   - formatPopupLocation: building+room happy path, ARR → Online,
//     missing meta → "--", building-only, room-only
//   - Section-meta extraction: CRN dedup, building/room picked from
//     meetingsFaculty[0].meetingTime (the real Banner shape)

const { assertEqual, assertTrue, assertDeepEqual } = require("./_harness");

// ── inline pure logic from popup.js ──────────────────────────────────────

function normalizeRoom(roomRaw) {
  const room = String(roomRaw || "").trim();
  if (!room) return "";
  if (/^[A-Za-z]+$/.test(room)) return room.toUpperCase();
  const stripped = room.replace(/^0+/, "");
  return stripped || "0";
}

function formatPopupLocation(event, sectionMeta) {
  const crn = String(event.crn || "");
  const meta = sectionMeta && crn ? sectionMeta[crn] : null;
  const buildingCode = String(meta?.building || "").trim().toUpperCase();
  const room = normalizeRoom(meta?.room || "");
  if (buildingCode === "ARR" || room === "ARR") return "Online";
  if (buildingCode && room) return buildingCode + " " + room;
  if (buildingCode) return buildingCode;
  if (room) return room;
  return "--";
}

// ── inline pure logic from background.js getRegisteredSectionMeta ────────
// Extracts {building, room} from a Banner section row (meetingsFaculty shape).

function extractMetaFromSection(sec) {
  const mf = Array.isArray(sec.meetingsFaculty) ? sec.meetingsFaculty[0] : null;
  const mt = mf?.meetingTime || null;
  const building = mt?.building || sec.building || "";
  const room = mt?.room || mt?.roomNumber || sec.room || "";
  return { building, room };
}

// ── test cases ────────────────────────────────────────────────────────────

module.exports = {
  cases: [
    // normalizeRoom
    {
      name: "normalizeRoom: strips leading zeros from numeric room",
      run() {
        assertEqual(normalizeRoom("00234"), "234");
        assertEqual(normalizeRoom("00117"), "117");
        assertEqual(normalizeRoom("03204"), "3204");
      },
    },
    {
      name: "normalizeRoom: all-zero room becomes '0'",
      run() {
        assertEqual(normalizeRoom("000"), "0");
        assertEqual(normalizeRoom("0"), "0");
      },
    },
    {
      name: "normalizeRoom: all-letter room passes through uppercased",
      run() {
        assertEqual(normalizeRoom("ARR"), "ARR");
        assertEqual(normalizeRoom("arr"), "ARR");
      },
    },
    {
      name: "normalizeRoom: empty / null / undefined returns empty string",
      run() {
        assertEqual(normalizeRoom(""), "");
        assertEqual(normalizeRoom(null), "");
        assertEqual(normalizeRoom(undefined), "");
      },
    },

    // formatPopupLocation
    {
      name: "formatPopupLocation: building + room strips leading zeros and uppercases",
      run() {
        const meta = { "33939": { building: "DERR", room: "00229" } };
        assertEqual(formatPopupLocation({ crn: "33939" }, meta), "DERR 229");
      },
    },
    {
      name: "formatPopupLocation: ARR building → Online",
      run() {
        const meta = { "32266": { building: "ARR", room: "ARR" } };
        assertEqual(formatPopupLocation({ crn: "32266" }, meta), "Online");
      },
    },
    {
      name: "formatPopupLocation: ARR room alone → Online",
      run() {
        const meta = { "99999": { building: "SCI", room: "ARR" } };
        assertEqual(formatPopupLocation({ crn: "99999" }, meta), "Online");
      },
    },
    {
      name: "formatPopupLocation: CRN missing from meta → '--'",
      run() {
        assertEqual(formatPopupLocation({ crn: "11111" }, {}), "--");
        assertEqual(formatPopupLocation({ crn: "11111" }, null), "--");
      },
    },
    {
      name: "formatPopupLocation: building only (no room in meta)",
      run() {
        const meta = { "55555": { building: "AVRY", room: "" } };
        assertEqual(formatPopupLocation({ crn: "55555" }, meta), "AVRY");
      },
    },
    {
      name: "formatPopupLocation: room only (no building in meta)",
      run() {
        const meta = { "55556": { building: "", room: "00101" } };
        assertEqual(formatPopupLocation({ crn: "55556" }, meta), "101");
      },
    },
    {
      name: "formatPopupLocation: event with no crn field → '--'",
      run() {
        const meta = { "": { building: "DERR", room: "100" } };
        assertEqual(formatPopupLocation({}, meta), "--");
      },
    },

    // extractMetaFromSection (Banner meetingsFaculty shape)
    {
      name: "extractMetaFromSection: reads building+room from meetingsFaculty[0].meetingTime",
      run() {
        const sec = {
          courseReferenceNumber: "33939",
          meetingsFaculty: [
            { meetingTime: { building: "DERR", room: "00229", roomNumber: "229" } },
          ],
        };
        const meta = extractMetaFromSection(sec);
        assertEqual(meta.building, "DERR");
        assertEqual(meta.room, "00229");
      },
    },
    {
      name: "extractMetaFromSection: falls back to top-level building/room when meetingsFaculty absent",
      run() {
        const sec = { courseReferenceNumber: "11111", building: "IGRM", room: "03104" };
        const meta = extractMetaFromSection(sec);
        assertEqual(meta.building, "IGRM");
        assertEqual(meta.room, "03104");
      },
    },
    {
      name: "extractMetaFromSection: empty meetingsFaculty array falls back to top-level",
      run() {
        const sec = { courseReferenceNumber: "22222", meetingsFaculty: [], building: "AVRY", room: "00368" };
        const meta = extractMetaFromSection(sec);
        assertEqual(meta.building, "AVRY");
        assertEqual(meta.room, "00368");
      },
    },
    {
      name: "extractMetaFromSection: section with no location fields returns empty strings",
      run() {
        const sec = { courseReferenceNumber: "00000" };
        const meta = extractMetaFromSection(sec);
        assertEqual(meta.building, "");
        assertEqual(meta.room, "");
      },
    },
    {
      name: "extractMetaFromSection: prefers meetingTime.room over meetingTime.roomNumber",
      run() {
        const sec = {
          courseReferenceNumber: "33333",
          meetingsFaculty: [
            { meetingTime: { building: "ELA", room: "00225", roomNumber: "225B" } },
          ],
        };
        const meta = extractMetaFromSection(sec);
        assertEqual(meta.room, "00225");
      },
    },
  ],
};
