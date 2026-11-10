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
      email: 'user-wbbmbfobdqdu@salesforce.com',
      role: 'Lead Edge Release Engineer',
      account: 'SFDC-EDGE-030771555103 (AWS 030771555103 · Akamai Prod + Staging)',
    },
    accountOptions: [
      'SFDC-EDGE-030771555103 (AWS 030771555103 · Akamai Prod + Staging)',
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
    s3Bucket: 's3://salesforce-akamai-synthetics-030771555103-us-east-1',
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
      by: 'user-enaopopztofm@salesforce.com',
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
      by: 'user-enaopopztofm@salesforce.com',
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
