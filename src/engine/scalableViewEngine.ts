import { AppConfig, ComparisonItem, TestResult } from './types';
import { TestCaseDefinition } from '../config/template.config';

export type RegionCode = 'APAC' | 'EMEA' | 'AMER' | 'GLOBAL';
export type FleetCohort = 'all' | 'regional-pop' | 'global-core' | 'enterprise-scale';
export type VerdictFilter = 'ALL' | 'NO-GO' | 'REVIEW' | 'GO';
export type DiffDimensionFilter =
  | 'all'
  | 'any-diff'
  | 'headers'
  | 'cookies'
  | 'visual'
  | 'multi-hop'
  | 'clean';
export type SuiteFacetFilter =
  | 'all'
  | 'drift'
  | 'redirects'
  | 'cache-anomaly'
  | 'visual-diff'
  | 'multi-hop';
export type SuiteSortField =
  | 'id'
  | 'stg-desc'
  | 'prd-desc'
  | 'delta-desc'
  | 'diffs-desc';

export interface PropertyRegionMeta {
  regionCode: RegionCode;
  cohort: Exclude<FleetCohort, 'all'>;
  popCode: string;
  popLabel: string;
}

const REGIONAL_POP_MAP: Record<
  string,
  { regionCode: RegionCode; popCode: string; popLabel: string }
> = {
  japan: { regionCode: 'APAC', popCode: 'NRT', popLabel: 'Tokyo PoP (ap-northeast-1)' },
  apac: { regionCode: 'APAC', popCode: 'SIN', popLabel: 'Singapore PoP (ap-southeast-1)' },
  germany: { regionCode: 'EMEA', popCode: 'FRA', popLabel: 'Frankfurt PoP (eu-central-1)' },
  uk: { regionCode: 'EMEA', popCode: 'LHR', popLabel: 'London PoP (eu-west-2)' },
  emea: { regionCode: 'EMEA', popCode: 'AMS', popLabel: 'Amsterdam PoP (eu-west-1)' },
  americas: { regionCode: 'AMER', popCode: 'IAD', popLabel: 'Ashburn PoP (us-east-1)' },
};

const GLOBAL_CORE_IDS = new Set([
  'www',
  'trailhead',
  'appexchange',
  'help',
  'developer',
  'status',
  'blogs',
  'events',
]);

export function classifyPropertyRegion(appId: string): PropertyRegionMeta {
  const normalized = appId.toLowerCase().trim();
  if (REGIONAL_POP_MAP[normalized]) {
    const entry = REGIONAL_POP_MAP[normalized];
    return {
      regionCode: entry.regionCode,
      cohort: 'regional-pop',
      popCode: entry.popCode,
      popLabel: entry.popLabel,
    };
  }

  if (GLOBAL_CORE_IDS.has(normalized)) {
    return {
      regionCode: 'GLOBAL',
      cohort: 'global-core',
      popCode: 'ANY',
      popLabel: 'Global Anycast Edge',
    };
  }

  // Deterministic regional distribution for 50–500+ enterprise properties
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  const mod = hash % 4;
  if (mod === 0) {
    return {
      regionCode: 'APAC',
      cohort: 'enterprise-scale',
      popCode: 'NRT/SIN',
      popLabel: 'APAC Regional Edge',
    };
  }
  if (mod === 1) {
    return {
      regionCode: 'EMEA',
      cohort: 'enterprise-scale',
      popCode: 'FRA/LHR',
      popLabel: 'EMEA Regional Edge',
    };
  }
  if (mod === 2) {
    return {
      regionCode: 'AMER',
      cohort: 'enterprise-scale',
      popCode: 'IAD/SJC',
      popLabel: 'Americas Regional Edge',
    };
  }
  return {
    regionCode: 'GLOBAL',
    cohort: 'enterprise-scale',
    popCode: 'GLB',
    popLabel: 'Global Enterprise Edge',
  };
}

export interface FleetPropertyVerdictSummary {
  verdict: 'GO' | 'REVIEW' | 'NO-GO';
  funcFails: number;
  cookieDiffs: number;
  visDiffs: number;
  stgTarget: string;
  prdTarget: string;
  stgRunKey?: string;
  prdRunKey?: string;
  firstBlockerTestId?: string;
  firstCookieTestId?: string;
  firstVisTestId?: string;
}

export interface EnrichedFleetProperty {
  app: AppConfig;
  meta: PropertyRegionMeta;
  summary: FleetPropertyVerdictSummary;
}

export interface FilterFleetOptions {
  query?: string;
  cohort?: FleetCohort;
  region?: RegionCode | 'ALL';
  verdict?: VerdictFilter;
  sortBy?: 'priority' | 'verdict' | 'id' | 'diffs';
  activeAppId?: string;
  page?: number;
  pageSize?: number;
}

export interface FilteredFleetResult {
  items: EnrichedFleetProperty[];
  allFiltered: EnrichedFleetProperty[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  countsByVerdict: {
    ALL: number;
    'NO-GO': number;
    REVIEW: number;
    GO: number;
  };
  countsByCohort: {
    all: number;
    'regional-pop': number;
    'global-core': number;
    'enterprise-scale': number;
  };
  countsByRegion: {
    ALL: number;
    APAC: number;
    EMEA: number;
    AMER: number;
    GLOBAL: number;
  };
}

export function filterAndPaginateFleet(
  apps: AppConfig[],
  verdictMap: Record<string, FleetPropertyVerdictSummary>,
  options: FilterFleetOptions = {}
): FilteredFleetResult {
  const {
    query = '',
    cohort = 'all',
    region = 'ALL',
    verdict = 'ALL',
    sortBy = 'priority',
    activeAppId = '',
    page = 1,
    pageSize = 16,
  } = options;

  const q = query.trim().toLowerCase();

  const enriched: EnrichedFleetProperty[] = apps.map((app) => {
    const meta = classifyPropertyRegion(app.id);
    const summary = verdictMap[app.id] || {
      verdict: 'GO',
      funcFails: 0,
      cookieDiffs: 0,
      visDiffs: 0,
      stgTarget: `${app.id}.prod.staging`,
      prdTarget: `${app.id}.prod.prod`,
    };
    return { app, meta, summary };
  });

  const countsByVerdict = {
    ALL: enriched.length,
    'NO-GO': 0,
    REVIEW: 0,
    GO: 0,
  };
  const countsByCohort = {
    all: enriched.length,
    'regional-pop': 0,
    'global-core': 0,
    'enterprise-scale': 0,
  };
  const countsByRegion = {
    ALL: enriched.length,
    APAC: 0,
    EMEA: 0,
    AMER: 0,
    GLOBAL: 0,
  };

  for (const item of enriched) {
    countsByVerdict[item.summary.verdict]++;
    countsByCohort[item.meta.cohort]++;
    countsByRegion[item.meta.regionCode]++;
  }

  const filtered = enriched.filter((item) => {
    if (cohort !== 'all' && item.meta.cohort !== cohort) return false;
    if (region !== 'ALL' && item.meta.regionCode !== region) return false;
    if (verdict !== 'ALL' && item.summary.verdict !== verdict) return false;
    if (q) {
      const env = item.app.envs?.[0];
      const hostKeys = env?.hostMap ? Object.keys(env.hostMap) : [];
      const hostVals = env?.hostMap ? Object.values(env.hostMap) : [];
      const hay = [
        item.app.id,
        item.app.name,
        ...hostKeys,
        ...hostVals,
        item.meta.popCode,
        item.meta.popLabel,
        item.meta.regionCode,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const verdictWeight = (v: 'NO-GO' | 'REVIEW' | 'GO') =>
    v === 'NO-GO' ? 0 : v === 'REVIEW' ? 1 : 2;

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'priority') {
      // Always keep activeAppId and 'www' near top on page 1 so primary entry points are immediate
      const aPin = a.app.id === activeAppId ? -2 : a.app.id === 'www' ? -1 : 0;
      const bPin = b.app.id === activeAppId ? -2 : b.app.id === 'www' ? -1 : 0;
      if (aPin !== bPin) return aPin - bPin;

      // Regional PoPs & Global Core before synthetic scale props
      const cohortOrder = (c: PropertyRegionMeta['cohort']) =>
        c === 'regional-pop' ? 0 : c === 'global-core' ? 1 : 2;
      const cDiff = cohortOrder(a.meta.cohort) - cohortOrder(b.meta.cohort);
      if (cDiff !== 0) return cDiff;

      const vDiff = verdictWeight(a.summary.verdict) - verdictWeight(b.summary.verdict);
      if (vDiff !== 0) return vDiff;
      return a.app.id.localeCompare(b.app.id);
    }

    if (sortBy === 'verdict') {
      const vDiff = verdictWeight(a.summary.verdict) - verdictWeight(b.summary.verdict);
      if (vDiff !== 0) return vDiff;
      const aTotal = a.summary.funcFails * 10 + a.summary.cookieDiffs + a.summary.visDiffs;
      const bTotal = b.summary.funcFails * 10 + b.summary.cookieDiffs + b.summary.visDiffs;
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.app.id.localeCompare(b.app.id);
    }

    if (sortBy === 'diffs') {
      const aTotal = a.summary.funcFails * 10 + a.summary.cookieDiffs + a.summary.visDiffs;
      const bTotal = b.summary.funcFails * 10 + b.summary.cookieDiffs + b.summary.visDiffs;
      if (bTotal !== aTotal) return bTotal - aTotal;
      return a.app.id.localeCompare(b.app.id);
    }

    return a.app.id.localeCompare(b.app.id);
  });

  const safePageSize = Math.max(1, pageSize);
  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (currentPage - 1) * safePageSize;
  const items = sorted.slice(startIdx, startIdx + safePageSize);

  return {
    items,
    allFiltered: sorted,
    totalItems,
    totalPages,
    currentPage,
    pageSize: safePageSize,
    countsByVerdict,
    countsByCohort,
    countsByRegion,
  };
}

export interface DiffItemCountResolver {
  getUnacceptedHeaderCount: (item: ComparisonItem) => number;
  getUnacceptedCookieCount: (item: ComparisonItem) => number;
  hasActiveVisualDiff: (item: ComparisonItem) => boolean;
}

export interface FilterDiffItemsOptions {
  query?: string;
  dimension?: DiffDimensionFilter;
  sortBy?: 'id' | 'severity' | 'latency' | 'hops';
  selectedTestId?: string;
  page?: number;
  pageSize?: number;
}

export interface FilteredDiffItemsResult {
  items: ComparisonItem[];
  allFiltered: ComparisonItem[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  facetCounts: Record<DiffDimensionFilter, number>;
  activeIndexInFiltered: number;
  prevTestId: string | null;
  nextTestId: string | null;
}

export function filterAndPaginateDiffItems(
  items: ComparisonItem[],
  resolver: DiffItemCountResolver,
  options: FilterDiffItemsOptions = {}
): FilteredDiffItemsResult {
  const {
    query = '',
    dimension = 'all',
    sortBy = 'id',
    selectedTestId = '',
    page = 1,
    pageSize = 12,
  } = options;

  const q = query.trim().toLowerCase();

  const facetCounts: Record<DiffDimensionFilter, number> = {
    all: items.length,
    'any-diff': 0,
    headers: 0,
    cookies: 0,
    visual: 0,
    'multi-hop': 0,
    clean: 0,
  };

  for (const item of items) {
    const h = resolver.getUnacceptedHeaderCount(item);
    const c = resolver.getUnacceptedCookieCount(item);
    const v = resolver.hasActiveVisualDiff(item);
    const hops = item.candidateResult?.redirectChain?.length || 1;
    const anyDiff = h > 0 || c > 0 || v;
    if (anyDiff) facetCounts['any-diff']++;
    else facetCounts.clean++;
    if (h > 0) facetCounts.headers++;
    if (c > 0) facetCounts.cookies++;
    if (v) facetCounts.visual++;
    if (hops > 1) facetCounts['multi-hop']++;
  }

  const filtered = items.filter((item) => {
    const h = resolver.getUnacceptedHeaderCount(item);
    const c = resolver.getUnacceptedCookieCount(item);
    const v = resolver.hasActiveVisualDiff(item);
    const hops = item.candidateResult?.redirectChain?.length || 1;
    const anyDiff = h > 0 || c > 0 || v;

    if (dimension === 'any-diff' && !anyDiff) return false;
    if (dimension === 'headers' && h === 0) return false;
    if (dimension === 'cookies' && c === 0) return false;
    if (dimension === 'visual' && !v) return false;
    if (dimension === 'multi-hop' && hops <= 1) return false;
    if (dimension === 'clean' && anyDiff) return false;

    if (q) {
      const hay = [
        item.testId,
        item.testName,
        item.url,
        String(item.candidateResult?.actualStatus || ''),
        item.candidateResult?.edgeHostname || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'severity') {
      const aScore =
        resolver.getUnacceptedHeaderCount(a) * 100 +
        (resolver.hasActiveVisualDiff(a) ? 20 : 0) +
        resolver.getUnacceptedCookieCount(a) * 5;
      const bScore =
        resolver.getUnacceptedHeaderCount(b) * 100 +
        (resolver.hasActiveVisualDiff(b) ? 20 : 0) +
        resolver.getUnacceptedCookieCount(b) * 5;
      if (bScore !== aScore) return bScore - aScore;
    } else if (sortBy === 'latency') {
      const aMs = a.candidateResult?.durationMs || 0;
      const bMs = b.candidateResult?.durationMs || 0;
      if (bMs !== aMs) return bMs - aMs;
    } else if (sortBy === 'hops') {
      const aHops = a.candidateResult?.redirectChain?.length || 1;
      const bHops = b.candidateResult?.redirectChain?.length || 1;
      if (bHops !== aHops) return bHops - aHops;
    }
    return a.testId.localeCompare(b.testId, undefined, { numeric: true });
  });

  const activeIndexInFiltered = sorted.findIndex((i) => i.testId === selectedTestId);
  const prevTestId =
    activeIndexInFiltered > 0 ? sorted[activeIndexInFiltered - 1].testId : null;
  const nextTestId =
    activeIndexInFiltered >= 0 && activeIndexInFiltered < sorted.length - 1
      ? sorted[activeIndexInFiltered + 1].testId
      : null;

  const safePageSize = Math.max(1, pageSize);
  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (currentPage - 1) * safePageSize;
  const pageItems = sorted.slice(startIdx, startIdx + safePageSize);

  return {
    items: pageItems,
    allFiltered: sorted,
    totalItems,
    totalPages,
    currentPage,
    pageSize: safePageSize,
    facetCounts,
    activeIndexInFiltered,
    prevTestId,
    nextTestId,
  };
}

export interface SuiteCheckStatRow {
  tc: TestCaseDefinition;
  avgStg: number;
  avgPrd: number;
  minMs: number;
  maxMs: number;
  stgCacheable: string;
  prdCacheable: string;
  stgCacheStatus: string;
  prdCacheStatus: string;
  latestStg?: TestResult;
  latestPrd?: TestResult;
  diffInfo?: {
    hDiffs: number;
    cDiffs: number;
    vDiff: boolean;
    hasAny: boolean;
  };
}

export interface FilterSuiteStatsOptions {
  query?: string;
  facet?: SuiteFacetFilter;
  sortBy?: SuiteSortField;
  page?: number;
  pageSize?: number;
}

export interface FilteredSuiteStatsResult {
  items: SuiteCheckStatRow[];
  allFiltered: SuiteCheckStatRow[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  facetCounts: Record<SuiteFacetFilter, number>;
}

export function filterAndPaginateSuiteStats(
  rows: SuiteCheckStatRow[],
  options: FilterSuiteStatsOptions = {}
): FilteredSuiteStatsResult {
  const {
    query = '',
    facet = 'all',
    sortBy = 'id',
    page = 1,
    pageSize = 12,
  } = options;

  const q = query.trim().toLowerCase();

  const facetCounts: Record<SuiteFacetFilter, number> = {
    all: rows.length,
    drift: 0,
    redirects: 0,
    'cache-anomaly': 0,
    'visual-diff': 0,
    'multi-hop': 0,
  };

  for (const row of rows) {
    const cacheDrift = row.stgCacheable !== row.prdCacheable || row.stgCacheable === 'NO';
    const hasDrift = Boolean(row.diffInfo?.hasAny || cacheDrift);
    const expectedNum = Number(row.tc.expectedStatus) || 200;
    const isRedirect = expectedNum >= 300 && expectedNum < 400;
    const hops = row.latestStg?.redirectChain?.length || (isRedirect ? 3 : 1);

    if (hasDrift) facetCounts.drift++;
    if (isRedirect) facetCounts.redirects++;
    if (cacheDrift) facetCounts['cache-anomaly']++;
    if (row.diffInfo?.vDiff) facetCounts['visual-diff']++;
    if (hops > 1) facetCounts['multi-hop']++;
  }

  const filtered = rows.filter((row) => {
    const cacheDrift = row.stgCacheable !== row.prdCacheable || row.stgCacheable === 'NO';
    const hasDrift = Boolean(row.diffInfo?.hasAny || cacheDrift);
    const expectedNum = Number(row.tc.expectedStatus) || 200;
    const isRedirect = expectedNum >= 300 && expectedNum < 400;
    const hops = row.latestStg?.redirectChain?.length || (isRedirect ? 3 : 1);

    if (facet === 'drift' && !hasDrift) return false;
    if (facet === 'redirects' && !isRedirect) return false;
    if (facet === 'cache-anomaly' && !cacheDrift) return false;
    if (facet === 'visual-diff' && !row.diffInfo?.vDiff) return false;
    if (facet === 'multi-hop' && hops <= 1) return false;

    if (q) {
      const hay = [
        row.tc.id,
        row.tc.name,
        row.tc.path,
        row.tc.expectedStatus,
        row.stgCacheStatus,
        row.prdCacheStatus,
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'stg-desc') {
      if (b.avgStg !== a.avgStg) return b.avgStg - a.avgStg;
    } else if (sortBy === 'prd-desc') {
      if (b.avgPrd !== a.avgPrd) return b.avgPrd - a.avgPrd;
    } else if (sortBy === 'delta-desc') {
      const aDelta = Math.abs(a.avgStg - a.avgPrd);
      const bDelta = Math.abs(b.avgStg - b.avgPrd);
      if (bDelta !== aDelta) return bDelta - aDelta;
    } else if (sortBy === 'diffs-desc') {
      const aDiffs =
        (a.diffInfo?.hDiffs || 0) * 10 +
        (a.diffInfo?.cDiffs || 0) * 2 +
        (a.diffInfo?.vDiff ? 5 : 0);
      const bDiffs =
        (b.diffInfo?.hDiffs || 0) * 10 +
        (b.diffInfo?.cDiffs || 0) * 2 +
        (b.diffInfo?.vDiff ? 5 : 0);
      if (bDiffs !== aDiffs) return bDiffs - aDiffs;
    }
    return a.tc.id.localeCompare(b.tc.id, undefined, { numeric: true });
  });

  const safePageSize = Math.max(1, pageSize);
  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIdx = (currentPage - 1) * safePageSize;
  const items = sorted.slice(startIdx, startIdx + safePageSize);

  return {
    items,
    allFiltered: sorted,
    totalItems,
    totalPages,
    currentPage,
    pageSize: safePageSize,
    facetCounts,
  };
}

const ENTERPRISE_ROUTE_SEGMENTS = [
  { path: '/products/data-cloud', title: 'Data Cloud & Zero-Copy Federation', status: '200', category: 'Product' },
  { path: '/products/service-cloud', title: 'Service Cloud Autonomous Case Routing', status: '200', category: 'Product' },
  { path: '/products/commerce-cloud', title: 'B2B & D2C Commerce Edge Storefront', status: '301', category: 'Commerce' },
  { path: '/products/marketing-cloud', title: 'Marketing Cloud Personalization Beacon', status: '200', category: 'Marketing' },
  { path: '/products/mulesoft', title: 'MuleSoft Anypoint API Gateway Edge', status: '200', category: 'API Edge' },
  { path: '/products/tableau', title: 'Tableau Pulse Analytics Embed Gateway', status: '200', category: 'Analytics' },
  { path: '/products/slack', title: 'Slack AI Work Operating System Landing', status: '301', category: 'Collab' },
  { path: '/solutions/financial-services', title: 'Financial Services Cloud Compliance', status: '200', category: 'Industry' },
  { path: '/solutions/healthcare-life-sciences', title: 'Health Cloud HIPAA Edge Policy', status: '200', category: 'Industry' },
  { path: '/solutions/manufacturing', title: 'Manufacturing Cloud Partner Portal', status: '200', category: 'Industry' },
  { path: '/jp/products/agentforce', title: 'Japan PoP (NRT) Localized Agentforce Hub', status: '301', category: 'Regional PoP' },
  { path: '/de/editions-pricing', title: 'Germany PoP (FRA) GDPR Consent & Pricing', status: '200', category: 'Regional PoP' },
  { path: '/uk/customer-success', title: 'UK PoP (LHR) Enterprise Customer Stories', status: '200', category: 'Regional PoP' },
  { path: '/ap/events/world-tour', title: 'APAC PoP (SIN) Regional World Tour Registration', status: '301', category: 'Regional PoP' },
  { path: '/eu/trust-compliance', title: 'EMEA PoP (AMS) Sovereign Cloud Attestation', status: '200', category: 'Regional PoP' },
  { path: '/login/sso-preflight', title: 'Edge OIDC & SAML Auth Handshake Preflight', status: '200', category: 'Security' },
];

/**
 * Deterministically scales a property's test suite to `targetCount` checks (e.g., 64 checks)
 * so operators can stress-test UI scalability for large global suites.
 */
export function buildScaledTestSuite(
  baseSuite: TestCaseDefinition[],
  targetCount: number
): TestCaseDefinition[] {
  if (targetCount <= baseSuite.length) return baseSuite;
  const result: TestCaseDefinition[] = [...baseSuite];

  for (let i = baseSuite.length; i < targetCount; i++) {
    const num = i + 1;
    const id = `T${String(num).padStart(2, '0')}`;
    const seg = ENTERPRISE_ROUTE_SEGMENTS[(i - baseSuite.length) % ENTERPRISE_ROUTE_SEGMENTS.length];
    const tierSuffix = Math.floor((i - baseSuite.length) / ENTERPRISE_ROUTE_SEGMENTS.length) + 1;
    const urlPath =
      tierSuffix === 1 ? seg.path : `${seg.path}/shard-${tierSuffix}`;

    result.push({
      id,
      name:
        tierSuffix === 1
          ? seg.title
          : `${seg.title} (Shard #${tierSuffix})`,
      path: urlPath,
      expectedStatus: seg.status,
      category: seg.category,
      enabled: true,
    });
  }

  return result;
}
