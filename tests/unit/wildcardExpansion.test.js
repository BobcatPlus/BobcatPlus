// Unit tests for BPReq.normalizeCourseInformationCourses — the pure
// normalizer that turns a DegreeWorks `courseInformation` response into
// schedule-generator-ready entries. Layer B of the Bug 4 plan; the live
// HTTP fetcher is a follow-up once the endpoint URL is captured (D13).

const path = require("path");
const fs = require("fs");

const { assertEqual, assertTrue, assertDeepEqual, fail } = require("./_harness");

// Load wildcardExpansion.js through the same globalThis handoff used by the
// extension runtime. graph.js / txstFromAudit.js are already loaded by the
// harness.
const WE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "extension",
  "requirements",
  "wildcardExpansion.js",
);
// eslint-disable-next-line no-eval
eval(fs.readFileSync(WE_PATH, "utf8"));

const BPReq = global.BPReq || (typeof self !== "undefined" && self.BPReq);
if (!BPReq || typeof BPReq.normalizeCourseInformationCourses !== "function") {
  throw new Error("wildcardExpansion.js did not attach normalizer to BPReq");
}

const FIXTURE_PATH = path.join(
  __dirname,
  "..",
  "fixtures",
  "wildcard",
  "cs-4@.json",
);
const cs4raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

module.exports = {
  cases: [
    {
      name: "cs-4@ fixture: normalizer returns non-empty list with expected shape",
      run() {
        const out = BPReq.normalizeCourseInformationCourses(cs4raw);
        assertTrue(Array.isArray(out), "result is array");
        assertTrue(out.length > 0, "at least one course");
        const first = out[0];
        assertEqual(typeof first.subject, "string");
        assertEqual(typeof first.courseNumber, "string");
        assertTrue("title" in first, "carries title");
        assertTrue(Array.isArray(first.sections), "sections is array");
        assertTrue(Array.isArray(first.attributes), "attributes is array");
        assertTrue(Array.isArray(first.prerequisites), "prerequisites is array");
      },
    },

    {
      name: "cs-4@ fixture: every entry is a CS-4xxx course",
      run() {
        const out = BPReq.normalizeCourseInformationCourses(cs4raw);
        for (const e of out) {
          assertEqual(e.subject, "CS", `${e.subject} ${e.courseNumber} subject`);
          assertTrue(
            e.courseNumber.startsWith("4"),
            `${e.subject} ${e.courseNumber} level`,
          );
        }
      },
    },

    {
      name: "termCode filter keeps only matching sections",
      run() {
        const unfiltered = BPReq.normalizeCourseInformationCourses(cs4raw);
        const total = unfiltered.reduce(
          (n, e) => n + (Array.isArray(e.sections) ? e.sections.length : 0),
          0,
        );
        const fallFiltered = BPReq.normalizeCourseInformationCourses(cs4raw, {
          termCode: "202630",
        });
        const fallTotal = fallFiltered.reduce(
          (n, e) => n + e.sections.length,
          0,
        );
        assertTrue(
          fallTotal <= total,
          "term-filtered count cannot exceed unfiltered",
        );
        for (const e of fallFiltered) {
          for (const s of e.sections) {
            assertEqual(String(s.termCode), "202630", "section term is Fall 2026 code");
          }
        }
      },
    },

    {
      name: "excludeKeys drops matching courses",
      run() {
        const beforeCount = BPReq.normalizeCourseInformationCourses(cs4raw).length;
        const out = BPReq.normalizeCourseInformationCourses(cs4raw, {
          excludeKeys: new Set(["CS|4371", "CS|4398"]),
        });
        const keys = new Set(out.map((e) => e.subject + "|" + e.courseNumber));
        assertTrue(!keys.has("CS|4371"), "CS 4371 excluded");
        assertTrue(!keys.has("CS|4398"), "CS 4398 excluded");
        assertEqual(out.length, beforeCount - 2, "exactly 2 courses removed");
      },
    },

    {
      name: "excludeKeys accepts plain array too",
      run() {
        const out = BPReq.normalizeCourseInformationCourses(cs4raw, {
          excludeKeys: ["CS|4371"],
        });
        assertTrue(
          !out.some((e) => e.subject === "CS" && e.courseNumber === "4371"),
          "array-form exclusion applied",
        );
      },
    },

    {
      name: "provenance fields flow through",
      run() {
        const out = BPReq.normalizeCourseInformationCourses(cs4raw, {
          ruleLabel: "Advanced Electives",
          ruleId: "rule-abc-123",
          parentLabels: ["Major in CS", "Advanced Electives"],
        });
        for (const e of out) {
          assertEqual(e.label, "Advanced Electives");
          assertEqual(e.ruleId, "rule-abc-123");
          assertDeepEqual(e.parentLabels, ["Major in CS", "Advanced Electives"]);
        }
      },
    },

    {
      name: "attributeFilter keeps only courses with that attribute",
      run() {
        // DTSC ('Dif Tui- Science & Engineering') appears on CS 4100 in the
        // fixture. Use it as a realistic filter and assert we get at least
        // that course back, and no courses without the code.
        const out = BPReq.normalizeCourseInformationCourses(cs4raw, {
          attributeFilter: "DTSC",
        });
        assertTrue(out.length > 0, "at least one course has DTSC");
        for (const e of out) {
          const codes = (e.attributes || []).map((a) => a.code);
          assertTrue(
            codes.includes("DTSC"),
            `${e.subject} ${e.courseNumber} should carry DTSC; got ${JSON.stringify(codes)}`,
          );
        }
      },
    },

    {
      name: "accepts both { courseInformation: { courses } } and { courses } shapes",
      run() {
        const wrapped = BPReq.normalizeCourseInformationCourses(cs4raw);
        const unwrapped = BPReq.normalizeCourseInformationCourses(
          cs4raw.courseInformation,
        );
        assertEqual(
          wrapped.length,
          unwrapped.length,
          "same count whether top-level wrapper is present or not",
        );
      },
    },

    {
      name: "empty / malformed input returns empty array, not a throw",
      run() {
        assertDeepEqual(BPReq.normalizeCourseInformationCourses(null), []);
        assertDeepEqual(BPReq.normalizeCourseInformationCourses(undefined), []);
        assertDeepEqual(BPReq.normalizeCourseInformationCourses({}), []);
        assertDeepEqual(
          BPReq.normalizeCourseInformationCourses({ courseInformation: {} }),
          [],
        );
      },
    },

    {
      name: "wildcardCacheKey is stable across runs and distinct across inputs",
      run() {
        const a1 = BPReq.wildcardCacheKey(
          { discipline: "CS", numberPrefix: "4" },
          "202630",
        );
        const a2 = BPReq.wildcardCacheKey(
          { discipline: "CS", numberPrefix: "4" },
          "202630",
        );
        const b = BPReq.wildcardCacheKey(
          { discipline: "CS", numberPrefix: "3" },
          "202630",
        );
        const c = BPReq.wildcardCacheKey(
          { discipline: "CS", numberPrefix: "4" },
          "202650",
        );
        assertEqual(a1, a2, "same inputs → same key");
        assertTrue(a1 !== b, "different number prefix → different key");
        assertTrue(a1 !== c, "different term → different key");
      },
    },

    {
      name: "exceptionKeysFromWildcard pulls concrete excepts out of a wildcard record",
      run() {
        const fake = {
          discipline: "CS",
          numberPrefix: "4",
          exceptOptions: [
            { kind: "concrete", course: { discipline: "CS", number: "4371" } },
            { kind: "concrete", course: { discipline: "CS", number: "4398" } },
            // Wildcard excepts are a separate consideration — normalizer
            // ignores them for the concrete-exclusion set.
            { kind: "subjectWildcard", discipline: "CS", numberPrefix: "49" },
            // Malformed entries should be tolerated.
            null,
            { kind: "concrete" },
          ],
        };
        const keys = BPReq.exceptionKeysFromWildcard(fake);
        assertTrue(keys.has("CS|4371"), "CS 4371 in except set");
        assertTrue(keys.has("CS|4398"), "CS 4398 in except set");
        assertEqual(keys.size, 2, "only concrete excepts included");
      },
    },

    {
      name: "round trip: wildcard + exceptionKeys + termCode reproduces the CS-4xxx net",
      run() {
        // Exercises the call pattern the real fetcher will use:
        //   keys = exceptionKeysFromWildcard(w)
        //   entries = normalize(raw, { excludeKeys: keys, termCode })
        const fakeWildcard = {
          discipline: "CS",
          numberPrefix: "4",
          exceptOptions: [
            { kind: "concrete", course: { discipline: "CS", number: "4371" } },
          ],
        };
        const excludeKeys = BPReq.exceptionKeysFromWildcard(fakeWildcard);
        const entries = BPReq.normalizeCourseInformationCourses(cs4raw, {
          excludeKeys,
          termCode: "202630",
        });
        assertTrue(
          !entries.some((e) => e.courseNumber === "4371"),
          "CS 4371 excluded via round trip",
        );
        assertTrue(entries.length > 0, "some entries still surface");
        // Fall 2026 filter: every kept section must match termCode
        for (const e of entries) {
          for (const s of e.sections) {
            assertEqual(String(s.termCode), "202630");
          }
        }
      },
    },
  ],
};
