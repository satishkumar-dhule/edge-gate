/**
 * Akamai Synthetic Release Gate - Pure Business Logic Engine
 * Implements PRD §6 and §7 requirements
 */

import {
  AcceptedRule,
  ComparisonItem,
  ComparisonKind,
  DifferenceItem,
  HostMap,
  ItemVerdict,
  OverallVerdict,
  TestClass,
  TestResult,
  VisualJudgeResult,
  VisualVerdict,
} from './types';

// ---------------------------------------------------------------------------
// 1. Normalization Functions (§6.5.2 FR-CMP-11, FR-CMP-12)
// ---------------------------------------------------------------------------

/**
 * FR-CMP-11: Normalizes cache-control header.
 * max-age=<n> with n > 0 compares as max-age=N so cacheable is compared against
 * non-cacheable, not the remaining TTL.
 */
export function normalizeCacheControl(headerVal: string | undefined): string {
  if (!headerVal) return '';
  return headerVal
    .toLowerCase()
    .replace(/max-age=\d+/g, (match) => {
      const num = parseInt(match.replace('max-age=', ''), 10);
      return num > 0 ? 'max-age=N' : 'max-age=0';
    })
    .replace(/s-maxage=\d+/g, (match) => {
      const num = parseInt(match.replace('s-maxage=', ''), 10);
      return num > 0 ? 's-maxage=N' : 's-maxage=0';
    })
    .trim();
}

/**
 * FR-CMP-11: Normalizes content-type header (case-insensitive & trimmed).
 */
export function normalizeContentType(headerVal: string | undefined): string {
  if (!headerVal) return '';
  return headerVal.toLowerCase().trim();
}

/**
 * FR-CMP-12: Maps an env-specific URL back to its canonical host representation
 * using the inverse of the hostMap.
 */
export function mapToCanonicalUrl(rawUrl: string, hostMap: HostMap): string {
  if (!rawUrl) return '';
  try {
    const urlObj = new URL(rawUrl);
    // Find canonical host mapped to this host
    for (const [canonicalHost, envHost] of Object.entries(hostMap)) {
      if (urlObj.hostname.toLowerCase() === envHost.toLowerCase()) {
        urlObj.hostname = canonicalHost;
        return urlObj.toString();
      }
    }
    return rawUrl;
  } catch {
    // If not a valid absolute URL, check substring replacements
    let normalized = rawUrl;
    for (const [canonicalHost, envHost] of Object.entries(hostMap)) {
      if (normalized.includes(envHost)) {
        normalized = normalized.split(envHost).join(canonicalHost);
      }
    }
    return normalized;
  }
}

// ---------------------------------------------------------------------------
// 2. Functional Diffing (§6.5.2 FR-CMP-10)
// ---------------------------------------------------------------------------

export interface DiffInspectionContext {
  candidateHostMap?: HostMap;
  baselineHostMap?: HostMap;
}

/**
 * FR-CMP-10, 11, 12: Deterministic functional diff between candidate and baseline.
 * Checks: status, location, content-type, cache-control, x-check-cacheable,
 * x-sfdc-content-source, pass/fail, and one-sided presence.
 */
export function calculateFunctionalDiffs(
  candidate?: TestResult,
  baseline?: TestResult,
  ctx: DiffInspectionContext = {}
): DifferenceItem[] {
  const diffs: DifferenceItem[] = [];

  if (!candidate && baseline) {
    diffs.push({
      kind: 'only_ran_on',
      candidateValue: 'did not run',
      baselineValue: 'ran',
      severity: 'major',
    });
    return diffs;
  }

  if (candidate && !baseline) {
    diffs.push({
      kind: 'only_ran_on',
      candidateValue: 'ran',
      baselineValue: 'did not run',
      severity: 'major',
    });
    return diffs;
  }

  if (!candidate || !baseline) return diffs;

  // 1. Status Check
  if (candidate.actualStatus !== baseline.actualStatus) {
    diffs.push({
      kind: 'status',
      candidateValue: String(candidate.actualStatus),
      baselineValue: String(baseline.actualStatus),
      severity: 'major',
    });
  }

  // 2. Pass / Fail Check
  const candPass = candidate.acceptedPass ?? candidate.pass;
  const basePass = baseline.acceptedPass ?? baseline.pass;
  if (candPass !== basePass) {
    diffs.push({
      kind: 'assertions',
      candidateValue: candPass ? 'PASS' : `FAIL: ${candidate.errors.join('; ')}`,
      baselineValue: basePass ? 'PASS' : `FAIL: ${baseline.errors.join('; ')}`,
      severity: 'major',
    });
  }

  // Helper for case-insensitive header getter
  const getHeader = (
    headers: Record<string, string | undefined>,
    name: string
  ) => {
    const target = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === target) return v;
    }
    return undefined;
  };

  // 3. Location Check with Host Normalization (FR-CMP-12)
  const candLoc = getHeader(candidate.capturedHeaders, 'location');
  const baseLoc = getHeader(baseline.capturedHeaders, 'location');
  if (candLoc || baseLoc) {
    const cLocStr = candLoc || '';
    const bLocStr = baseLoc || '';
    if (cLocStr !== bLocStr) {
      const cNorm = mapToCanonicalUrl(cLocStr, ctx.candidateHostMap || {});
      const bNorm = mapToCanonicalUrl(bLocStr, ctx.baselineHostMap || {});
      const matchesAfterNormalization = cNorm === bNorm && cNorm !== '';

      diffs.push({
        kind: 'header',
        field: 'location',
        candidateValue: cLocStr,
        baselineValue: bLocStr,
        severity: matchesAfterNormalization ? 'minor' : 'major',
        isHostNormalizedMatch: matchesAfterNormalization,
      });
    }
  }

  // 4. Content-Type Check (FR-CMP-11: case-insensitive)
  const candCT = getHeader(candidate.capturedHeaders, 'content-type');
  const baseCT = getHeader(baseline.capturedHeaders, 'content-type');
  if (candCT || baseCT) {
    const cNorm = normalizeContentType(candCT);
    const bNorm = normalizeContentType(baseCT);
    if (cNorm !== bNorm) {
      diffs.push({
        kind: 'header',
        field: 'content-type',
        candidateValue: candCT || '(none)',
        baselineValue: baseCT || '(none)',
        severity: 'major',
      });
    }
  }

  // 5. Cache-Control Check (FR-CMP-11: max-age=N normalization)
  const candCC = getHeader(candidate.capturedHeaders, 'cache-control');
  const baseCC = getHeader(baseline.capturedHeaders, 'cache-control');
  if (candCC || baseCC) {
    const cNorm = normalizeCacheControl(candCC);
    const bNorm = normalizeCacheControl(baseCC);
    if (cNorm !== bNorm) {
      diffs.push({
        kind: 'header',
        field: 'cache-control',
        candidateValue: candCC || '(none)',
        baselineValue: baseCC || '(none)',
        severity: 'minor',
      });
    }
  }

  // 6. x-check-cacheable
  const candXCC = getHeader(candidate.capturedHeaders, 'x-check-cacheable');
  const baseXCC = getHeader(baseline.capturedHeaders, 'x-check-cacheable');
  if (candXCC || baseXCC) {
    const cVal = (candXCC || '').toUpperCase().trim();
    const bVal = (baseXCC || '').toUpperCase().trim();
    if (cVal !== bVal) {
      diffs.push({
        kind: 'header',
        field: 'x-check-cacheable',
        candidateValue: candXCC || '(none)',
        baselineValue: baseXCC || '(none)',
        severity: 'minor',
      });
    }
  }

  // 7. x-sfdc-content-source
  const candSCS = getHeader(candidate.capturedHeaders, 'x-sfdc-content-source');
  const baseSCS = getHeader(baseline.capturedHeaders, 'x-sfdc-content-source');
  if (candSCS || baseSCS) {
    const cVal = (candSCS || '').trim();
    const bVal = (baseSCS || '').trim();
    if (cVal !== bVal) {
      diffs.push({
        kind: 'header',
        field: 'x-sfdc-content-source',
        candidateValue: candSCS || '(none)',
        baselineValue: baseSCS || '(none)',
        severity: 'minor',
      });
    }
  }

  return diffs;
}

// ---------------------------------------------------------------------------
// 3. Accepted Differences Rule Engine (§6.6 FR-RULE-1..6)
// ---------------------------------------------------------------------------

/**
 * FR-RULE-2: Check whether a specific functional or visual diff is matched by an enabled rule.
 * Rules match the KIND of difference (e.g. "x-check-cacheable"), not the specific value.
 */
export function matchesAcceptedRule(
  diff: DifferenceItem,
  testId: string,
  comparisonId: string,
  rule: AcceptedRule
): boolean {
  if (!rule.enabled) return false;

  // Comparison scope check: must match this comparison or "all"
  if (rule.comparisonId !== 'all' && rule.comparisonId !== comparisonId) {
    return false;
  }

  // Test scope check: if rule specifies a testId, it must match
  if (rule.testId && rule.testId !== testId) {
    return false;
  }

  const kind = rule.kind.trim();

  // Status rule
  if (kind.toLowerCase() === 'status' && diff.kind === 'status') {
    return true;
  }

  // Assertions rule
  if (kind.toLowerCase() === 'assertions' && diff.kind === 'assertions') {
    return true;
  }

  // Only ran on rule
  if (kind.toLowerCase() === 'only ran on' && diff.kind === 'only_ran_on') {
    return true;
  }

  // Header rule (e.g. "x-check-cacheable", "cache-control", "location")
  if (diff.kind === 'header' && diff.field) {
    if (diff.field.toLowerCase() === kind.toLowerCase()) {
      return true;
    }
  }

  // Cookie rule (e.g. "edge_region" or "cookie:edge_region")
  if (diff.kind === 'cookie' && diff.field) {
    const cleanField = diff.field.toLowerCase().replace(/^cookie:/, '').trim();
    const cleanRule = kind.toLowerCase().replace(/^cookie:/, '').trim();
    if (cleanField === cleanRule) {
      return true;
    }
  }

  // Assertion error by exact message: rule kind is "error: <message>"
  if (kind.toLowerCase().startsWith('error:') && diff.kind === 'assertions') {
    const targetMsg = kind.slice(6).trim();
    if (diff.candidateValue.includes(targetMsg) || diff.baselineValue.includes(targetMsg)) {
      return true;
    }
  }

  return false;
}

export interface ApplyRulesOptions {
  acceptedCookies?: string[];
  acceptedVisualTests?: string[];
  ignoreAcceptedDiffs?: boolean;
}

/**
 * FR-RULE-4, 5, 6: Applies accepted rules dynamically on an item during read.
 * Excludes matching differences from affecting item verdict and Go/No-Go.
 */
export function applyRulesToItem(
  item: ComparisonItem,
  comparisonId: string,
  rules: AcceptedRule[],
  kind: ComparisonKind,
  options: ApplyRulesOptions = {}
): ComparisonItem {
  const ignoreAccepted = options.ignoreAcceptedDiffs ?? true;
  const normalizeCookieKey = (raw: string) =>
    raw.toLowerCase().replace(/^cookie:/, '').trim();
  const normalizedAcceptedCookies = (options.acceptedCookies || []).map(
    normalizeCookieKey
  );
  const isVisualTestAccepted = (options.acceptedVisualTests || []).includes(
    item.testId
  );

  // Deep clone functional diffs to not mutate source
  const updatedDiffs: DifferenceItem[] = item.functionalDiffs.map((d) => {
    let accepted = false;
    let acceptedRuleId: string | undefined = undefined;

    // Check if location was already a host-normalized match in env comparison
    if (d.field === 'location' && d.isHostNormalizedMatch && kind === 'env') {
      accepted = true;
    }

    for (const rule of rules) {
      if (matchesAcceptedRule(d, item.testId, comparisonId, rule)) {
        accepted = true;
        acceptedRuleId = rule.id;
        break;
      }
    }

    return {
      ...d,
      accepted: d.accepted || accepted,
      acceptedRuleId: d.acceptedRuleId || acceptedRuleId,
    };
  });

  // Deep clone cookie diffs and apply acceptedCookies + cookie rules
  const updatedCookieDiffs: DifferenceItem[] = (item.cookieDiffs || []).map(
    (d) => {
      let accepted = Boolean(d.accepted);
      let acceptedRuleId: string | undefined = d.acceptedRuleId;

      if (
        d.field &&
        normalizedAcceptedCookies.includes(normalizeCookieKey(d.field))
      ) {
        accepted = true;
      }

      for (const rule of rules) {
        if (matchesAcceptedRule(d, item.testId, comparisonId, rule)) {
          accepted = true;
          acceptedRuleId = rule.id;
          break;
        }
      }

      return {
        ...d,
        accepted,
        acceptedRuleId,
      };
    }
  );

  // Visual differences handling (FR-RULE-6)
  let updatedVisual = item.visualResult ? { ...item.visualResult } : undefined;
  if (updatedVisual && updatedVisual.differences) {
    const updatedDifferences = updatedVisual.differences.map((vDiff) => {
      let isAccepted = Boolean(vDiff.accepted) || isVisualTestAccepted;
      const vDesc = vDiff.description.toLowerCase();

      for (const rule of rules) {
        if (!rule.enabled) continue;
        if (rule.comparisonId !== 'all' && rule.comparisonId !== comparisonId) continue;
        if (rule.testId && rule.testId !== item.testId) continue;

        if (rule.kind.toLowerCase().startsWith('visual:')) {
          const ruleDesc = rule.kind.slice(7).trim().toLowerCase();
          if (ruleDesc && (vDesc.includes(ruleDesc) || ruleDesc.includes(vDesc))) {
            isAccepted = true;
            break;
          }
        }
      }

      return {
        ...vDiff,
        accepted: isAccepted,
      };
    });

    // Recompute visual verdict based on remaining unaccepted differences
    const unaccepted = ignoreAccepted
      ? updatedDifferences.filter((d) => !d.accepted)
      : updatedDifferences;
    let newVerdict = updatedVisual.verdict;
    if (updatedVisual.verdict !== 'error') {
      if (unaccepted.length === 0) {
        newVerdict = 'same';
      } else {
        const hasMajor = unaccepted.some((d) => d.severity === 'major');
        newVerdict = hasMajor ? 'different' : 'minor';
      }
    }

    updatedVisual = {
      ...updatedVisual,
      differences: updatedDifferences,
      verdict: newVerdict,
      acceptedRulesAppliedCount: updatedDifferences.filter((d) => d.accepted).length,
    };
  }

  // Compute recalculated item verdict with unaccepted functional + cookie diffs
  const activeFunctionalDiffs = ignoreAccepted
    ? updatedDiffs.filter((d) => !d.accepted)
    : updatedDiffs;
  const activeCookieDiffs = ignoreAccepted
    ? updatedCookieDiffs.filter((d) => !d.accepted)
    : updatedCookieDiffs;
  const activeDiffs = [...activeFunctionalDiffs, ...activeCookieDiffs];
  const activeVisualVerdict = updatedVisual?.verdict ?? 'same';

  const recalculatedVerdict = calculateItemVerdict(activeDiffs, activeVisualVerdict, kind);

  return {
    ...item,
    functionalDiffs: updatedDiffs,
    cookieDiffs: updatedCookieDiffs,
    visualResult: updatedVisual,
    itemVerdict: recalculatedVerdict,
  };
}

// ---------------------------------------------------------------------------
// 4. Item and Comparison Verdicts (§6.5.4, §7.1)
// ---------------------------------------------------------------------------

/**
 * FR-CMP-30, 31: Calculates item verdict based on functional differences and visual verdict.
 */
export function calculateItemVerdict(
  activeDiffs: DifferenceItem[],
  visualVerdict: VisualVerdict,
  kind: ComparisonKind
): ItemVerdict {
  if (kind === 'network') {
    // Network: different if ANY functional diff or visual 'different'
    if (activeDiffs.length > 0 || visualVerdict === 'different') {
      return 'different';
    }
    return visualVerdict;
  } else {
    // Env / Adhoc:
    // Critical diffs (status, pass/fail, one-sided) or visual different -> different
    const hasCritical = activeDiffs.some(
      (d) => d.kind === 'status' || d.kind === 'assertions' || d.kind === 'only_ran_on'
    );
    if (hasCritical || visualVerdict === 'different') {
      return 'different';
    }
    // Header-only diffs give at least 'minor'
    if (activeDiffs.length > 0) {
      return 'minor';
    }
    return visualVerdict;
  }
}

/**
 * §7.1: Go/No-Go Decision Engine.
 * Applied ONLY to full finished comparisons after applying accepted rules.
 */
export function calculateHeadlineVerdict(
  items: ComparisonItem[],
  kind: ComparisonKind,
  isPartial: boolean = false,
  isRunning: boolean = false
): OverallVerdict {
  if (isRunning) return 'COMPARING';
  if (isPartial) return 'PARTIAL';
  if (items.length === 0) return 'NONE';

  // Rule: A test failing on candidate is NEVER Go (even if it also fails on baseline - "red on both sides is never GO")
  const candidateFailingCount = items.filter((it) => {
    const cand = it.candidateResult;
    if (!cand) return false;
    return !(cand.acceptedPass ?? cand.pass);
  }).length;

  if (kind === 'network') {
    // Network comparison:
    // NO-GO: any functional diff or any visual 'different' (i.e. any item with 'different')
    const hasDifferent = items.some((it) => it.itemVerdict === 'different');
    if (hasDifferent) {
      return 'NO-GO';
    }

    // REVIEW: any minor, any judge error, any test failing on candidate, or no items
    const hasMinor = items.some((it) => it.itemVerdict === 'minor');
    const hasError = items.some((it) => it.itemVerdict === 'error');
    if (hasMinor || hasError || candidateFailingCount > 0) {
      return 'REVIEW';
    }

    // GO: everything else
    return 'GO';
  } else {
    // Env comparison (and adhoc):
    // NO-GO: any critical functional diff (status, assertions, only_ran_on) or visual 'different'
    const hasCritical = items.some((it) => {
      if (it.visualResult?.verdict === 'different') return true;
      return it.functionalDiffs.some(
        (d) => !d.accepted && (d.kind === 'status' || d.kind === 'assertions' || d.kind === 'only_ran_on')
      );
    });
    if (hasCritical) {
      return 'NO-GO';
    }

    // REVIEW: header-only diffs, any judge error, any test failing on candidate
    const hasHeaderDiffs = items.some((it) =>
      it.functionalDiffs.some((d) => !d.accepted && d.kind === 'header')
    );
    const hasError = items.some((it) => it.itemVerdict === 'error');
    if (hasHeaderDiffs || hasError || candidateFailingCount > 0) {
      return 'REVIEW';
    }

    // GO: everything else (including 'minor' content changes!)
    return 'GO';
  }
}

/**
 * Worst verdict ordering: NO-GO > REVIEW > COMPARING > GO > PARTIAL > NONE
 */
export function getWorstVerdict(verdicts: OverallVerdict[]): OverallVerdict {
  const precedence: Record<OverallVerdict, number> = {
    'NO-GO': 6,
    REVIEW: 5,
    COMPARING: 4,
    GO: 3,
    PARTIAL: 2,
    NONE: 1,
  };

  let worst: OverallVerdict = 'NONE';
  let maxWeight = 0;

  for (const v of verdicts) {
    const weight = precedence[v] || 0;
    if (weight > maxWeight) {
      maxWeight = weight;
      worst = v;
    }
  }

  return worst;
}

// ---------------------------------------------------------------------------
// 5. Test Classification (§7.2)
// ---------------------------------------------------------------------------

/**
 * §7.2: Classify test over recent runs (newest first).
 * Evaluated strictly in order:
 * 1. stable: no failures
 * 2. failing in all: every run failed
 * 3. regressed: latest failed and the 3 latest all failed
 * 4. flaky: failure share < 30% OR >= 3 pass/fail flips
 * 5. n/N failed: otherwise
 */
export function classifyTest(runPassFailList: boolean[]): TestClass {
  if (runPassFailList.length === 0) return 'stable';

  const total = runPassFailList.length;
  const failureCount = runPassFailList.filter((passed) => !passed).length;

  // 1. Stable
  if (failureCount === 0) return 'stable';

  // 2. Failing in all
  if (failureCount === total) return 'failing in all';

  // 3. Regressed: latest failed and the 3 latest all failed
  if (total >= 3 && !runPassFailList[0] && !runPassFailList[1] && !runPassFailList[2]) {
    return 'regressed';
  }

  // 4. Flaky: failure share < 30% OR >= 3 pass/fail flips
  const failureShare = failureCount / total;
  let flips = 0;
  for (let i = 0; i < total - 1; i++) {
    if (runPassFailList[i] !== runPassFailList[i + 1]) {
      flips++;
    }
  }

  if (failureShare < 0.3 || flips >= 3) {
    return 'flaky';
  }

  // 5. Otherwise
  return 'n/N failed';
}

// ---------------------------------------------------------------------------
// 6. Failure Signatures & Environmental Anomaly Detection (§6.7 FR-INS-10, AC8)
// ---------------------------------------------------------------------------

/**
 * Normalizes error messages into signatures:
 * URLs reduced to host + path, quoted values to "…", numbers to N, max 120 chars.
 */
export function normalizeFailureSignature(errorMsg: string): string {
  if (!errorMsg) return 'Unknown error';

  let sig = errorMsg
    // URLs to host+path
    .replace(/https?:\/\/[^\s/$.?#].[^\s]*/gi, (url) => {
      try {
        const u = new URL(url);
        return `${u.hostname}${u.pathname}`;
      } catch {
        return url;
      }
    })
    // Quoted values to "…"
    .replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, '"…"')
    // Numbers to N
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();

  if (sig.length > 120) {
    sig = sig.slice(0, 117) + '...';
  }

  return sig;
}

export interface GroupedFailureSignature {
  signature: string;
  sampleError: string;
  count: number;
  share: number;
  testIds: string[];
  looksEnvironmental: boolean; // Covers > 50% of run
}

/**
 * Groups failed test results by failure signature and identifies environmental anomalies.
 */
export function groupFailureSignatures(
  failedResults: TestResult[],
  totalTestsInRun: number
): GroupedFailureSignature[] {
  const map = new Map<string, { sample: string; count: number; testIds: string[] }>();

  for (const res of failedResults) {
    const rawError = res.errors.length > 0 ? res.errors[0] : `Status ${res.actualStatus} unexpected`;
    const sig = normalizeFailureSignature(rawError);

    const existing = map.get(sig);
    if (existing) {
      existing.count++;
      existing.testIds.push(res.id);
    } else {
      map.set(sig, { sample: rawError, count: 1, testIds: [res.id] });
    }
  }

  const groups: GroupedFailureSignature[] = [];
  const denominator = totalTestsInRun > 0 ? totalTestsInRun : failedResults.length;

  for (const [sig, data] of map.entries()) {
    const share = denominator > 0 ? data.count / denominator : 0;
    groups.push({
      signature: sig,
      sampleError: data.sample,
      count: data.count,
      share,
      testIds: data.testIds,
      looksEnvironmental: share > 0.5, // FR-INS-10: > 50% of a run flags "looks environmental"
    });
  }

  // Environmental ranked first, then highest count
  return groups.sort((a, b) => {
    if (a.looksEnvironmental && !b.looksEnvironmental) return -1;
    if (!a.looksEnvironmental && b.looksEnvironmental) return 1;
    return b.count - a.count;
  });
}

// ---------------------------------------------------------------------------
// 7. Curl Reproduction Command Generator (§6.7 FR-INS-12, AC11)
// ---------------------------------------------------------------------------

export interface CurlOptions {
  stagingEdgeIp?: string;
  resolvedHost?: string;
}

/**
 * FR-INS-12, AC11: Generates equivalent curl command with --resolve pinning to staging edge IP,
 * Akamai Pragma debug headers, identifiable User-Agent, without revealing secrets.
 */
export function generateReproduceCurl(result: TestResult, options: CurlOptions = {}): string {
  const lines: string[] = [];
  const edgeIp = options.stagingEdgeIp || result.stagingEdgeIp;

  let host = options.resolvedHost;
  let port = '443';
  try {
    const u = new URL(result.url);
    host = host || u.hostname;
    port = u.port || (u.protocol === 'https:' ? '443' : '80');
  } catch {
    host = host || 'example.com';
  }

  lines.push('# -------------------------------------------------------------------');
  lines.push(`# Reproduce check for: ${result.name} (ID: ${result.id})`);
  if (result.stagingEdgeIp) {
    lines.push(`# Staging Edge IP: ${result.stagingEdgeIp}`);
  }
  if (result.note) {
    lines.push(`# Edge Note: ${result.note}`);
  }
  if (result.redirectChain && result.redirectChain.length > 0) {
    lines.push(`# Hops: ${result.redirectChain.map((h) => `${h.status} -> ${h.url}`).join(' | ')}`);
  }
  lines.push('# -------------------------------------------------------------------');

  const curlParts: string[] = ['curl -sS -v -X GET'];

  // Add --resolve if staging edge IP is available
  if (edgeIp && host) {
    curlParts.push(`--resolve "${host}:${port}:${edgeIp}"`);
  }

  // Akamai Pragma headers (FR-EXEC-4)
  curlParts.push('-H "Pragma: akamai-x-cache-on, akamai-x-cache-remote-on, akamai-x-check-cacheable, akamai-x-get-cache-key, akamai-x-get-true-cache-key, akamai-x-get-request-id"');
  curlParts.push('-H "User-Agent: Akamai-Synthetics-Runner/2.4 (ReleaseGate; StagingCheck)"');

  // URL (escaped)
  curlParts.push(`"${result.url}"`);

  lines.push(curlParts.join(' \\\n  '));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 8. Markdown Summary for Change Tickets (§6.7 FR-INS-11)
// ---------------------------------------------------------------------------

/**
 * FR-INS-11: Markdown summary of a comparison for change tickets.
 */
export function generateComparisonMarkdownSummary(
  comparison: {
    comparisonId: string;
    headlineVerdict: OverallVerdict;
    candidateLabel?: string;
    candidateTarget: string;
    baselineTarget: string;
    candidateStartTime: string;
    baselineStartTime: string;
    isPinnedBaseline: boolean;
    pairingTimeGapMinutes: number;
    rollup: {
      functional: number;
      critical: number;
      visual: number;
      minor: number;
      error: number;
      failingOnCandidate: number;
    };
    items: ComparisonItem[];
  },
  reportUrl: string = 'https://release-gate.internal/comparisons/'
): string {
  const { headlineVerdict, candidateLabel, candidateTarget, baselineTarget } = comparison;

  const badgeEmoji = headlineVerdict === 'GO' ? '🟢' : headlineVerdict === 'REVIEW' ? '🟡' : '🔴';
  const labelText = candidateLabel ? ` [${candidateLabel}]` : '';

  const lines: string[] = [];
  lines.push(`### ${badgeEmoji} Akamai Release Gate Verdict: **${headlineVerdict}**${labelText}`);
  lines.push('');
  lines.push(`- **Comparison:** \`${comparison.comparisonId}\``);
  lines.push(`- **Candidate (Staging):** \`${candidateTarget}\` (${comparison.candidateStartTime})`);
  lines.push(`- **Baseline (Production):** \`${baselineTarget}\` (${comparison.baselineStartTime})`);
  lines.push(`- **Baseline Pinned:** ${comparison.isPinnedBaseline ? 'Yes (pinned)' : `No (gap: ${Math.round(comparison.pairingTimeGapMinutes)} min)`}`);
  lines.push(`- **Rollup:** ${comparison.rollup.functional} functional diffs · ${comparison.rollup.visual} visual diffs · ${comparison.rollup.minor} minor · ${comparison.rollup.failingOnCandidate} candidate failures`);
  lines.push('');

  const worstItems = [...comparison.items]
    .filter((it) => it.itemVerdict !== 'same')
    .slice(0, 12);

  if (worstItems.length > 0) {
    lines.push('#### Top Differences (up to 12)');
    lines.push('| Test ID | Name | Verdict | First Difference / Visual Finding |');
    lines.push('|---|---|---|---|');

    for (const item of worstItems) {
      let diffSummary = '—';
      const unacceptedFunc = item.functionalDiffs.filter((d) => !d.accepted);
      const unacceptedCookies = (item.cookieDiffs || []).filter((d) => !d.accepted);
      if (unacceptedFunc.length > 0) {
        const first = unacceptedFunc[0];
        diffSummary = `${first.field || first.kind}: ${first.candidateValue} vs ${first.baselineValue}`;
      } else if (unacceptedCookies.length > 0) {
        const first = unacceptedCookies[0];
        diffSummary = `cookie ${first.field}: ${first.candidateValue} vs ${first.baselineValue}`;
      } else if (item.visualResult) {
        diffSummary = item.visualResult.summary;
      }
      lines.push(`| \`${item.testId}\` | ${item.testName} | **${item.itemVerdict.toUpperCase()}** | ${diffSummary.replace(/\|/g, '/')} |`);
    }

    const remaining = comparison.items.filter((it) => it.itemVerdict !== 'same').length - worstItems.length;
    if (remaining > 0) {
      lines.push(`*... plus ${remaining} more differences.*`);
    }
    lines.push('');
  }

  lines.push(`> 🔗 Full Evidence Report: [${comparison.comparisonId}](${reportUrl}${encodeURIComponent(comparison.comparisonId)})`);
  return lines.join('\n');
}
