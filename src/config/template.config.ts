/**
 * ============================================================================
 * AKAMAI / CDN SYNTHETIC RELEASE GATE — SINGLE-FILE TEMPLATE CONFIGURATION
 * ============================================================================
 * Configured for Salesforce Global Edge (salesforce.com) on AWS Account 373211957869.
 * Every UI screen, comparison rule, cURL generator, and MCP endpoint
 * automatically adapts to this configuration.
 * ============================================================================
 */

import { AppConfig } from '../engine/types';

export interface TestCaseDefinition {
  id: string;
  name: string;
  path: string;
  expectedStatus: string;
  category?: string;
  enabled?: boolean;
  visualGate?: boolean | string;
  critical?: boolean;
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
    dynamodbTable: string;
    mcpServerEndpoint: string;
    mcpEndpoint: string;
    mcpNpmPackage: string;
    openApiSpecPath: string;
    pragmaHeaders: string[];
    iamRoleArn: string;
    visualJudgeModel: string;
    visualJudgeProvider: string;
    bedrockModelArn: string;
  };
  properties: AppConfig[];
  testSuite: TestCaseDefinition[];
  readyReports: ReadyReportDefinition[];
}

export const DEFAULT_TEMPLATE_CONFIG: TemplateConfig = {
  branding: {
    logoMark: 'SF',
    controlPlaneTitle: 'Salesforce Edge Release Gate',
    productSubtitle:
      'Live HTTP Flow, Header, Set-Cookie & AWS Bedrock Nova Lite Visual Verification for salesforce.com',
    defaultDomain: 'salesforce.com',
    defaultOperator: {
      email: 'user-wmgspcbttqts@salesforce.com',
      role: 'Lead Edge Release Engineer',
      account: 'SFDC-EDGE-373211957869 (AWS 373211957869 · Akamai Prod + Staging)',
    },
    accountOptions: [
      'SFDC-EDGE-373211957869 (AWS 373211957869 · Akamai Prod + Staging)',
      'SFDC-TRAILHEAD-030771555103 (Trailhead & Developer Edge)',
      'SFDC-TRUST-GOV (Salesforce Trust & GovCloud Edge)',
    ],
  },

  networks: {
    staging: {
      id: 'staging',
      label: 'Akamai Staging Edge (.edgekey-staging.net)',
      shortLabel: 'staging',
      edgeSuffix: '.edgekey-staging.net',
      defaultEdgeIp: '23.48.201.18',
    },
    prod: {
      id: 'prod',
      label: 'Akamai Production Edge (.edgekey.net)',
      shortLabel: 'prod',
      edgeSuffix: '.edgekey.net',
      defaultEdgeIp: '23.212.251.15',
    },
  },

  infrastructure: {
    runnerEngine: 'AWS CloudWatch Synthetics (Playwright / Chromium)',
    runtimeVersion: 'syn-nodejs-puppeteer-9.1',
    awsRegion: 'us-east-1',
    availableRegions: [
      { id: 'us-east-1', label: 'us-east-1 (N. Virginia)' },
      { id: 'us-west-2', label: 'us-west-2 (Oregon)' },
      { id: 'eu-west-1', label: 'eu-west-1 (Ireland)' },
      { id: 'ap-northeast-1', label: 'ap-northeast-1 (Tokyo)' },
    ],
    s3Bucket: 's3://salesforce-akamai-synthetics-373211957869-us-east-1',
    dynamodbTable: 'salesforce-synthetics-gate-state',
    mcpServerEndpoint: '/api/v1/mcp/rpc',
    mcpEndpoint: '/api/v1/mcp/rpc',
    mcpNpmPackage: '@salesforce-edge/akamai-release-gate-mcp',
    openApiSpecPath: '/api/v1/openapi.json',
    pragmaHeaders: [
      'akamai-x-cache-on',
      'akamai-x-cache-remote-on',
      'akamai-x-check-cacheable',
      'akamai-x-get-cache-key',
      'akamai-x-get-true-cache-key',
      'akamai-x-get-request-id',
    ],
    iamRoleArn: 'arn:aws:iam::030771555103:role/AkamaiSyntheticsReleaseGateRole-prod-us-east-1',
    visualJudgeModel: 'amazon.nova-lite-v1:0',
    visualJudgeProvider: 'Amazon Bedrock (Nova Lite Multimodal)',
    bedrockModelArn:
      'arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-lite-v1:0',
  },

  properties: [
    {
      id: 'www',
      name: 'Salesforce Global Marketing & Digital Experience (www.salesforce.com)',
      suitePath: 'config/suites/www.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'www.salesforce.com': 'www.salesforce.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: { 'www.salesforce.com': 'www-uat1.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'login',
      name: 'Salesforce Core Identity & OAuth Gateway (login.salesforce.com)',
      suitePath: 'config/suites/login.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'login.salesforce.com': 'login.salesforce.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: { 'login.salesforce.com': 'test.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'developer',
      name: 'Salesforce Developers & API Portal (developer.salesforce.com)',
      suitePath: 'config/suites/developer.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'developer.salesforce.com': 'developer.salesforce.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: {
            'developer.salesforce.com': 'developer-uat.salesforce.com',
          },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'help',
      name: 'Salesforce Help & Customer Trailblazer Support (help.salesforce.com)',
      suitePath: 'config/suites/help.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'help.salesforce.com': 'help.salesforce.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: { 'help.salesforce.com': 'help-uat.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'trailhead',
      name: 'Salesforce Trailhead Learning & Certification (trailhead.salesforce.com)',
      suitePath: 'config/suites/trailhead.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'trailhead.salesforce.com': 'trailhead.salesforce.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: {
            'trailhead.salesforce.com': 'trailhead-uat.salesforce.com',
          },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'status',
      name: 'Salesforce Trust & Real-Time Cloud Status (status.salesforce.com)',
      suitePath: 'config/suites/status.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'status.salesforce.com': 'status.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'appexchange',
      name: 'Salesforce AppExchange Enterprise Marketplace (appexchange.salesforce.com)',
      suitePath: 'config/suites/appexchange.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: {
            'appexchange.salesforce.com': 'appexchange.salesforce.com',
          },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: {
            'appexchange.salesforce.com': 'appexchange-uat.salesforce.com',
          },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'partners',
      name: 'Salesforce Partner Community & Ecosystem (partners.salesforce.com)',
      suitePath: 'config/suites/partners.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'partners.salesforce.com': 'partners.salesforce.com' },
          networks: ['prod', 'staging'],
        },
        {
          id: 'uat',
          name: 'UAT',
          hostMap: {
            'partners.salesforce.com': 'partners-uat.salesforce.com',
          },
          networks: ['prod', 'staging'],
        },
      ],
    },
  ],

  testSuite: [
    {
      id: 'T01',
      name: 'Salesforce Global Home & Hero Experience',
      path: '/',
      expectedStatus: '200',
      category: 'Core Experience',
    },
    {
      id: 'T02',
      name: 'Sales Cloud & Agentforce Product Overview',
      path: '/sales/',
      expectedStatus: '200',
      category: 'Product Catalog',
    },
    {
      id: 'T03',
      name: 'Agentforce AI & Einstein Platform Landing',
      path: '/artificial-intelligence/',
      expectedStatus: '200',
      category: 'AI & Platform',
    },
    {
      id: 'T04',
      name: 'Legacy CRM Redirect Normalization (/crm -> /crm/)',
      path: '/crm',
      expectedStatus: '301',
      category: 'Edge Redirect',
    },
    {
      id: 'T05',
      name: 'Salesforce Free Trial & Lead Capture Flow',
      path: '/form/signup/freetrial-sales/',
      expectedStatus: '200',
      category: 'Conversion Flow',
    },
    {
      id: 'T06',
      name: 'Enterprise Editions & Pricing Matrix',
      path: '/editions-pricing/sales-cloud/',
      expectedStatus: '200',
      category: 'Commerce & Pricing',
    },
    {
      id: 'T07',
      name: 'Customer 360 & Small Business Solutions',
      path: '/small-business/',
      expectedStatus: '200',
      category: 'Solutions',
    },
    {
      id: 'T08',
      name: 'Company Overview & Global Trust Center Entry',
      path: '/company/',
      expectedStatus: '200',
      category: 'Trust & Corporate',
    },
  ],

  readyReports: [
    {
      id: 'RPT-101',
      title: 'PROD Edge Release Gate: www.salesforce.com (Staging vs Prod)',
      appId: 'www',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
      createdAt: '09:14 AM',
      by: 'aws-synthetics-canary',
    },
    {
      id: 'RPT-102',
      title: 'UAT vs PROD Environment Parity: www-uat1.salesforce.com',
      appId: 'www',
      candidateTarget: 'www.uat.staging',
      baselineTarget: 'www.prod.prod',
      createdAt: '08:50 AM',
      by: 'user-wmgspcbttqts@salesforce.com',
    },
    {
      id: 'RPT-103',
      title: 'Identity Gateway Gate: login.salesforce.com (Staging vs Prod)',
      appId: 'login',
      candidateTarget: 'login.prod.staging',
      baselineTarget: 'login.prod.prod',
      createdAt: '08:30 AM',
      by: 'aws-synthetics-canary',
    },
    {
      id: 'RPT-104',
      title: 'Developer Portal Gate: developer.salesforce.com (Staging vs Prod)',
      appId: 'developer',
      candidateTarget: 'developer.prod.staging',
      baselineTarget: 'developer.prod.prod',
      createdAt: '08:12 AM',
      by: 'user-wmgspcbttqts@salesforce.com',
    },
    {
      id: 'RPT-105',
      title: 'Help & Trailhead Edge Gate: help.salesforce.com (Staging vs Prod)',
      appId: 'help',
      candidateTarget: 'help.prod.staging',
      baselineTarget: 'help.prod.prod',
      createdAt: '07:55 AM',
      by: 'aws-synthetics-canary',
    },
  ],
};

/**
 * Helper to resolve hostname from property + environment using template config.
 */
export function resolvePropertyHostname(
  appId: string,
  envId: string,
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): string {
  const app = config.properties.find((p) => p.id === appId);
  const env = app?.envs.find((e) => e.id === envId);
  if (env && Object.values(env.hostMap)[0]) {
    return Object.values(env.hostMap)[0];
  }
  const suffix = envId === 'prod' ? '' : `-${envId}`;
  return `${appId}${suffix}.${config.branding.defaultDomain}`;
}

/**
 * Dedicated 8-Test Verification Suites for every Salesforce Property (www, login, developer, help, trailhead, status, appexchange, partners)
 */
export const PROPERTY_TEST_SUITES: Record<string, TestCaseDefinition[]> = {
  www: DEFAULT_TEMPLATE_CONFIG.testSuite,
  trailhead: [
    {
      id: 'T01',
      name: 'Trailhead Global Learning Home & Feed',
      path: '/',
      expectedStatus: '200',
      category: 'Learning Hub',
    },
    {
      id: 'T02',
      name: 'Agentforce Specialist Superbadge & Trails',
      path: '/en/credentials/agentforcespecialist',
      expectedStatus: '200',
      category: 'Certifications',
    },
    {
      id: 'T03',
      name: 'Trailhead Modules & AI Badges Catalog',
      path: '/en/modules',
      expectedStatus: '200',
      category: 'AI Skills',
    },
    {
      id: 'T04',
      name: 'Career Paths & Architect Credentials',
      path: '/en/career-paths',
      expectedStatus: '200',
      category: 'Career',
    },
    {
      id: 'T05',
      name: 'Trailblazer Community & Mentorship',
      path: '/en/community',
      expectedStatus: '200',
      category: 'Community',
    },
    {
      id: 'T06',
      name: 'Hands-On Orgs & Playground Manager',
      path: '/en/trailhead-playground',
      expectedStatus: '200',
      category: 'Hands-On',
    },
    {
      id: 'T07',
      name: 'Certifications & Verification Portal',
      path: '/en/credentials/administrator',
      expectedStatus: '200',
      category: 'Verification',
    },
    {
      id: 'T08',
      name: 'Salesforce Ranger Leaderboard & Ranks',
      path: '/en/ranks',
      expectedStatus: '200',
      category: 'Gamification',
    },
  ],
  login: [
    {
      id: 'T01',
      name: 'Salesforce Enterprise Sign-In Gateway',
      path: '/',
      expectedStatus: '200',
      category: 'Identity',
    },
    {
      id: 'T02',
      name: 'OAuth 2.0 PKCE Authorization Endpoint',
      path: '/services/oauth2/authorize',
      expectedStatus: '200',
      category: 'OAuth Protocol',
    },
    {
      id: 'T03',
      name: 'OIDC Discovery & Identity Configuration',
      path: '/.well-known/idp-configuration',
      expectedStatus: '200',
      category: 'OpenID Connect',
    },
    {
      id: 'T04',
      name: 'My Domain Discovery & Redirection',
      path: '/services/auth/idp',
      expectedStatus: '302',
      category: 'Edge Routing',
    },
    {
      id: 'T05',
      name: 'Multi-Factor Authentication (MFA) & FIDO2',
      path: '/setup/secur/mfa',
      expectedStatus: '200',
      category: 'Zero Trust',
    },
    {
      id: 'T06',
      name: 'Password Recovery & Security Verification',
      path: '/secur/forgotpassword.jsp',
      expectedStatus: '200',
      category: 'Account Recovery',
    },
    {
      id: 'T07',
      name: 'SAML Single Sign-On ACS Gateway',
      path: '/services/auth/sso',
      expectedStatus: '200',
      category: 'Enterprise Federation',
    },
    {
      id: 'T08',
      name: 'Identity Session Inspection & Health',
      path: '/id/health',
      expectedStatus: '200',
      category: 'Session Telemetry',
    },
  ],
  developer: [
    {
      id: 'T01',
      name: 'Salesforce Developers & Einstein 1 Hub',
      path: '/',
      expectedStatus: '200',
      category: 'Developer Hub',
    },
    {
      id: 'T02',
      name: 'REST & GraphQL API Reference Matrix',
      path: '/docs/apis',
      expectedStatus: '200',
      category: 'API Specs',
    },
    {
      id: 'T03',
      name: 'Lightning Web Components Playground',
      path: '/tools/lwc',
      expectedStatus: '200',
      category: 'Frontend SDK',
    },
    {
      id: 'T04',
      name: 'Apex Reference Guide & Syntax Tree',
      path: '/docs/atlas.en-us.apexref.meta/apexref/',
      expectedStatus: '200',
      category: 'Backend Language',
    },
    {
      id: 'T05',
      name: 'Agentforce Prompt & SDK CLI Tools',
      path: '/tools/vscode/agentforce',
      expectedStatus: '200',
      category: 'Autonomous AI',
    },
    {
      id: 'T06',
      name: 'Developer Edition Free Org Signup',
      path: '/signup',
      expectedStatus: '200',
      category: 'Sandbox Provisioning',
    },
    {
      id: 'T07',
      name: 'Data Cloud Ingestion SDK Reference',
      path: '/docs/atlas.en-us.c360a_api.meta',
      expectedStatus: '200',
      category: 'Zero-Copy Ingestion',
    },
    {
      id: 'T08',
      name: 'Developer Forums & Code Discussions',
      path: '/forums',
      expectedStatus: '200',
      category: 'Ecosystem',
    },
  ],
  help: [
    {
      id: 'T01',
      name: 'Salesforce Help & Agentforce Concierge',
      path: '/',
      expectedStatus: '200',
      category: 'Support Hub',
    },
    {
      id: 'T02',
      name: 'Knowledge Article Search & Docs',
      path: '/s/articleView',
      expectedStatus: '200',
      category: 'Knowledge Base',
    },
    {
      id: 'T03',
      name: 'Premier Support Case Management',
      path: '/s/cases',
      expectedStatus: '200',
      category: 'Case Management',
    },
    {
      id: 'T04',
      name: 'Spring ’26 Release Readiness Matrix',
      path: '/s/release-notes',
      expectedStatus: '200',
      category: 'Release Notes',
    },
    {
      id: 'T05',
      name: 'Trust & Known Issues Catalog',
      path: '/s/known-issues',
      expectedStatus: '200',
      category: 'Issue Tracking',
    },
    {
      id: 'T06',
      name: 'System Architecture & Implementation Guides',
      path: '/s/guides',
      expectedStatus: '200',
      category: 'Architecture',
    },
    {
      id: 'T07',
      name: 'Contact Support & Escalation Concierge',
      path: '/s/contactsupport',
      expectedStatus: '200',
      category: 'Escalations',
    },
    {
      id: 'T08',
      name: 'Customer Success Community Groups',
      path: '/s/groups',
      expectedStatus: '200',
      category: 'Best Practices',
    },
  ],
  status: [
    {
      id: 'T01',
      name: 'Trust Status Global System Overview',
      path: '/',
      expectedStatus: '200',
      category: 'Trust & Health',
    },
    {
      id: 'T02',
      name: 'Hyperforce NA & EMEA Core Instances',
      path: '/instances',
      expectedStatus: '200',
      category: 'Instance Status',
    },
    {
      id: 'T03',
      name: 'Live Maintenance Windows & Schedules',
      path: '/maintenance',
      expectedStatus: '200',
      category: 'Maintenance',
    },
    {
      id: 'T04',
      name: 'Security & Compliance Transparency Center',
      path: '/compliance',
      expectedStatus: '200',
      category: 'Compliance',
    },
    {
      id: 'T05',
      name: 'Real-Time Incident History & Post-Mortems',
      path: '/incidents',
      expectedStatus: '200',
      category: 'Incident Response',
    },
    {
      id: 'T06',
      name: 'API Status & Webhook Feeds',
      path: '/api/v1/status',
      expectedStatus: '200',
      category: 'Realtime Feeds',
    },
    {
      id: 'T07',
      name: 'Status Subscription & Alert Notification',
      path: '/subscribe',
      expectedStatus: '200',
      category: 'Alerting',
    },
    {
      id: 'T08',
      name: 'Anycast Edge Latency & PoP Telemetry',
      path: '/edge-telemetry',
      expectedStatus: '200',
      category: 'Network Telemetry',
    },
  ],
  appexchange: [
    {
      id: 'T01',
      name: 'AppExchange Enterprise Cloud Marketplace',
      path: '/',
      expectedStatus: '200',
      category: 'Marketplace Hub',
    },
    {
      id: 'T02',
      name: 'Agentforce Autonomous Apps & Agents',
      path: '/category/agentforce',
      expectedStatus: '200',
      category: 'AI Apps',
    },
    {
      id: 'T03',
      name: 'Top Enterprise CRM Integrations',
      path: '/top-apps',
      expectedStatus: '200',
      category: 'Popular Solutions',
    },
    {
      id: 'T04',
      name: 'Industry-Specific Solutions & Clouds',
      path: '/industries',
      expectedStatus: '200',
      category: 'Vertical Clouds',
    },
    {
      id: 'T05',
      name: 'Consulting Partners & SI Directory',
      path: '/consultants',
      expectedStatus: '200',
      category: 'System Integrators',
    },
    {
      id: 'T06',
      name: 'Security Review & App Verification',
      path: '/security-review',
      expectedStatus: '200',
      category: 'Security Audits',
    },
    {
      id: 'T07',
      name: 'Free Lightning Components & Actions',
      path: '/components',
      expectedStatus: '200',
      category: 'UI Components',
    },
    {
      id: 'T08',
      name: 'Publisher Portal & App Analytics',
      path: '/publishers',
      expectedStatus: '200',
      category: 'Partner Commerce',
    },
  ],
  partners: [
    {
      id: 'T01',
      name: 'Salesforce Partner Community Home',
      path: '/',
      expectedStatus: '200',
      category: 'Partner Portal',
    },
    {
      id: 'T02',
      name: 'Consulting Partner Program Tiering',
      path: '/program',
      expectedStatus: '200',
      category: 'Partner Tiers',
    },
    {
      id: 'T03',
      name: 'ISV AppExchange Partner Portal',
      path: '/isv',
      expectedStatus: '200',
      category: 'ISV Monetization',
    },
    {
      id: 'T04',
      name: 'Partner Learning Camp & Accreditations',
      path: '/learning',
      expectedStatus: '200',
      category: 'Accreditations',
    },
    {
      id: 'T05',
      name: 'Lead Registration & Deal Support',
      path: '/leads',
      expectedStatus: '200',
      category: 'Deal Registration',
    },
    {
      id: 'T06',
      name: 'Partner Navigator & Expertise Badges',
      path: '/navigator',
      expectedStatus: '200',
      category: 'Expertise Badges',
    },
    {
      id: 'T07',
      name: 'Marketing Co-Op & Asset Library',
      path: '/marketing',
      expectedStatus: '200',
      category: 'Marketing Assets',
    },
    {
      id: 'T08',
      name: 'Partner Operations & API Governance',
      path: '/governance',
      expectedStatus: '200',
      category: 'Operations',
    },
  ],
};

export function getPropertyTestSuite(
  propId: string,
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): TestCaseDefinition[] {
  return PROPERTY_TEST_SUITES[propId] || config.testSuite;
}
