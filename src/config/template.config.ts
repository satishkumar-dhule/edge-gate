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
      email: 'user-tcchhlxprfng@salesforce.com',
      role: 'Lead Edge Release Engineer',
      account: 'SFDC-EDGE-735234585484 (AWS 735234585484 · Akamai Prod + Staging)',
    },
    accountOptions: [
      'SFDC-EDGE-735234585484 (AWS 735234585484 · Akamai Prod + Staging)',
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
    s3Bucket: 's3://salesforce-akamai-synthetics-735234585484-us-east-1',
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
    {
      id: 'apac',
      name: 'Salesforce Asia-Pacific Regional Hub (www.salesforce.com/ap/ · SIN Edge PoP)',
      suitePath: 'config/suites/apac.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'apac.salesforce.com': 'www.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'emea',
      name: 'Salesforce EMEA Regional Hub (www.salesforce.com/eu/ · AMS Edge PoP)',
      suitePath: 'config/suites/emea.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'emea.salesforce.com': 'www.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'americas',
      name: 'Salesforce Americas Regional Hub (www.salesforce.com/mx/ · /br/ · /ca/ · GRU Edge PoP)',
      suitePath: 'config/suites/americas.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'americas.salesforce.com': 'www.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'japan',
      name: 'Salesforce Japan Regional Hub (www.salesforce.com/jp/ · Tokyo NRT Edge PoP)',
      suitePath: 'config/suites/japan.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'japan.salesforce.com': 'www.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'uk',
      name: 'Salesforce United Kingdom Regional Hub (www.salesforce.com/uk/ · London LHR Edge PoP)',
      suitePath: 'config/suites/uk.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'uk.salesforce.com': 'www.salesforce.com' },
          networks: ['prod', 'staging'],
        },
      ],
    },
    {
      id: 'germany',
      name: 'Salesforce Deutschland DACH Regional Hub (www.salesforce.com/de/ · Frankfurt FRA Edge PoP)',
      suitePath: 'config/suites/germany.csv',
      defaultNetworks: ['prod', 'staging'],
      envs: [
        {
          id: 'prod',
          name: 'PROD',
          hostMap: { 'germany.salesforce.com': 'www.salesforce.com' },
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
      id: 'LIVE-WWW-PROD',
      title: 'PROD Edge Release Gate: www.salesforce.com (Staging vs Prod)',
      appId: 'www',
      candidateTarget: 'www.prod.staging',
      baselineTarget: 'www.prod.prod',
      createdAt: '09:14 UTC',
      by: 'aws-synthetics-canary',
    },
    {
      id: 'LIVE-JAPAN-PROD',
      title: 'Japan Regional PoP Gate: www.salesforce.com/jp (Tokyo NRT Edge)',
      appId: 'japan',
      candidateTarget: 'japan.prod.staging',
      baselineTarget: 'japan.prod.prod',
      createdAt: '09:10 UTC',
      by: 'aws-lambda-adhoc',
    },
    {
      id: 'LIVE-GERMANY-PROD',
      title: 'Germany Regional PoP Gate: www.salesforce.com/de (Frankfurt FRA Edge)',
      appId: 'germany',
      candidateTarget: 'germany.prod.staging',
      baselineTarget: 'germany.prod.prod',
      createdAt: '09:05 UTC',
      by: 'aws-lambda-adhoc',
    },
    {
      id: 'LIVE-LOGIN-PROD',
      title: 'Identity Gateway Gate: login.salesforce.com (Staging vs Prod)',
      appId: 'login',
      candidateTarget: 'login.prod.staging',
      baselineTarget: 'login.prod.prod',
      createdAt: '08:45 UTC',
      by: 'aws-synthetics-canary',
    },
    {
      id: 'LIVE-DEV-PROD',
      title: 'Developer Portal Gate: developer.salesforce.com (Staging vs Prod)',
      appId: 'developer',
      candidateTarget: 'developer.prod.staging',
      baselineTarget: 'developer.prod.prod',
      createdAt: '08:12 UTC',
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
      path: '/s/',
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
  apac: [
    { id: 'T01', name: 'Salesforce APAC Regional Home (Singapore / ASEAN)', path: '/ap/', expectedStatus: '200', category: 'APAC Home' },
    { id: 'T02', name: 'APAC Sales Cloud & Agentforce Overview', path: '/ap/sales/', expectedStatus: '200', category: 'APAC Sales' },
    { id: 'T03', name: 'APAC Agentforce AI & Autonomous Agents', path: '/ap/artificial-intelligence/', expectedStatus: '200', category: 'APAC AI' },
    { id: 'T04', name: 'APAC Customer Success Stories & Trailblazers', path: '/ap/customer-stories/', expectedStatus: '200', category: 'APAC Success' },
    { id: 'T05', name: 'Salesforce Australia & New Zealand (ANZ) Hub', path: '/au/', expectedStatus: '200', category: 'ANZ Hub' },
    { id: 'T06', name: 'Salesforce India Regional Experience (/in/)', path: '/in/', expectedStatus: '200', category: 'India Hub' },
    { id: 'T07', name: 'APAC CRM Platform & Customer 360 Guide', path: '/ap/crm/', expectedStatus: '200', category: 'APAC CRM' },
    { id: 'T08', name: 'APAC Corporate Overview & Our Story', path: '/ap/company/our-story/', expectedStatus: '200', category: 'APAC Trust' },
  ],
  emea: [
    { id: 'T01', name: 'Salesforce EMEA Pan-European Home (/eu/)', path: '/eu/', expectedStatus: '200', category: 'EMEA Home' },
    { id: 'T02', name: 'EMEA Sales Cloud & Revenue Intelligence', path: '/eu/sales/', expectedStatus: '200', category: 'EMEA Sales' },
    { id: 'T03', name: 'EMEA Agentforce AI & GDPR-Compliant Copilot', path: '/eu/artificial-intelligence/', expectedStatus: '200', category: 'EMEA AI' },
    { id: 'T04', name: 'Salesforce France (Français) Regional Hub (/fr/)', path: '/fr/', expectedStatus: '200', category: 'France Hub' },
    { id: 'T05', name: 'Salesforce España (Español) Regional Hub (/es/)', path: '/es/', expectedStatus: '200', category: 'Spain Hub' },
    { id: 'T06', name: 'Salesforce Italia (Italiano) Regional Hub (/it/)', path: '/it/', expectedStatus: '200', category: 'Italy Hub' },
    { id: 'T07', name: 'Salesforce Nederland (Benelux) Regional Hub (/nl/)', path: '/nl/', expectedStatus: '200', category: 'Benelux Hub' },
    { id: 'T08', name: 'EMEA Corporate Overview & Trust Story', path: '/eu/company/our-story/', expectedStatus: '200', category: 'EMEA Trust' },
  ],
  americas: [
    { id: 'T01', name: 'Salesforce Latin America (México · Español) Home', path: '/mx/', expectedStatus: '200', category: 'LATAM Home' },
    { id: 'T02', name: 'LATAM Sales Cloud & Agentforce (Español)', path: '/mx/sales/', expectedStatus: '200', category: 'LATAM Sales' },
    { id: 'T03', name: 'Salesforce Brasil (Português) Regional Home', path: '/br/', expectedStatus: '200', category: 'Brazil Home' },
    { id: 'T04', name: 'Brasil Sales Cloud & CRM (Português)', path: '/br/sales/', expectedStatus: '200', category: 'Brazil Sales' },
    { id: 'T05', name: 'Salesforce Canada (English) Regional Home', path: '/ca/', expectedStatus: '200', category: 'Canada EN' },
    { id: 'T06', name: 'Salesforce Canada (Français) Regional Home', path: '/fr-ca/', expectedStatus: '200', category: 'Canada FR' },
    { id: 'T07', name: 'LATAM ¿Qué es CRM? Customer 360 (Español)', path: '/mx/crm/', expectedStatus: '200', category: 'LATAM CRM' },
    { id: 'T08', name: 'Brasil O que é CRM? Customer 360 (Português)', path: '/br/crm/', expectedStatus: '200', category: 'Brazil CRM' },
  ],
  japan: [
    { id: 'T01', name: 'Salesforce Japan Home (株式会社セールスフォース・ジャパン)', path: '/jp/', expectedStatus: '200', category: 'Japan Home' },
    { id: 'T02', name: 'Sales Cloud 営業支援・SFA/CRM (セールスフォース・ジャパン)', path: '/jp/sales/', expectedStatus: '200', category: 'Japan Sales' },
    { id: 'T03', name: 'Agentforce AI & 自律型AIエージェント (/jp/artificial-intelligence/)', path: '/jp/artificial-intelligence/', expectedStatus: '200', category: 'Japan AI' },
    { id: 'T04', name: '日本のお客様導入事例190選 (Japan Customer Stories)', path: '/jp/customer-stories/', expectedStatus: '200', category: 'Japan Success' },
    { id: 'T05', name: 'CRMとは？ 顧客管理システム (What is CRM Japan)', path: '/jp/crm/', expectedStatus: '200', category: 'Japan CRM' },
    { id: 'T06', name: 'Sales Cloud 価格・エディション比較 (Japan Pricing)', path: '/jp/sales/pricing/', expectedStatus: '200', category: 'Japan Pricing' },
    { id: 'T07', name: 'Service Cloud カスタマーサービス支援 (/jp/service/)', path: '/jp/service/', expectedStatus: '200', category: 'Japan Service' },
    { id: 'T08', name: 'セールスフォース・ジャパン 企業情報 (Japan Our Story)', path: '/jp/company/our-story/', expectedStatus: '200', category: 'Japan Corporate' },
  ],
  uk: [
    { id: 'T01', name: 'Salesforce United Kingdom & Ireland Home (/uk/)', path: '/uk/', expectedStatus: '200', category: 'UK Home' },
    { id: 'T02', name: 'UK Sales Cloud & Agentforce Revenue Platform', path: '/uk/sales/', expectedStatus: '200', category: 'UK Sales' },
    { id: 'T03', name: 'UK Agentforce AI & Autonomous Enterprise Agents', path: '/uk/artificial-intelligence/', expectedStatus: '200', category: 'UK AI' },
    { id: 'T04', name: 'UK Customer Success Stories & Case Studies', path: '/uk/customer-stories/', expectedStatus: '200', category: 'UK Success' },
    { id: 'T05', name: 'UK What is CRM? Customer 360 Architecture', path: '/uk/crm/', expectedStatus: '200', category: 'UK CRM' },
    { id: 'T06', name: 'UK Sales Cloud Pricing & GBP Editions', path: '/uk/sales/pricing/', expectedStatus: '200', category: 'UK Pricing' },
    { id: 'T07', name: 'UK Service Cloud & Contact Centre AI', path: '/uk/service/', expectedStatus: '200', category: 'UK Service' },
    { id: 'T08', name: 'Salesforce UK Corporate Overview & Our Story', path: '/uk/company/our-story/', expectedStatus: '200', category: 'UK Corporate' },
  ],
  germany: [
    { id: 'T01', name: 'Salesforce Deutschland (DACH) Startseite (/de/)', path: '/de/', expectedStatus: '200', category: 'DACH Home' },
    { id: 'T02', name: 'Deutschland Sales Cloud & Vertriebssoftware (/de/sales/)', path: '/de/sales/', expectedStatus: '200', category: 'DACH Sales' },
    { id: 'T03', name: 'Agentforce KI & Autonome KI-Agenten (/de/artificial-intelligence/)', path: '/de/artificial-intelligence/', expectedStatus: '200', category: 'DACH AI' },
    { id: 'T04', name: 'Deutschland Kundenreferenzen & Erfolgsgeschichten', path: '/de/customer-stories/', expectedStatus: '200', category: 'DACH Success' },
    { id: 'T05', name: 'Was ist CRM? Kundenbeziehungsmanagement (/de/crm/)', path: '/de/crm/', expectedStatus: '200', category: 'DACH CRM' },
    { id: 'T06', name: 'Deutschland Sales Cloud Preise & Editionen (EUR)', path: '/de/sales/pricing/', expectedStatus: '200', category: 'DACH Pricing' },
    { id: 'T07', name: 'Deutschland Service Cloud & Kundenservice (/de/service/)', path: '/de/service/', expectedStatus: '200', category: 'DACH Service' },
    { id: 'T08', name: 'Über Salesforce Deutschland & Unsere Geschichte', path: '/de/company/our-story/', expectedStatus: '200', category: 'DACH Corporate' },
  ],
};

export interface RegionalEdgeNodeConfig {
  appId: string;
  regionCode: string;
  regionLabel: string;
  stagingPopCode: string;
  prodPopCode: string;
  stagingEdgeIp: string;
  prodEdgeIp: string;
  stagingEdgeHost: string;
  prodEdgeHost: string;
  acceptLanguage: string;
  contentLanguage: string;
  locale: string;
  countryCode: string;
  city: string;
  edgescapeHeader: string;
  regionalCookieHeader: string;
  proriginCode: string;
}

export const REGIONAL_EDGE_NODES: Record<string, RegionalEdgeNodeConfig> = {
  www: {
    appId: 'www',
    regionCode: 'NA-ASHBURN',
    regionLabel: 'Ashburn, Virginia (Akamai IAD Global Edge PoP)',
    stagingPopCode: 'IAD-STG-04',
    prodPopCode: 'IAD-PRD-12',
    stagingEdgeIp: '23.48.201.18',
    prodEdgeIp: '23.212.251.15',
    stagingEdgeHost: 'a23-48-201-18.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-212-251-15.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-US,en;q=0.9',
    contentLanguage: 'en-US',
    locale: 'en-US',
    countryCode: 'US',
    city: 'ASHBURN',
    edgescapeHeader:
      'georegion=263,country_code=US,region_code=VA,city=ASHBURN,lat=39.04,long=-77.49,timezone=EST,continent=NA',
    regionalCookieHeader:
      'prorigin=US1; AKA_A2=US; ak_loc=cc:US,ct:ASHBURN,st:VA; sfdc_locale=en_US',
    proriginCode: 'US1',
  },
  japan: {
    appId: 'japan',
    regionCode: 'JP-TOKYO',
    regionLabel: 'Tokyo, Japan (Akamai NRT Edge PoP · ap-northeast-1)',
    stagingPopCode: 'NRT-STG-01',
    prodPopCode: 'NRT-PRD-08',
    stagingEdgeIp: '23.54.18.92',
    prodEdgeIp: '104.97.84.21',
    stagingEdgeHost: 'a23-54-18-92.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a104-97-84-21.deploy.akamaitechnologies.com',
    acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.4',
    contentLanguage: 'ja-JP',
    locale: 'ja-JP',
    countryCode: 'JP',
    city: 'TOKYO',
    edgescapeHeader:
      'georegion=119,country_code=JP,city=TOKYO,lat=35.69,long=139.69,timezone=GMT+9,continent=AS',
    regionalCookieHeader:
      'prorigin=JP1; AKA_A2=JP; ak_loc=cc:JP,ct:TOKYO; sfdc_locale=ja_JP',
    proriginCode: 'JP1',
  },
  germany: {
    appId: 'germany',
    regionCode: 'DE-FRANKFURT',
    regionLabel: 'Frankfurt, Germany (Akamai FRA Edge PoP · eu-central-1)',
    stagingPopCode: 'FRA-STG-01',
    prodPopCode: 'FRA-PRD-06',
    stagingEdgeIp: '2.16.106.34',
    prodEdgeIp: '2.17.196.18',
    stagingEdgeHost: 'a2-16-106-34.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a2-17-196-18.deploy.akamaitechnologies.com',
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.4',
    contentLanguage: 'de-DE',
    locale: 'de-DE',
    countryCode: 'DE',
    city: 'FRANKFURT',
    edgescapeHeader:
      'georegion=61,country_code=DE,city=FRANKFURT,lat=50.11,long=8.68,timezone=GMT+1,continent=EU',
    regionalCookieHeader:
      'prorigin=DE1; AKA_A2=DE; ak_loc=cc:DE,ct:FRANKFURT; sfdc_locale=de_DE',
    proriginCode: 'DE1',
  },
  uk: {
    appId: 'uk',
    regionCode: 'UK-LONDON',
    regionLabel: 'London, United Kingdom (Akamai LHR Edge PoP · eu-west-2)',
    stagingPopCode: 'LHR-STG-02',
    prodPopCode: 'LHR-PRD-07',
    stagingEdgeIp: '2.21.34.72',
    prodEdgeIp: '23.50.11.40',
    stagingEdgeHost: 'a2-21-34-72.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-50-11-40.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-GB,en;q=0.9',
    contentLanguage: 'en-GB',
    locale: 'en-GB',
    countryCode: 'GB',
    city: 'LONDON',
    edgescapeHeader:
      'georegion=242,country_code=GB,city=LONDON,lat=51.51,long=-0.13,timezone=GMT,continent=EU',
    regionalCookieHeader:
      'prorigin=UK1; AKA_A2=GB; ak_loc=cc:GB,ct:LONDON; sfdc_locale=en_GB',
    proriginCode: 'UK1',
  },
  apac: {
    appId: 'apac',
    regionCode: 'APAC-SINGAPORE',
    regionLabel: 'Singapore / Sydney (Akamai SIN-SYD Edge PoP · ap-southeast-1)',
    stagingPopCode: 'SIN-STG-02',
    prodPopCode: 'SIN-PRD-09',
    stagingEdgeIp: '23.216.148.44',
    prodEdgeIp: '23.62.14.88',
    stagingEdgeHost: 'a23-216-148-44.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-62-14-88.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-SG,en-AU,en-IN,en;q=0.9',
    contentLanguage: 'en-SG',
    locale: 'en-SG',
    countryCode: 'SG',
    city: 'SINGAPORE',
    edgescapeHeader:
      'georegion=214,country_code=SG,city=SINGAPORE,lat=1.29,long=103.85,timezone=GMT+8,continent=AS',
    regionalCookieHeader:
      'prorigin=AP1; AKA_A2=SG; ak_loc=cc:SG,ct:SINGAPORE; sfdc_locale=en_AP',
    proriginCode: 'AP1',
  },
  emea: {
    appId: 'emea',
    regionCode: 'EMEA-AMSTERDAM',
    regionLabel: 'Amsterdam / Paris / Madrid (Akamai AMS-PAR Edge PoP · eu-west-1)',
    stagingPopCode: 'AMS-STG-03',
    prodPopCode: 'AMS-PRD-11',
    stagingEdgeIp: '2.18.64.112',
    prodEdgeIp: '2.19.120.55',
    stagingEdgeHost: 'a2-18-64-112.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a2-19-120-55.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-GB,fr-FR,es-ES,it-IT,nl-NL;q=0.9',
    contentLanguage: 'fr-FR',
    locale: 'fr-FR',
    countryCode: 'NL',
    city: 'AMSTERDAM',
    edgescapeHeader:
      'georegion=166,country_code=NL,city=AMSTERDAM,lat=52.37,long=4.89,timezone=GMT+1,continent=EU',
    regionalCookieHeader:
      'prorigin=EU1; AKA_A2=NL; ak_loc=cc:NL,ct:AMSTERDAM; sfdc_locale=en_EU',
    proriginCode: 'EU1',
  },
  americas: {
    appId: 'americas',
    regionCode: 'AMER-SAOPAULO',
    regionLabel: 'São Paulo / Mexico City / Toronto (Akamai GRU-MEX-YYZ Edge PoP · sa-east-1)',
    stagingPopCode: 'GRU-STG-02',
    prodPopCode: 'GRU-PRD-05',
    stagingEdgeIp: '23.44.82.19',
    prodEdgeIp: '23.204.60.12',
    stagingEdgeHost: 'a23-44-82-19.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-204-60-12.deploy.akamaitechnologies.com',
    acceptLanguage: 'es-MX,pt-BR,en-CA,fr-CA,en;q=0.9',
    contentLanguage: 'es-MX',
    locale: 'es-MX',
    countryCode: 'MX',
    city: 'MEXICOCITY',
    edgescapeHeader:
      'georegion=154,country_code=MX,city=MEXICOCITY,lat=19.43,long=-99.13,timezone=GMT-6,continent=NA',
    regionalCookieHeader:
      'prorigin=LA1; AKA_A2=MX; ak_loc=cc:MX,ct:MEXICOCITY; sfdc_locale=es_MX',
    proriginCode: 'LA1',
  },
};

/**
 * Infers the canonical Salesforce property ID (`japan`, `germany`, `uk`, `apac`, `emea`, `americas`, `www`, `login`, etc.)
 * from a URL path/hostname or explicit appId.
 */
export function inferPropertyIdFromUrl(
  url: string = '',
  explicitAppId?: string
): string {
  if (explicitAppId && PROPERTY_TEST_SUITES[explicitAppId]) {
    return explicitAppId;
  }
  const lower = (url || '').toLowerCase();
  if (lower.includes('login.salesforce.com') || lower.includes('test.salesforce.com')) return 'login';
  if (lower.includes('developer.salesforce.com') || lower.includes('developer-uat.salesforce.com')) return 'developer';
  if (lower.includes('help.salesforce.com') || lower.includes('help-uat.salesforce.com')) return 'help';
  if (lower.includes('trailhead.salesforce.com') || lower.includes('trailhead-uat.salesforce.com')) return 'trailhead';
  if (lower.includes('status.salesforce.com')) return 'status';
  if (lower.includes('appexchange.salesforce.com') || lower.includes('appexchange-uat.salesforce.com')) return 'appexchange';
  if (lower.includes('partners.salesforce.com') || lower.includes('partners-uat.salesforce.com')) return 'partners';

  // Regional path prefixes on www.salesforce.com
  if (/\/(jp)(\/|\?|$)/.test(lower) || lower.includes('japan.salesforce.com')) return 'japan';
  if (/\/(de)(\/|\?|$)/.test(lower) || lower.includes('germany.salesforce.com')) return 'germany';
  if (/\/(uk)(\/|\?|$)/.test(lower) || lower.includes('uk.salesforce.com')) return 'uk';
  if (/\/(ap|apac|au|in|sg|kr)(\/|\?|$)/.test(lower) || lower.includes('apac.salesforce.com')) return 'apac';
  if (/\/(eu|emea|fr|es|it|nl|se)(\/|\?|$)/.test(lower) || lower.includes('emea.salesforce.com')) return 'emea';
  if (/\/(americas|mx|br|ca|fr-ca|en-ca)(\/|\?|$)/.test(lower) || lower.includes('americas.salesforce.com')) return 'americas';

  return explicitAppId || 'www';
}

/**
 * Resolves the Region-Specific Akamai Edge Node (PoP, Staging/Prod Edge IPs,
 * Accept-Language, Akamai Edgescape Geo Header, and Regional Origin Cookie)
 * for any Salesforce property or URL.
 */
export function resolveRegionalEdgeNode(
  appId?: string,
  url?: string
): RegionalEdgeNodeConfig {
  const resolvedAppId = inferPropertyIdFromUrl(url || '', appId);
  return REGIONAL_EDGE_NODES[resolvedAppId] || REGIONAL_EDGE_NODES.www;
}

export function getPropertyTestSuite(
  propId: string,
  config: TemplateConfig = DEFAULT_TEMPLATE_CONFIG
): TestCaseDefinition[] {
  return PROPERTY_TEST_SUITES[propId] || config.testSuite;
}
