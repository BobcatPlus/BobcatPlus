// Bobcat Plus — Wildcard expansion primitives (Phase 1, Layer B stub).
//
// DegreeWorks exposes a `courseInformation` endpoint that takes a subject
// (optionally a number prefix or attribute filter) and returns a list of
// matching courses with inline section data for each offered term. This
// file contains the pure normalizer that turns a raw `courseInformation`
// JSON response into the shape the schedule generator already consumes —
// no network, no chrome.* API usage, fully unit-testable against the
// `tests/fixtures/wildcard/cs-4@.json` fixture.
//
// The actual HTTP fetcher lives in `background.js` and is gated on a
// separate feature flag (`bp_phase1_wildcards`) that defaults OFF until
// we capture the exact endpoint URL + params from a live DevTools trace.
// See `docs/decisions.md` D13 for the split rationale.
//
// Dual-export: usable both in the extension runtime (attaches to
// `globalThis.BPReq`) and in Node unit tests (`module.exports`).

(function (global) {
  "use strict";

  // Normalize a DegreeWorks `courseInformation` JSON response into an array
  // of concrete course entries + their available sections filtered to a
  // specific term.
  //
  // @param raw       Parsed JSON object of the shape
  //                  `{ courseInformation: { courses: [...] } }`
  //                  OR the bare `{ courses: [...] }` shape.
  // @param options   Optional: { termCode, excludeKeys, attributeFilter,
  //                  ruleLabel, ruleId, parentLabels }.
  //                  termCode: e.g. "202630". If set, each entry's
  //                    `sections[]` is filtered to sections whose section.
  //                    termCode matches.
  //                  excludeKeys: Set of `"SUBJ|NUMBER"` strings that should
  //                    be dropped (honors wildcard exceptions).
  //                  attributeFilter: string attribute code; only courses
  //                    whose `attributes[].code === filter` are kept.
  //                  ruleLabel / ruleId / parentLabels: provenance, passed
  //                    through to each output entry so downstream rationale
  //                    prompts can cite the requirement that surfaced the
  //                    course.
  // @returns Array<{
  //   subject, courseNumber, title, creditHourLow, attributes,
  //   prerequisites, sections, label, parentLabels, ruleId
  // }>
  function normalizeCourseInformationCourses(raw, options = {}) {
    const courses = _extractCourses(raw);
    const {
      termCode = null,
      excludeKeys = null,
      attributeFilter = null,
      ruleLabel = "",
      ruleId = null,
      parentLabels = [],
    } = options;
    const exclude =
      excludeKeys instanceof Set
        ? excludeKeys
        : Array.isArray(excludeKeys)
          ? new Set(excludeKeys)
          : null;

    const out = [];
    for (const c of courses) {
      const subject = c.subjectCode || c.discipline || "";
      const courseNumber = c.courseNumber || c.number || "";
      if (!subject || !courseNumber) continue;
      if (exclude && exclude.has(subject + "|" + courseNumber)) continue;
      if (attributeFilter) {
        const attrs = Array.isArray(c.attributes) ? c.attributes : [];
        const match = attrs.some(
          (a) => a && (a.code === attributeFilter || a.attribute === attributeFilter),
        );
        if (!match) continue;
      }

      const sectionsRaw = Array.isArray(c.sections) ? c.sections : [];
      const sections = termCode
        ? sectionsRaw.filter((s) => String(s.termCode) === String(termCode))
        : sectionsRaw.slice();

      out.push({
        subject,
        courseNumber,
        title: c.title || "",
        creditHourLow: _toNum(c.creditHourLow),
        creditHourHigh: _toNum(c.creditHourHigh),
        attributes: Array.isArray(c.attributes)
          ? c.attributes.map((a) => ({ code: a.code, description: a.description }))
          : [],
        prerequisites: Array.isArray(c.prerequisites) ? c.prerequisites.slice() : [],
        sections,
        label: ruleLabel,
        parentLabels: parentLabels.slice(),
        ruleId,
      });
    }
    return out;
  }

  // Given a wildcard record from `deriveEligible().wildcards[]`, build a
  // cache key safe to use as a map key. Stable across runs so a cache lookup
  // can elide a live fetch on the hot path.
  function wildcardCacheKey(wildcard, termCode) {
    const disc = wildcard.discipline || "@";
    const numPrefix = wildcard.numberPrefix || "@";
    const withs = Array.isArray(wildcard.withClauses) ? wildcard.withClauses : [];
    const withsSer = withs
      .map((w) => `${w.field || ""}:${w.code || ""}`)
      .sort()
      .join(";");
    return ["cinf", termCode || "?", disc, numPrefix, withsSer].join("|");
  }

  // Build the set of `"SUBJ|NUMBER"` keys that should be excluded from the
  // expansion results, based on the wildcard's `exceptOptions`.
  function exceptionKeysFromWildcard(wildcard) {
    const excepts = Array.isArray(wildcard.exceptOptions)
      ? wildcard.exceptOptions
      : [];
    const out = new Set();
    for (const opt of excepts) {
      if (!opt || opt.kind !== "concrete") continue;
      if (opt.course && opt.course.discipline && opt.course.number) {
        out.add(opt.course.discipline + "|" + opt.course.number);
      }
    }
    return out;
  }

  // ─── internals ───────────────────────────────────────────────────────────

  function _extractCourses(raw) {
    if (!raw || typeof raw !== "object") return [];
    if (Array.isArray(raw.courses)) return raw.courses;
    if (raw.courseInformation && Array.isArray(raw.courseInformation.courses)) {
      return raw.courseInformation.courses;
    }
    return [];
  }

  function _toNum(v) {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  // ─── exports ─────────────────────────────────────────────────────────────

  const api = {
    normalizeCourseInformationCourses,
    wildcardCacheKey,
    exceptionKeysFromWildcard,
  };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  global.BPReq = global.BPReq || {};
  Object.assign(global.BPReq, api);
})(typeof self !== "undefined" ? self : typeof globalThis !== "undefined" ? globalThis : this);
