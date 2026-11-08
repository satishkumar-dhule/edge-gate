/**
 * ============================================================================
 * SYNTHETIC RELEASE GATE — MASTER TEMPLATE CONFIGURATION
 * ============================================================================
 * Adapt this template to your organization by editing this single file
 * (or by using the live "Template Config" editor in the Settings screen).
 *
 * 1. `branding`       — Customize Control Plane title, logo mark, and SSO defaults
 * 2. `networks`       — Customize Staging & Production CDN edge suffixes / IPs
 * 3. `infrastructure` — Customize AWS CloudWatch Synthetics, S3, and MCP settings
 * 4. `properties`     — Define your applications (Properties) and environments
 * 5. `testSuite`      — Define the synthetic test URLs and expected statuses
 * ============================================================================
 */

import { AppConfig } from '../engine/types';

export interface TestCaseDefinition {
  id: string;
  name: string;
  path: string;
  expectedStatus: string;
  category?:
    | 'Edge Cache'
    | 'Auth & Session'
    | 'Visual Layout'
    | 'Redirect / Geo'
    | 'Commerce'
    | 'Health Probe';
  visualGate?: 'strict' | 'standard' | 'skip';
  domSelector?: string;
  requiredHeaders?: string[];
  requiredCookies?: string[];
  enabled?: boolean;
}

export interface ReadyReportDefinition {
  id: string;
  title: string;
  appId: string;
  candidateTarget: string;
  baselineTarget: string;
  candidateRunKey?: string;
  baselineRunKey?: string;
  createdAt: string;
  by: string;
}

export interface TemplateConfig {
  branding: {
    logoMark: string;
    controlPlaneTitle: string;
    productSubtitle: string;
    defaultDomain: string;
    defaultOperator: {
      email: string;
      role: string;
      account: string;
    };
    accountOptions: string[];
  };
  networks: {
    staging: {
      id: 'staging';
      label: string;
      shortLabel: string;
      edgeSuffix: string;
      defaultEdgeIp: string;
    };
    prod: {
      id: 'prod';
      label: string;
      shortLabel: string;
      edgeSuffix: string;
      defaultEdgeIp: string;
    };
  };
  infrastructure: {
    runnerEngine: string;
    runtimeVersion: string;
    awsRegion: string;
    availableRegions: { id: string; label: string }[];
    s3Bucket: string;
    mcpEndpoint: string;
    mcpNpmPackage: string;
    iamRoleArn: string;
    pragmaHeaders: string[];
    visualJudgeModel: string;
  };
  properties: AppConfig[];
  testSuite: TestCaseDefinition[];
  readyReports: ReadyReportDefinition[];
}

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  branding: {
    logoMark: 'A',
    controlPlaneTitle: 'Akamai Control Center',
    productSubtitle:
      'Synthetic Release Gate · AWS CloudWatch Synthetics & MCP Plane',
    defaultDomain: 'company.com',
    defaultOperator: {
      email: 'satishkumardhule@gmail.com',
      role: 'Principal Edge SRE',
      account: 'B-C-1AKAMAI-ENT (Enterprise Production)',
    },
    accountOptions: [
      'B-C-1AKAMAI-ENT (Enterprise Production)',
      'B-C-2COMMERCE-GLB (Global Commerce)',
      'B-C-3PLATFORM-CORE (Core Platform)',
    ],
  },

  networks: {
    staging: {
      id: 'staging',
      label: 'Akamai Staging Network (.edgekey-staging.net)',
      shortLabel: 'Staging',
      edgeSuffix: '.edgekey-staging.net',
      defaultEdgeIp: '23.56.128.45',
    },
    prod: {
      id: 'prod',
      label: 'Akamai Production Network (.edgekey.net)',
      shortLabel: 'Production',
      edgeSuffix: '.edgekey.net',
      defaultEdgeIp: '104.96.22.11',
    },
  },

  infrastructure: {
    runnerEngine: 'AWS CloudWatch Synthetics',
    runtimeVersion: 'syn-playwright-chromium-v2.4',
    awsRegion: 'us-east-1',
    availableRegions: [
      { id: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
      { id: 'us-west-2', label: 'us-west-2 (Oregon)' },
      { id: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
      { id: 'ap-southeast-1', label: 'ap-southeast-1 (Singapore)' },
    ],
    s3Bucket: 's3://akamai-synthetics-gate-prod',
    mcpEndpoint: 'mcp://akamai-synthetics-gate/v1',
    mcpNpmPackage: '@company/akamai-synthetics-mcp-server',
    iamRoleArn: 'arn:aws:iam::582036321695:role/AkamaiSyntheticsMcpRole',
    pragmaHeaders: [
      'akamai-x-cache-on',
      'akamai-x-cache-remote-on',
      'akamai-x-check-cacheable',
      'akamai-x-get-cache-key',
      'akamai-x-get-true-cache-key',
      'akamai-x-get-request-id',
    ],
    visualJudgeModel: 'gemini-2.5-flash-vision',
  },

  properties: [
    {
      id: 'www',
      name: 'Main Public Portal',
      suitePath: 'config/suites/www.csv',
      defaultNetworks: ['prod', 'staging'],
      headers: { 'x-portal-team': 'edge-release-eng' },
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: {
            'www.company.com': 'www.company.com',
            'assets.company.com': 'assets.company.com',
          },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: {
            'www.company.com': 'uat-www.company.com',
            'assets.company.com': 'uat-assets.company.com',
          },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'store',
      name: 'E-Commerce Storefront',
      suitePath: 'config/suites/store.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: { 'store.company.com': 'store.company.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: { 'store.company.com': 'uat-store.company.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'help',
      name: 'Help & Docs Center',
      suitePath: 'config/suites/help.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: { 'help.company.com': 'help.company.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'checkout',
      name: 'Global Checkout & Payments',
      suitePath: 'config/suites/checkout.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: { 'checkout.company.com': 'checkout.company.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: { 'checkout.company.com': 'uat-checkout.company.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'api',
      name: 'Edge GraphQL & REST Gateway',
      suitePath: 'config/suites/api.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: { 'api.company.com': 'api.company.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: { 'api.company.com': 'uat-api.company.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'auth',
      name: 'Identity & SSO Edge Broker',
      suitePath: 'config/suites/auth.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: { 'auth.company.com': 'auth.company.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'developer',
      name: 'Developer Hub & API Reference',
      suitePath: 'config/suites/developer.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: { 'developer.company.com': 'developer.company.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'partners',
      name: 'Partner Portal & Rebates',
      suitePath: 'config/suites/partners.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'Production',
          hostMap: { 'partners.company.com': 'partners.company.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
  ],

  testSuite: [
    {
      id: 'T01',
      name: 'Homepage Root & Edge Cache',
      path: '/',
      expectedStatus: '200',
      category: 'Edge Cache',
      visualGate: 'standard',
      domSelector: 'main h1, [data-edge-hero]',
      requiredHeaders: ['cache-control', 'x-check-cacheable', 'x-cache'],
      requiredCookies: ['ak_bmsc', 'edge_region'],
      enabled: true,
    },
    {
      id: 'T02',
      name: 'Product Catalog & Session Cookie',
      path: '/products',
      expectedStatus: '200',
      category: 'Commerce',
      visualGate: 'standard',
      domSelector: '#product-catalog-grid',
      requiredHeaders: ['cache-control', 'content-type'],
      requiredCookies: ['ak_bmsc', 'edge_region', 'session_tier'],
      enabled: true,
    },
    {
      id: 'T03',
      name: 'Enterprise Solutions Hero Layout',
      path: '/solutions/enterprise',
      expectedStatus: '200',
      category: 'Visual Layout',
      visualGate: 'strict',
      domSelector: 'section.enterprise-hero, .cta-primary',
      requiredHeaders: ['cache-control', 'x-check-cacheable'],
      requiredCookies: ['ak_bmsc'],
      enabled: true,
    },
    {
      id: 'T04',
      name: 'Global Geo Redirect (/global)',
      path: '/global',
      expectedStatus: '301',
      category: 'Redirect / Geo',
      visualGate: 'skip',
      domSelector: 'N/A (301 Edge Redirect)',
      requiredHeaders: ['location', 'x-cache'],
      requiredCookies: ['edge_region'],
      enabled: true,
    },
    {
      id: 'T05',
      name: 'Authentication Sign-In Portal',
      path: '/login',
      expectedStatus: '200',
      category: 'Auth & Session',
      visualGate: 'strict',
      domSelector: 'form#sso-login, input[name="email"]',
      requiredHeaders: ['cache-control', 'x-akamai-request-id'],
      requiredCookies: ['ak_bmsc', 'session_tier'],
      enabled: true,
    },
    {
      id: 'T06',
      name: 'Customer Case Studies Feed',
      path: '/customers/stories',
      expectedStatus: '200',
      category: 'Edge Cache',
      visualGate: 'standard',
      domSelector: 'article.case-study-card',
      requiredHeaders: ['cache-control', 'x-check-cacheable', 'x-cache'],
      requiredCookies: ['ak_bmsc'],
      enabled: true,
    },
    {
      id: 'T07',
      name: 'Pricing & Tier Calculator',
      path: '/pricing',
      expectedStatus: '200',
      category: 'Commerce',
      visualGate: 'strict',
      domSelector: '#pricing-matrix, [data-tier-toggle]',
      requiredHeaders: ['cache-control', 'content-type'],
      requiredCookies: ['ak_bmsc', 'edge_region'],
      enabled: true,
    },
    {
      id: 'T08',
      name: 'Edge Health Check Probe',
      path: '/healthz',
      expectedStatus: '200',
      category: 'Health Probe',
      visualGate: 'skip',
      domSelector: 'pre#health-json',
      requiredHeaders: ['x-akamai-request-id', 'cache-control'],
      requiredCookies: [],
      enabled: true,
    },
  ],

  readyReports: [
    {
      id: 'RPT-104',
      title: 'PROD Release Gate: Akamai Staging vs Akamai Production',
      appId: 'www',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
      createdAt: '08:30 AM',
      by: 'aws-synthetics-canary',
    },
    {
      id: 'RPT-103',
      title: 'UAT Validation: Akamai Staging vs Akamai Production',
      appId: 'www',
      candidateTarget: 'www.uat.staging',
      baselineTarget: 'www.uat.prod',
      createdAt: '08:15 AM',
      by: 'aws-synthetics-canary',
    },
    {
      id: 'RPT-102',
      title: 'Cross-Env Drift Check: UAT Staging vs PROD Production',
      appId: 'www',
      candidateTarget: 'www.uat.staging',
      baselineTarget: 'www.prod.prod',
      createdAt: '07:50 AM',
      by: 'mcp-agent',
    },
    {
      id: 'RPT-101',
      title: 'Storefront Release Gate: PROD Staging vs PROD Production',
      appId: 'store',
      candidateTarget: 'store.prod.staging',
      baselineTarget: 'store.prod.prod',
      createdAt: '07:30 AM',
      by: 'aws-synthetics-canary',
    },
  ],
};

/**
 * Helper to resolve hostname for any (appId, envId) pair using template config.
 */
export function resolvePropertyHostname(
  appId: string,
  envId: string,
  domain = DEFAULT_TEMPLATE_CONFIG.branding.defaultDomain
): string {
  const prefix = envId === 'prod' ? appId : `${envId}-${appId}`;
  return `${prefix}.${domain}`;
}
