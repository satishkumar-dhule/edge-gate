/**
 * ============================================================================
 * SALESFORCE EDGE RELEASE GATE — DOM SCREENSHOT & VISUAL DIFF RENDERER
 * ============================================================================
 * Provides high-resolution (1440x900) deterministic DOM visual snapshots and
 * static PNG asset resolution for all Salesforce properties (`www`, `login`,
 * `developer`, `help`, `trailhead`, `status`, `appexchange`, `partners`) and
 * ad-hoc URLs probed through the Synthetic Release Gate.
 * ============================================================================
 */

export interface DomScreenshotOptions {
  testId?: string;
  testName?: string;
  url?: string;
  side?: 'A' | 'B' | 'single';
  highlightDiff?: boolean;
  showOverlay?: boolean;
  overlayText?: string;
  httpStatus?: number;
  durationMs?: number;
  edgeHostname?: string;
  edgeIp?: string;
  cacheStatus?: string;
}

interface PageVisualTheme {
  propertyBadge: string;
  accentHex: string;
  SecondaryHex: string;
  heroBgGradient: [string, string];
  announcementBanner: string;
  headline: string;
  subheadline: string;
  primaryCta: string;
  secondaryCta: string;
  cards: Array<{ title: string; metric: string; subtitle: string }>;
}

function escapeXml(unsafe: string): string {
  return String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function resolvePageVisualTheme(
  url: string = 'https://www.salesforce.com/',
  testId: string = 'T01',
  testName: string = 'Salesforce Global Home & Hero Experience'
): PageVisualTheme {
  const lowerUrl = (url || '').toLowerCase();
  const idUpper = (testId || 'T01').toUpperCase();

  if (lowerUrl.includes('login.salesforce.com')) {
    switch (idUpper) {
      case 'T02':
        return {
          propertyBadge: 'Salesforce Identity · OAuth 2.0 PKCE Endpoint',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f4f6f9', '#dbeafe'],
          announcementBanner: 'OAuth 2.0 / OpenID Connect Core Authorization Server',
          headline: 'OAuth 2.0 PKCE Authorization & Token Exchange',
          subheadline: 'High-security authorization code flow with SHA-256 code challenge for mobile and SPA clients.',
          primaryCta: 'View Auth Protocol Docs',
          secondaryCta: 'Verify PKCE Challenge',
          cards: [
            { title: 'Token Protocol', metric: 'OAuth 2.0', subtitle: 'RFC 7636 PKCE Compliant' },
            { title: 'Response Latency', metric: '< 22ms', subtitle: 'Global Anycast Auth Gate' },
            { title: 'Token Lifespan', metric: '2 Hours', subtitle: 'Automated Refresh Tokens' },
          ],
        };
      case 'T03':
        return {
          propertyBadge: 'Salesforce Identity · OpenID Connect Well-Known',
          accentHex: '#0b5cab',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#eff6ff', '#e0e7ff'],
          announcementBanner: 'Discovery Endpoint: /.well-known/idp-configuration',
          headline: 'OpenID Connect Configuration & Key Rotation',
          subheadline: 'JSON Web Key Set (JWKS) metadata, issuer verification, and cryptographic signature endpoints.',
          primaryCta: 'Inspect JWKS Keys',
          secondaryCta: 'Validate Issuer URL',
          cards: [
            { title: 'Key Rotation', metric: 'Automated', subtitle: 'Zero-Downtime Rollover' },
            { title: 'Algorithm', metric: 'RS256 / ES256', subtitle: 'FIPS 140-2 Validated' },
            { title: 'OIDC Discovery', metric: 'RFC 8414', subtitle: 'Standard Metadata Schema' },
          ],
        };
      case 'T04':
        return {
          propertyBadge: 'Salesforce Identity · My Domain Discovery',
          accentHex: '#032d60',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f8fafc', '#e2e8f0'],
          announcementBanner: 'Edge Routing & Canonical Domain Normalization',
          headline: 'My Domain SSO & Org Routing Gateway',
          subheadline: 'Intelligently directs enterprise users to branded custom domains (e.g. company.my.salesforce.com).',
          primaryCta: 'Find My Domain',
          secondaryCta: 'Configure IdP Routing',
          cards: [
            { title: 'Edge Routing Latency', metric: '< 15ms', subtitle: 'Sub-Domain DNS Lookups' },
            { title: 'Tenant Isolation', metric: 'Strict', subtitle: 'Multi-Tenant Partitioning' },
            { title: 'Redirection Rule', metric: '302 Found', subtitle: 'Signed IdP Redirection' },
          ],
        };
      case 'T05':
        return {
          propertyBadge: 'Salesforce Identity · Multi-Factor Authentication',
          accentHex: '#04844b',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f0fdf4', '#eff6ff'],
          announcementBanner: 'Mandatory MFA · FIDO2 WebAuthn & Salesforce Authenticator',
          headline: 'Multi-Factor Authentication & Zero-Trust Verify',
          subheadline: 'Hardware security keys (YubiKey), biometric passkeys, and push notifications for zero-trust login.',
          primaryCta: 'Register Passkey',
          secondaryCta: 'Authenticator Setup',
          cards: [
            { title: 'WebAuthn Support', metric: 'FIDO2 Level 2', subtitle: 'Hardware Security Key' },
            { title: 'Auth Success Rate', metric: '99.98%', subtitle: 'Biometric One-Touch' },
            { title: 'Risk-Based Challenge', metric: 'Adaptive AI', subtitle: 'Geo-Anomaly Detection' },
          ],
        };
      case 'T06':
        return {
          propertyBadge: 'Salesforce Identity · Account Recovery',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f8fafc', '#eff6ff'],
          announcementBanner: 'Secure Self-Service Password Reset & Verification',
          headline: 'Forgot Password & Identity Verification',
          subheadline: 'One-time secure token dispatch to verified primary business email with anti-phishing protection.',
          primaryCta: 'Reset Password',
          secondaryCta: 'Contact Admin',
          cards: [
            { title: 'Token Expiry', metric: '20 Mins', subtitle: 'Single-Use Ephemeral Link' },
            { title: 'Rate Limiting', metric: 'Strict', subtitle: 'IP & User Anomaly Defense' },
            { title: 'Audit Logging', metric: '100% Realtime', subtitle: 'EventLogFile Feed' },
          ],
        };
      case 'T07':
        return {
          propertyBadge: 'Salesforce Identity · SAML 2.0 SSO ACS',
          accentHex: '#5867e8',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f5f3ff', '#eff6ff'],
          announcementBanner: 'Assertion Consumer Service (ACS) Endpoint',
          headline: 'SAML 2.0 Single Sign-On Gateway',
          subheadline: 'Enterprise federated authentication with Okta, Azure AD, PingIdentity, and Google Workspace.',
          primaryCta: 'View SAML Metadata',
          secondaryCta: 'Test ACS Endpoint',
          cards: [
            { title: 'SAML Binding', metric: 'HTTP-POST', subtitle: 'Signed Assertions & Response' },
            { title: 'Federation Ready', metric: 'Global SSO', subtitle: 'Automated JIT Provisioning' },
            { title: 'Signature Check', metric: 'SHA-256', subtitle: 'X.509 Certificate Chain' },
          ],
        };
      case 'T08':
        return {
          propertyBadge: 'Salesforce Identity · Session Telemetry & Health',
          accentHex: '#032d60',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f1f5f9', '#dbeafe'],
          announcementBanner: 'Real-Time Edge Session Verification & Health',
          headline: 'Identity Session Telemetry & Health Probe',
          subheadline: 'Health telemetry for active browser sessions, OAuth grant caches, and multi-region replication.',
          primaryCta: 'View Session Health',
          secondaryCta: 'Revoke Active Grants',
          cards: [
            { title: 'Session Cache Hit', metric: '99.9%', subtitle: 'Distributed Redis Cluster' },
            { title: 'Concurrent Logins', metric: 'Governed', subtitle: 'Per-User Session Limits' },
            { title: 'Health Status', metric: 'HEALTHY', subtitle: 'All Auth Pods Operational' },
          ],
        };
      default:
        return {
          propertyBadge: 'Salesforce Identity & OAuth 2.0 Gateway',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f4f6f9', '#eef4ff'],
          announcementBanner: 'TLSv1.3 Strict HSTS · Multi-Org SAML & OIDC SSO Edge',
          headline: 'Salesforce Enterprise Sign In',
          subheadline:
            'Log in to your Customer 360 org, configure My Domain SSO, or verify OAuth 2.0 PKCE session tokens.',
          primaryCta: 'Log In to Production Org',
          secondaryCta: 'Use Custom Domain',
          cards: [
            { title: 'OAuth 2.0 / OIDC', metric: '99.999%', subtitle: 'Token Endpoint Availability' },
            { title: 'My Domain Routing', metric: '< 18ms', subtitle: 'Akamai Edge Redirect Latency' },
            { title: 'MFA & Passkeys', metric: 'FIDO2', subtitle: 'Hardware Security Key Ready' },
          ],
        };
    }
  }

  if (lowerUrl.includes('trailhead.salesforce.com')) {
    switch (idUpper) {
      case 'T02':
        return {
          propertyBadge: 'Trailhead · Agentforce Specialist Superbadge',
          accentHex: '#04844b',
          SecondaryHex: '#00a1e0',
          heroBgGradient: ['#f0fdf4', '#e0f2fe'],
          announcementBanner: 'Earn the Agentforce Specialist Superbadge Credential',
          headline: 'Agentforce Autonomous Agent Superbadge',
          subheadline: 'Build and verify custom actions, reasoning topics, and Einstein prompt templates in a live org.',
          primaryCta: 'Start Superbadge',
          secondaryCta: 'View Prerequisites',
          cards: [
            { title: 'Hands-on Units', metric: '12 Units', subtitle: 'Prompt & Model Builder' },
            { title: 'Credential', metric: 'GA Superbadge', subtitle: 'Autonomous Agent Design' },
            { title: 'Passing Rate', metric: '94.2%', subtitle: 'Verified Submissions' },
          ],
        };
      case 'T03':
        return {
          propertyBadge: 'Trailhead · Modules & Skills Library',
          accentHex: '#00a1e0',
          SecondaryHex: '#0b5cab',
          heroBgGradient: ['#e8f8ff', '#eff6ff'],
          announcementBanner: '350+ Interactive Hands-On AI & Data Cloud Modules',
          headline: 'Trailhead Modules & AI Badges Catalog',
          subheadline: 'Learn Apex, LWC, Agentforce SDK, Flow Builder, and Data Cloud zero-copy architecture.',
          primaryCta: 'Browse Modules',
          secondaryCta: 'Filter by Role',
          cards: [
            { title: 'AI Modules', metric: '350+', subtitle: 'Generative AI & Data Cloud' },
            { title: 'Points Available', metric: '500,000+', subtitle: 'Gamified Skill Badges' },
            { title: 'Learner Rating', metric: '4.9 / 5', subtitle: '1.2M Reviews' },
          ],
        };
      case 'T04':
        return {
          propertyBadge: 'Trailhead · Career Paths & Credentials',
          accentHex: '#0b5cab',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#e0f2fe'],
          announcementBanner: 'Explore High-Growth Roles in the Salesforce AI Economy',
          headline: 'Career Paths & Enterprise Architect Credentials',
          subheadline: 'Step-by-step career navigation for Administrators, Developers, AI Specialists, and Solution Architects.',
          primaryCta: 'Explore Careers',
          secondaryCta: 'Salary Calculator',
          cards: [
            { title: 'Architect Tracks', metric: '6 Paths', subtitle: 'Technical & Solution Architect' },
            { title: 'Salary Uplift', metric: '+28%', subtitle: 'Certified Trailblazers' },
            { title: 'Job Demand', metric: '45,000+', subtitle: 'Open Ecosystem Roles' },
          ],
        };
      case 'T05':
        return {
          propertyBadge: 'Trailhead · Trailblazer Community',
          accentHex: '#04844b',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f0fdf4', '#f8fafc'],
          announcementBanner: 'Connect with 20M+ Global Trailblazers & Local Chapters',
          headline: 'Trailblazer Community & Mentorship Groups',
          subheadline: 'Ask questions, join community conferences (Dreamin events), and get 1-on-1 career mentorship.',
          primaryCta: 'Join Community',
          secondaryCta: 'Find Local Group',
          cards: [
            { title: 'Global Groups', metric: '1,500+', subtitle: 'Local & Virtual Meetups' },
            { title: 'Active Mentors', metric: '8,000+', subtitle: 'Career Coaching' },
            { title: 'Answers Given', metric: '20M+', subtitle: 'Community Knowledge' },
          ],
        };
      case 'T06':
        return {
          propertyBadge: 'Trailhead · Hands-On Playground Manager',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f0f9ff', '#e0f2fe'],
          announcementBanner: 'Zero-Configuration Cloud Developer Sandboxes',
          headline: 'Hands-On Orgs & Playground Environment Manager',
          subheadline: 'Launch, manage, reset, and verify developer edition orgs preloaded with hands-on challenge metadata.',
          primaryCta: 'Launch Playground',
          secondaryCta: 'Reset Credentials',
          cards: [
            { title: 'Active Orgs', metric: '10 Orgs', subtitle: 'Developer & Scratch Orgs' },
            { title: 'Org Spin-Up', metric: '< 8 sec', subtitle: 'Preloaded Metadata' },
            { title: 'Package Install', metric: '1-Click', subtitle: 'Instant Verification' },
          ],
        };
      case 'T07':
        return {
          propertyBadge: 'Trailhead · Official Certifications',
          accentHex: '#0b5cab',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#eff6ff', '#dbeafe'],
          announcementBanner: 'Globally Recognized Industry Badges & Credentials',
          headline: 'Certifications & Credential Verification Portal',
          subheadline: 'Schedule proctored online exams or verify an employee credentials against the official registry.',
          primaryCta: 'Schedule Exam',
          secondaryCta: 'Verify Credential',
          cards: [
            { title: 'Official Certs', metric: '35 Certs', subtitle: 'Admin, Dev, AI, Architect' },
            { title: 'Testing Mode', metric: 'Proctored', subtitle: 'Online & Testing Centers' },
            { title: 'LinkedIn Badges', metric: 'Instant', subtitle: 'Digital Verification' },
          ],
        };
      case 'T08':
        return {
          propertyBadge: 'Trailhead · Trailblazer Ranks & Leaderboard',
          accentHex: '#5867e8',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f5f3ff', '#eff6ff'],
          announcementBanner: 'Celebrate Ranger Status, Points & Superbadge Milestone Ranks',
          headline: 'Salesforce Ranger Leaderboard & Community Ranks',
          subheadline: 'Compete with team members, track badge progress, and climb from Scout to Triple-Star Ranger.',
          primaryCta: 'View Leaderboard',
          secondaryCta: 'My Badges',
          cards: [
            { title: 'Ranger Status', metric: '100+ Badges', subtitle: '50,000+ Points Level' },
            { title: 'All-Star Rangers', metric: '10x Ranger', subtitle: 'Top 1% Global Learners' },
            { title: 'Company Rank', metric: '#1 Enterprise', subtitle: 'Salesforce Partner League' },
          ],
        };
      default:
        return {
          propertyBadge: 'Trailhead · Skill Up for the AI Future',
          accentHex: '#00a1e0',
          SecondaryHex: '#04844b',
          heroBgGradient: ['#e8f8ff', '#f0fdf4'],
          announcementBanner: 'Earn the Agentforce Specialist Certification Badge',
          headline: 'Learn In-Demand AI, Data Cloud & CRM Skills',
          subheadline:
            'Hands-on challenges, Trailblazer Ranks, and superbadges guided by Einstein Copilot.',
          primaryCta: 'Start Learning Free',
          secondaryCta: 'Explore Career Paths',
          cards: [
            { title: 'Agentforce Trails', metric: '140+ Badges', subtitle: 'Hands-On Org Challenges' },
            { title: 'Data Cloud Architect', metric: 'Superbadge', subtitle: 'Zero-Copy Federation' },
            { title: 'Trailblazer Community', metric: '20M+', subtitle: 'Global Learners & Mentors' },
          ],
        };
    }
  }

  if (lowerUrl.includes('developer.salesforce.com')) {
    switch (idUpper) {
      case 'T02':
        return {
          propertyBadge: 'Salesforce Developers · REST & GraphQL Matrix',
          accentHex: '#0b5cab',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#032d60', '#0b5cab'],
          announcementBanner: 'v62.0 REST, GraphQL, Composite & Bulk API 2.0 Specifications',
          headline: 'Complete Salesforce REST & GraphQL API Reference',
          subheadline: 'Query records with GraphQL wire adapters, batch execute via Composite API, or stream events with Pub/Sub.',
          primaryCta: 'Explore API Spec',
          secondaryCta: 'Postman Collection',
          cards: [
            { title: 'OpenAPI 3.1 Spec', metric: 'v62.0 GA', subtitle: 'Type-Safe Endpoint Definitions' },
            { title: 'GraphQL Wire', metric: 'Sub-30ms', subtitle: 'Consolidated Single-Query Payloads' },
            { title: 'Bulk API 2.0', metric: '100M Records', subtitle: 'High-Throughput Parallel Ingest' },
          ],
        };
      case 'T03':
        return {
          propertyBadge: 'Salesforce Developers · LWC Component Playground',
          accentHex: '#0176d3',
          SecondaryHex: '#0b5cab',
          heroBgGradient: ['#eff6ff', '#dbeafe'],
          announcementBanner: 'Interactive Lightning Web Components Sandbox & Compiler',
          headline: 'Lightning Web Components (LWC) Playground',
          subheadline: 'Rapidly prototype and test custom reactive web components with Shadow DOM and SLDS styling in browser.',
          primaryCta: 'Open LWC Studio',
          secondaryCta: 'Component Library',
          cards: [
            { title: 'W3C Web Standards', metric: '100% Native', subtitle: 'Shadow DOM & Custom Elements' },
            { title: 'SLDS 2.0 Design', metric: 'Accessible', subtitle: 'WCAG AAA Design Tokens' },
            { title: 'Reactive Wire', metric: 'Automatic', subtitle: 'Direct Client Cache Sync' },
          ],
        };
      case 'T04':
        return {
          propertyBadge: 'Salesforce Developers · Apex Language Reference',
          accentHex: '#032d60',
          SecondaryHex: '#0b5cab',
          heroBgGradient: ['#0f172a', '#1e293b'],
          announcementBanner: 'Strongly Typed, Object-Oriented Cloud Programming Language',
          headline: 'Apex Developer Guide & Trigger Frameworks',
          subheadline: 'Execute transactions on Salesforce Hyperforce servers with native database queries, SOQL/SOSL, and governor limits.',
          primaryCta: 'Read Apex Guide',
          secondaryCta: 'Async & Queueable',
          cards: [
            { title: 'Governor Limits', metric: 'Strict Sandboxing', subtitle: '100 SOQL / 150 DML Checks' },
            { title: 'Unit Test Engine', metric: '75% Required', subtitle: 'Deterministic Assertions' },
            { title: 'Apex Cursors', metric: 'NEW GA', subtitle: 'Scalable SOQL Iteration' },
          ],
        };
      case 'T05':
        return {
          propertyBadge: 'Salesforce Developers · Agentforce Prompt SDK',
          accentHex: '#5867e8',
          SecondaryHex: '#0b5cab',
          heroBgGradient: ['#1e1b4b', '#312e81'],
          announcementBanner: 'CLI & VS Code Extensions for Custom Autonomous Agents',
          headline: 'Agentforce Prompt & Custom Action SDK',
          subheadline: 'Author, debug, and publish autonomous AI topics and generative prompt templates directly from VS Code.',
          primaryCta: 'Install CLI Plugin',
          secondaryCta: 'SDK Sample Code',
          cards: [
            { title: 'Prompt Templates', metric: 'Flex, Field, Email', subtitle: 'Grounded in Data Cloud' },
            { title: 'Custom Actions', metric: 'Invocable Apex', subtitle: 'Autonomous Multi-Step Tools' },
            { title: 'CLI Integration', metric: 'sf agent test', subtitle: 'Local Prompt Evaluation' },
          ],
        };
      case 'T06':
        return {
          propertyBadge: 'Salesforce Developers · Developer Edition Free Org',
          accentHex: '#04844b',
          SecondaryHex: '#0b5cab',
          heroBgGradient: ['#f0fdf4', '#eff6ff'],
          announcementBanner: 'Full-Featured Enterprise Developer Sandbox with Free Lifetime Access',
          headline: 'Sign Up for a Free Developer Edition Org',
          subheadline: 'Test Apex, build LWC packages, connect external REST integrations, and develop Agentforce agents free.',
          primaryCta: 'Get Developer Org',
          secondaryCta: 'Scratch Org Guide',
          cards: [
            { title: 'Free Lifetime Org', metric: 'Developer Edition', subtitle: '2 Standard Enterprise Licenses' },
            { title: 'Agentforce Access', metric: 'Enabled', subtitle: 'Preloaded Sample Schemas' },
            { title: 'API Access', metric: 'Full Enterprise', subtitle: 'All REST & Tooling APIs' },
          ],
        };
      case 'T07':
        return {
          propertyBadge: 'Salesforce Developers · Data Cloud Ingestion SDK',
          accentHex: '#0b5cab',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#032d60', '#1e3a8a'],
          announcementBanner: 'Zero-Copy Architecture & Connectors for Snowflake, Databricks & BigQuery',
          headline: 'Data Cloud Ingestion API & Connector SDK',
          subheadline: 'Ingest enterprise streaming events, federate external data lakes zero-copy, and map to Standard Data Models.',
          primaryCta: 'Data Cloud Specs',
          secondaryCta: 'Streaming API Docs',
          cards: [
            { title: 'Zero-Copy Federation', metric: 'Iceberg / Delta', subtitle: 'Bi-Directional Query Engine' },
            { title: 'Ingestion Speed', metric: 'Sub-Second', subtitle: 'Streaming Event API' },
            { title: 'Identity Resolution', metric: 'Unified 360', subtitle: 'Real-Time Profile Graph' },
          ],
        };
      case 'T08':
        return {
          propertyBadge: 'Salesforce Developers · Community Forums',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#f8fafc'],
          announcementBanner: 'Ask Questions & Share Solutions with 5M+ Global Developers',
          headline: 'Salesforce Developer Forums & Code Discussions',
          subheadline: 'Troubleshoot Apex exceptions, discuss Lightning Web Component state management, and exchange best practices.',
          primaryCta: 'Browse Forums',
          secondaryCta: 'Ask Question',
          cards: [
            { title: 'Active Topics', metric: '250,000+', subtitle: 'Apex, LWC, APIs, AI' },
            { title: 'Response Time', metric: '< 2 Hours', subtitle: 'Community & MVP Answers' },
            { title: 'Verified Solutions', metric: '98.6%', subtitle: 'Upvoted Code Snippets' },
          ],
        };
      default:
        return {
          propertyBadge: 'Salesforce Developers & Apex Reference',
          accentHex: '#0b5cab',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#032d60', '#0b5cab'],
          announcementBanner: 'Spring ’26 REST, GraphQL & Agentforce SDK Docs Live',
          headline: 'Build Autonomous Apps on the Einstein 1 Platform',
          subheadline:
            'Explore Apex, Lightning Web Components (LWC), Data Cloud APIs, and Agentforce REST endpoints.',
          primaryCta: 'Browse API Reference',
          secondaryCta: 'Get Developer Edition',
          cards: [
            { title: 'REST & Bulk API 2.0', metric: 'v62.0', subtitle: 'OpenAPI 3.1 Spec & Postman' },
            { title: 'Lightning Web Components', metric: 'LWC', subtitle: ' Playground & UI Library' },
            { title: 'Agentforce Prompt SDK', metric: 'GA', subtitle: 'CLI & VS Code Extensions' },
          ],
        };
    }
  }

  if (lowerUrl.includes('status.salesforce.com')) {
    switch (idUpper) {
      case 'T02':
        return {
          propertyBadge: 'Salesforce Trust · Instance Availability Matrix',
          accentHex: '#2e844a',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f0fdf4', '#ecfeff'],
          announcementBanner: 'Live Telemetry Across All 198 Hyperforce & Core Regions',
          headline: 'Hyperforce NA, EMEA & APAC Instances',
          subheadline: 'Real-time performance, health metrics, and infrastructure telemetry for every multi-tenant production cell.',
          primaryCta: 'Inspect Instances',
          secondaryCta: 'Filter by Org Pod',
          cards: [
            { title: 'Instances Active', metric: '198 / 198', subtitle: '100% Operational' },
            { title: 'Transaction SLA', metric: '99.99%', subtitle: 'Under 180ms Response' },
            { title: 'Global Edge Health', metric: 'Normal', subtitle: 'Anycast DNS Balanced' },
          ],
        };
      case 'T03':
        return {
          propertyBadge: 'Salesforce Trust · Maintenance Schedule',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f0f9ff', '#e0f2fe'],
          announcementBanner: 'Zero-Downtime Maintenance & Major Seasonal Releases',
          headline: 'Scheduled System Maintenance & Sandboxes',
          subheadline: 'Upcoming maintenance windows, sandbox preview cutover dates, and zero-downtime infrastructure patches.',
          primaryCta: 'View Schedule',
          secondaryCta: 'Download iCal Feed',
          cards: [
            { title: 'Upcoming Window', metric: 'Sunday 03:00', subtitle: 'Zero Downtime Rolling' },
            { title: 'Seasonal Release', metric: 'Spring ’26', subtitle: 'Sandbox Preview Complete' },
            { title: 'Advance Notice', metric: '60 Days', subtitle: 'Compliance Standard' },
          ],
        };
      case 'T04':
        return {
          propertyBadge: 'Salesforce Trust · Compliance & Security Center',
          accentHex: '#032d60',
          SecondaryHex: '#2e844a',
          heroBgGradient: ['#f8fafc', '#eff6ff'],
          announcementBanner: 'SOC 2 Type II · ISO 27001 · FedRAMP High · HIPAA Ready',
          headline: 'Security, Privacy & Global Certifications',
          subheadline: 'Audit reports, penetration test summaries, and compliance documentation for enterprise procurement.',
          primaryCta: 'Download SOC 2',
          secondaryCta: 'Compliance Portal',
          cards: [
            { title: 'FedRAMP High', metric: 'Certified', subtitle: 'US GovCloud Ready' },
            { title: 'ISO 27001 / 27018', metric: 'Annual Audit', subtitle: 'Global Data Privacy' },
            { title: 'Encryption Standards', metric: 'AES-256 / TLSv1.3', subtitle: 'At Rest & In Transit' },
          ],
        };
      case 'T05':
        return {
          propertyBadge: 'Salesforce Trust · Incident History & Post-Mortems',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f8fafc', '#ecfeff'],
          announcementBanner: 'Full Transparency · Root Cause Analyses & Timeline Logs',
          headline: 'Historical Incident Reports & Availability Archive',
          subheadline: 'Detailed post-incident reviews, mitigation steps, and engineering corrective actions published openly.',
          primaryCta: 'Browse Incidents',
          secondaryCta: 'Subscribe to RCAs',
          cards: [
            { title: '90-Day Uptime', metric: '99.998%', subtitle: 'Across All Core Services' },
            { title: 'Mean Time to Mitigate', metric: '< 14 Mins', subtitle: 'Automated Failover' },
            { title: 'RCA Turnaround', metric: '< 5 Days', subtitle: 'Published Publicly' },
          ],
        };
      case 'T06':
        return {
          propertyBadge: 'Salesforce Trust · Realtime Status APIs',
          accentHex: '#0b5cab',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#e0f2fe'],
          announcementBanner: 'JSON REST & Webhook Notification Feeds for SIEM & PagerDuty',
          headline: 'System Status REST APIs & Webhook Subscriptions',
          subheadline: 'Ingest real-time instance availability telemetry directly into Datadog, Splunk, ServiceNow, or Slack.',
          primaryCta: 'View API Spec',
          secondaryCta: 'Configure Webhook',
          cards: [
            { title: 'API Response Time', metric: '< 12ms', subtitle: 'Edge-Cached Status Feed' },
            { title: 'Webhook Delivery', metric: 'Instant', subtitle: 'Real-Time Incident Push' },
            { title: 'Rate Limit', metric: '10,000 req/hr', subtitle: 'High-Volume Enterprise' },
          ],
        };
      case 'T07':
        return {
          propertyBadge: 'Salesforce Trust · Notification Subscription',
          accentHex: '#2e844a',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f0fdf4', '#eff6ff'],
          announcementBanner: 'SMS, Email, and Webhook Telemetry Alerts for Your Orgs',
          headline: 'Subscribe to Real-Time Trust Notifications',
          subheadline: 'Tailor email and SMS alerts specifically to your production org pods, sandboxes, and cloud products.',
          primaryCta: 'Manage Alerts',
          secondaryCta: 'Add Phone Number',
          cards: [
            { title: 'Subscribed Orgs', metric: 'Custom List', subtitle: 'Only Pertinent Alerts' },
            { title: 'Notification Channels', metric: 'SMS + Email', subtitle: '24/7 Priority Alerts' },
            { title: 'Alert Latency', metric: '< 60 sec', subtitle: 'Immediate Incident Broadcast' },
          ],
        };
      case 'T08':
        return {
          propertyBadge: 'Salesforce Trust · Anycast Network Telemetry',
          accentHex: '#032d60',
          SecondaryHex: '#2e844a',
          heroBgGradient: ['#0f172a', '#1e293b'],
          announcementBanner: 'Akamai Global Edge Anycast PoPs & Routing Performance',
          headline: 'Edge Network Telemetry & Routing Health',
          subheadline: 'Global Anycast latency across 300+ Akamai edge PoPs, BGP routing health, and TLS negotiation speed.',
          primaryCta: 'View PoP Map',
          secondaryCta: 'Latency Benchmarks',
          cards: [
            { title: 'Edge Anycast PoPs', metric: '300+ Cities', subtitle: 'Global Distributed Edge' },
            { title: 'Global TTFB Average', metric: '38ms', subtitle: 'Akamai Edge Acceleration' },
            { title: 'DDoS Mitigation', metric: '100% Mitigated', subtitle: 'Multi-Tbps Edge Shield' },
          ],
        };
      default:
        return {
          propertyBadge: 'Salesforce Trust · Real-Time Cloud Status',
          accentHex: '#2e844a',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f0fdf4', '#ecfeff'],
          announcementBanner: 'All Global Hyperforce & Core Instances Operational',
          headline: 'Real-Time System Availability & Compliance',
          subheadline:
            'Live telemetry across NA, EMEA, and APAC Hyperforce regions, maintenance windows, and security advisories.',
          primaryCta: 'View Instance Matrix',
          secondaryCta: 'Subscribe to Alerts',
          cards: [
            { title: 'Core CRM & Hyperforce', metric: '100.0%', subtitle: 'All 198 Instances Healthy' },
            { title: 'Data Cloud & AI Gateway', metric: 'Operational', subtitle: 'Zero Active Incidents' },
            { title: 'Akamai Global Edge', metric: '38ms TTFB', subtitle: 'Multi-Region Anycast PoPs' },
          ],
        };
    }
  }

  if (lowerUrl.includes('help.salesforce.com')) {
    switch (idUpper) {
      case 'T02':
        return {
          propertyBadge: 'Salesforce Help · Verified Knowledge Base',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#f8fafc'],
          announcementBanner: 'Search 85,000+ Expert Technical & Product Documentation Articles',
          headline: 'Knowledge Base & Technical Solutions Search',
          subheadline: 'Find verified troubleshooting steps, step-by-step setup guides, and architectural best practices.',
          primaryCta: 'Search Articles',
          secondaryCta: 'Browse by Product',
          cards: [
            { title: 'Verified Articles', metric: '85,000+', subtitle: 'Written by Product Engineers' },
            { title: 'Search Relevance', metric: 'AI Powered', subtitle: 'Semantic Vector Search' },
            { title: 'Languages', metric: '16 Locales', subtitle: 'Global Translations' },
          ],
        };
      case 'T03':
        return {
          propertyBadge: 'Salesforce Help · Support Case Management',
          accentHex: '#0b5cab',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f0f9ff', '#dbeafe'],
          announcementBanner: 'Direct Access to Premier & Signature Support Engineers',
          headline: 'Premier Support Case Management Portal',
          subheadline: 'Create, track, and collaborate on mission-critical cases with dedicated Technical Account Managers.',
          primaryCta: 'Open Support Case',
          secondaryCta: 'View Active Cases',
          cards: [
            { title: 'Severity 1 SLA', metric: '< 15 Mins', subtitle: '24/7/365 Critical Response' },
            { title: 'Resolution Rate', metric: '98.4%', subtitle: 'First-Contact Resolution' },
            { title: 'Signature Coaching', metric: 'Included', subtitle: 'Proactive Monitoring' },
          ],
        };
      case 'T04':
        return {
          propertyBadge: 'Salesforce Help · Release Notes Matrix',
          accentHex: '#5867e8',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f5f3ff', '#eff6ff'],
          announcementBanner: 'Spring ’26 Seasonal Release Notes & Sandbox Preview Guide',
          headline: 'Salesforce Release Notes & Feature Readiness',
          subheadline: 'Discover hundreds of new innovations across Agentforce, Data Cloud, Sales, Service, and Developer tools.',
          primaryCta: 'Read Release Notes',
          secondaryCta: 'Filter by Cloud',
          cards: [
            { title: 'New Features', metric: '450+ Updates', subtitle: 'Spring ’26 GA Release' },
            { title: 'Agentforce AI', metric: 'Top Highlights', subtitle: 'Autonomous Topics & Atlas' },
            { title: 'Sandbox Cutover', metric: 'Active', subtitle: 'Test in Preview Sandboxes' },
          ],
        };
      case 'T05':
        return {
          propertyBadge: 'Salesforce Help · Known Issues Tracker',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f8fafc', '#eff6ff'],
          announcementBanner: 'Track Bug Fixes, Workarounds & Engineering Scheduled Patches',
          headline: 'Salesforce Known Issues & Workaround Catalog',
          subheadline: 'Transparently search known product issues, subscribe for status updates, and view verified workarounds.',
          primaryCta: 'Search Known Issues',
          secondaryCta: 'Subscribe to Bug',
          cards: [
            { title: 'Issue Status', metric: 'Live Tracking', subtitle: 'Investigating, In Dev, Fixed' },
            { title: 'Patch Frequency', metric: 'Daily / Weekly', subtitle: 'Automated Deployment' },
            { title: 'Subscriber Updates', metric: 'Instant Email', subtitle: 'Notification on Patch GA' },
          ],
        };
      case 'T06':
        return {
          propertyBadge: 'Salesforce Help · Architecture Implementation Guides',
          accentHex: '#032d60',
          SecondaryHex: '#0b5cab',
          heroBgGradient: ['#0f172a', '#1e293b'],
          announcementBanner: 'Well-Architected Framework & Enterprise Blueprints',
          headline: 'Enterprise Implementation & Architectural Guides',
          subheadline: 'Standardized blueprints for large-scale multi-cloud integrations, data tiering, and security governance.',
          primaryCta: 'View Architecture Guides',
          secondaryCta: 'Well-Architected Tool',
          cards: [
            { title: 'Well-Architected', metric: 'Trusted, Easy, Adaptable', subtitle: '3 Architectural Pillars' },
            { title: 'Reference Blueprints', metric: '60+ Patterns', subtitle: 'Multi-Cloud Enterprise' },
            { title: 'Scale Validation', metric: '100M+ Records', subtitle: 'Large Data Volume Strategy' },
          ],
        };
      case 'T07':
        return {
          propertyBadge: 'Salesforce Help · Contact Support Concierge',
          accentHex: '#04844b',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f0fdf4', '#eff6ff'],
          announcementBanner: 'Instant Phone, Chat, and AI Concierge Support Options',
          headline: 'Contact Customer Support & Escalation Team',
          subheadline: 'Get routed directly to the right specialist for billing, technical support, developer assistance, or licensing.',
          primaryCta: 'Chat with Support',
          secondaryCta: 'Request Callback',
          cards: [
            { title: 'Chat Wait Time', metric: '< 30 sec', subtitle: 'Live Specialist Routing' },
            { title: 'Phone Support', metric: '24/7 Global', subtitle: 'Local Toll-Free Lines' },
            { title: 'AI Concierge', metric: 'Instant', subtitle: 'Autonomous First Response' },
          ],
        };
      case 'T08':
        return {
          propertyBadge: 'Salesforce Help · Customer Success Groups',
          accentHex: '#5867e8',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f5f3ff', '#eff6ff'],
          announcementBanner: 'Join Product Circles of Success & Expert Ask-the-Architect Hours',
          headline: 'Customer Success Community & Office Hours',
          subheadline: 'Participate in live webinars, virtual roundtables, and interactive Q&A sessions hosted by Salesforce product leaders.',
          primaryCta: 'Register for Office Hours',
          secondaryCta: 'Browse Circles',
          cards: [
            { title: 'Weekly Sessions', metric: '40+ Hours', subtitle: 'Ask-the-Expert Live' },
            { title: 'Community Members', metric: '2.5M+', subtitle: 'Customer Peer Exchanges' },
            { title: 'Customer Satisfaction', metric: '4.95 / 5', subtitle: 'Certified Event Feedback' },
          ],
        };
      default:
        return {
          propertyBadge: 'Salesforce Help & Trailblazer Support Portal',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#f8fafc'],
          announcementBanner: 'Unified Knowledge Articles & AI Case Resolution',
          headline: 'How Can Agentforce Help You Today?',
          subheadline:
            'Search verified Knowledge articles, manage Premier Support cases, or chat with an autonomous support agent.',
          primaryCta: 'Search Knowledge Base',
          secondaryCta: 'Open a Support Case',
          cards: [
            { title: 'Knowledge Base', metric: '85,000+', subtitle: 'Verified Technical Articles' },
            { title: 'Release Readiness', metric: '2026.11', subtitle: 'Release Notes & Sandbox Prep' },
            { title: 'Expert Coaching', metric: '24/7', subtitle: 'Signature Success Engineers' },
          ],
        };
    }
  }

  if (lowerUrl.includes('appexchange.salesforce.com')) {
    switch (idUpper) {
      case 'T02':
        return {
          propertyBadge: 'AppExchange · Agentforce AI Apps & Skills',
          accentHex: '#5867e8',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#eef2ff', '#f0f9ff'],
          announcementBanner: '420+ Pre-Built Autonomous Agents, Actions & Prompt Templates',
          headline: 'Agentforce Autonomous Apps & Skills Directory',
          subheadline: 'Deploy specialized AI agents for finance, supply chain, healthcare, and IT operations in minutes.',
          primaryCta: 'Install AI Agent',
          secondaryCta: 'Browse Categories',
          cards: [
            { title: 'Agent Actions', metric: '420+ GA', subtitle: 'Prebuilt Autonomous Skills' },
            { title: 'Zero-Copy AI', metric: 'Supported', subtitle: 'Grounded in Data Cloud' },
            { title: 'Security Audited', metric: '100%', subtitle: 'AppExchange Trust Review' },
          ],
        };
      case 'T03':
        return {
          propertyBadge: 'AppExchange · Top Enterprise CRM Apps',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#e0f2fe'],
          announcementBanner: 'Highest-Rated Managed Packages for Enterprise Orgs',
          headline: 'Top Enterprise CRM Integrations & Extensions',
          subheadline: 'Document generation, electronic signatures, ERP connectors, and advanced pipeline analytics apps.',
          primaryCta: 'View Top Apps',
          secondaryCta: 'Compare Packages',
          cards: [
            { title: 'Customer Ratings', metric: '4.8 / 5 Avg', subtitle: '150,000+ Reviews' },
            { title: 'Enterprise Ready', metric: 'Fortune 500', subtitle: 'Tested at High Volume' },
            { title: 'Instant Install', metric: '1-Click', subtitle: 'Production or Sandbox' },
          ],
        };
      case 'T04':
        return {
          propertyBadge: 'AppExchange · Industry Solutions',
          accentHex: '#04844b',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f0fdf4', '#eff6ff'],
          announcementBanner: 'Financial Services, Healthcare, Manufacturing & Retail Clouds',
          headline: 'Industry-Specific Solutions & Vertical Blueprints',
          subheadline: 'Preconfigured compliance templates and workflows tailored to regulatory demands in your industry.',
          primaryCta: 'Explore Industries',
          secondaryCta: 'Compliance Guides',
          cards: [
            { title: 'Industry Clouds', metric: '14 Verticals', subtitle: 'Tailored Schemas & Flows' },
            { title: 'Time-to-Value', metric: '3x Faster', subtitle: 'Pre-Engineered Packages' },
            { title: 'HIPAA / FINRA', metric: 'Compliant', subtitle: 'Regulated Data Ready' },
          ],
        };
      case 'T05':
        return {
          propertyBadge: 'AppExchange · Consulting Partners Directory',
          accentHex: '#0b5cab',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#f8fafc'],
          announcementBanner: 'Find Certified Systems Integrators & Specialist Boutiques',
          headline: 'Consulting Partners & Implementation Specialists',
          subheadline: 'Connect with certified consultants with verified customer satisfaction (CSAT) ratings and product badges.',
          primaryCta: 'Find a Consultant',
          secondaryCta: 'Filter by Expertise',
          cards: [
            { title: 'Certified SIs', metric: '2,200+ Firms', subtitle: 'Global & Regional Experts' },
            { title: 'Avg CSAT Score', metric: '4.92 / 5', subtitle: 'Independently Audited' },
            { title: 'Agentforce Badged', metric: '750+ Partners', subtitle: 'Accredited AI Delivery' },
          ],
        };
      case 'T06':
        return {
          propertyBadge: 'AppExchange · Security Review & Verification',
          accentHex: '#032d60',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#0f172a', '#1e293b'],
          announcementBanner: 'Rigorous Multi-Phase Security & Vulnerability Auditing',
          headline: 'AppExchange Security Review & Verification Standards',
          subheadline: 'Every app undergoes comprehensive static code analysis, network penetration testing, and SOQL injection checks.',
          primaryCta: 'Security Standards',
          secondaryCta: 'Verification Status',
          cards: [
            { title: 'Security Audit', metric: '100% Passed', subtitle: 'Annual Re-Verification' },
            { title: 'Vulnerability Scan', metric: 'Automated', subtitle: 'Continuous Code Monitoring' },
            { title: 'Enterprise Trust', metric: 'Zero-Trust', subtitle: 'No Unauthorized Data Access' },
          ],
        };
      case 'T07':
        return {
          propertyBadge: 'AppExchange · Free Components & Actions',
          accentHex: '#04844b',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f0fdf4', '#eff6ff'],
          announcementBanner: '1,200+ Free Lightning Web Components, Flow Screens & Dashboards',
          headline: 'Free Lightning Components & Flow Actions',
          subheadline: 'Supercharge your Salesforce admin toolkit with community-built, open-source components ready to drag and drop.',
          primaryCta: 'Browse Free Apps',
          secondaryCta: 'Flow Screen Library',
          cards: [
            { title: '100% Free Apps', metric: '1,200+ Packages', subtitle: 'Salesforce Labs & Community' },
            { title: 'Open Source', metric: 'GitHub Ready', subtitle: 'Customizable Source Code' },
            { title: 'Flow Builder', metric: 'Drag & Drop', subtitle: 'No-Code Integration' },
          ],
        };
      case 'T08':
        return {
          propertyBadge: 'AppExchange · Publisher & Developer Portal',
          accentHex: '#5867e8',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f5f3ff', '#eff6ff'],
          announcementBanner: 'Publish, Monetize & Monitor Your Apps in the AppExchange Console',
          headline: 'Publisher Console & License Management Analytics',
          subheadline: 'Manage AppExchange listings, monitor customer trials, track License Management App (LMA) subscriber data, and run marketing.',
          primaryCta: 'Open Publisher Hub',
          secondaryCta: 'Listing Analytics',
          cards: [
            { title: 'Subscriber Orgs', metric: 'Live Telemetry', subtitle: 'LMA Version Distribution' },
            { title: 'Trial Conversions', metric: '32.4%', subtitle: 'Guided Test Drives' },
            { title: 'Monetization API', metric: 'Checkout GA', subtitle: 'Automated Invoicing & Stripe' },
          ],
        };
      default:
        return {
          propertyBadge: 'Salesforce AppExchange · Enterprise Cloud Marketplace',
          accentHex: '#0176d3',
          SecondaryHex: '#5867e8',
          heroBgGradient: ['#eef2ff', '#f0f9ff'],
          announcementBanner: '7,500+ Pre-Built Apps, Flow Actions & Agentforce Topics',
          headline: 'Extend Customer 360 with Trusted Partner Apps',
          subheadline:
            'Discover security-reviewed managed packages, AI agent actions, and industry templates ready for instant install.',
          primaryCta: 'Explore AI & Data Apps',
          secondaryCta: 'Consultants & ISVs',
          cards: [
            { title: 'Agentforce Exchange', metric: '420+ Actions', subtitle: 'Prebuilt Autonomous Skills' },
            { title: 'Security Reviewed', metric: '100%', subtitle: 'AppExchange Trust Verified' },
            { title: 'Customer Installs', metric: '12M+', subtitle: 'Across Fortune 500 Orgs' },
          ],
        };
    }
  }

  if (lowerUrl.includes('partners.salesforce.com')) {
    switch (idUpper) {
      case 'T02':
        return {
          propertyBadge: 'Salesforce Partners · Consulting Program Tiers',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#e0f2fe'],
          announcementBanner: 'Base, Crest, Ridge, and Summit Consulting Partner Tiers',
          headline: 'Consulting Partner Program Tiering & Trailblazer Score',
          subheadline: 'Track your firm Scorecard across Customer Success (CSAT), Innovation, and Certified Employee Growth.',
          primaryCta: 'View Scorecard',
          secondaryCta: 'Tier Requirements',
          cards: [
            { title: 'Partner Tier', metric: 'Summit Tier', subtitle: 'Top Consulting Recognition' },
            { title: 'Scorecard Points', metric: '1,450 Pts', subtitle: 'CSAT + Certifications' },
            { title: 'Co-Sell Priority', metric: 'Tier 1', subtitle: 'Joint Salesforce Sales Alignment' },
          ],
        };
      case 'T03':
        return {
          propertyBadge: 'Salesforce Partners · ISV AppExchange Console',
          accentHex: '#5867e8',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f5f3ff', '#eff6ff'],
          announcementBanner: 'Build, License, and Distribute Commercial SaaS on Salesforce',
          headline: 'ISV Commercial Partner Portal & OEM Licensable Apps',
          subheadline: 'Access partner development orgs (PDOs), manage 2GP managed packaging pipelines, and automate license provisioning.',
          primaryCta: 'Launch ISV Portal',
          secondaryCta: 'OEM Guidelines',
          cards: [
            { title: '2GP Packaging', metric: 'Automated CI/CD', subtitle: 'Scratch Org Integration' },
            { title: 'Revenue Share', metric: 'Transparent', subtitle: 'Automated Billing Service' },
            { title: 'LMA Telemetry', metric: 'Instant', subtitle: 'Subscriber Feature Flags' },
          ],
        };
      case 'T04':
        return {
          propertyBadge: 'Salesforce Partners · Partner Learning Camp',
          accentHex: '#04844b',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f0fdf4', '#eff6ff'],
          announcementBanner: 'Advanced Technical Curricula for Consulting Practitioners',
          headline: 'Partner Learning Camp & Accredited Professional Badges',
          subheadline: 'Access exclusive curriculum for Agentforce implementation, Data Cloud data modeling, and enterprise architecture.',
          primaryCta: 'Browse PLC Courses',
          secondaryCta: 'Accreditation Matrix',
          cards: [
            { title: 'PLC Courses', metric: '850+ Curricula', subtitle: 'Architect & Consultant Tracks' },
            { title: 'Accreditations', metric: '42 Specializations', subtitle: 'Industry & Product Focus' },
            { title: 'Hands-on Labs', metric: '100% Practical', subtitle: 'Real-World Customer Scenarios' },
          ],
        };
      case 'T05':
        return {
          propertyBadge: 'Salesforce Partners · Deal Registration Portal',
          accentHex: '#0176d3',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#f8fafc'],
          announcementBanner: 'Protect Co-Sell Opportunities & Earn Referral Incentives',
          headline: 'Deal Registration & Pipeline Collaboration',
          subheadline: 'Register net-new customer opportunities, collaborate directly with Salesforce Account Executives, and track commissions.',
          primaryCta: 'Register New Deal',
          secondaryCta: 'Track Submissions',
          cards: [
            { title: 'Approval SLA', metric: '< 24 Hours', subtitle: 'Direct AE Assignment' },
            { title: 'Margin Protection', metric: 'Guaranteed', subtitle: 'Standard Co-Selling Rules' },
            { title: 'Referral Fees', metric: 'Automated', subtitle: 'Quarterly Electronic Payout' },
          ],
        };
      case 'T06':
        return {
          propertyBadge: 'Salesforce Partners · Partner Navigator',
          accentHex: '#0b5cab',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#eff6ff', '#e0f2fe'],
          announcementBanner: 'Showcase Validated Customer Expertise Across Products & Industries',
          headline: 'Partner Navigator Expertise & Industry Specializations',
          subheadline: 'Earn Master and Specialist Navigator badges that get highlighted to buyers across the AppExchange.',
          primaryCta: 'View My Badges',
          secondaryCta: 'Submit Case Study',
          cards: [
            { title: 'Navigator Level', metric: 'Level 3 Master', subtitle: 'Highest Expertise Tier' },
            { title: 'Validated Projects', metric: '48 CSAT Audits', subtitle: 'Verified Enterprise Customers' },
            { title: 'Buyer Visibility', metric: 'Top Ranked', subtitle: 'Featured in AppExchange SIs' },
          ],
        };
      case 'T07':
        return {
          propertyBadge: 'Salesforce Partners · Marketing Co-Op Portal',
          accentHex: '#5867e8',
          SecondaryHex: '#032d60',
          heroBgGradient: ['#f5f3ff', '#eff6ff'],
          announcementBanner: 'Brand Assets, Co-Branded Campaigns & Event Sponsorships',
          headline: 'Marketing Asset Library & Co-Op Fund Management',
          subheadline: 'Download official Partner logo marks, co-branded campaign assets, customer pitch decks, and Dreamforce sponsorship kits.',
          primaryCta: 'Download Brand Kits',
          secondaryCta: 'Claim Co-Op Funds',
          cards: [
            { title: 'Campaign Kits', metric: '120+ Templates', subtitle: 'Social, Email, Webinar Kits' },
            { title: 'Logo Guidelines', metric: 'Summit Partner', subtitle: 'Official Vector Artwork' },
            { title: 'Dreamforce Co-Op', metric: 'Available', subtitle: 'Turnkey Booth Sponsorship' },
          ],
        };
      case 'T08':
        return {
          propertyBadge: 'Salesforce Partners · API Governance & Ops',
          accentHex: '#032d60',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#0f172a', '#1e293b'],
          announcementBanner: 'Partner API Keys, Webhook Feeds & Enterprise Compliance',
          headline: 'Partner Operations, Security & API Governance',
          subheadline: 'Manage partner REST API credentials, webhook endpoints for license events, and annual security audits.',
          primaryCta: 'Manage API Keys',
          secondaryCta: 'Audit Log Feed',
          cards: [
            { title: 'Partner API Health', metric: '99.99%', subtitle: 'Dedicated Partner Endpoints' },
            { title: 'Event Webhooks', metric: 'Sub-Second', subtitle: 'Real-Time Lead & License Events' },
            { title: 'Security Compliance', metric: 'Current', subtitle: 'Annual Certification Verified' },
          ],
        };
      default:
        return {
          propertyBadge: 'Salesforce Partner Community & ISV Ecosystem',
          accentHex: '#032d60',
          SecondaryHex: '#0176d3',
          heroBgGradient: ['#f1f5f9', '#e0f2fe'],
          announcementBanner: 'Partner Learning Camp & AppExchange ISV Console',
          headline: 'Grow Your Practice with the #1 AI CRM Ecosystem',
          subheadline:
            'Access co-selling Deal Registration, ISV LMA licensing telemetry, and Agentforce implementation blueprints.',
          primaryCta: 'Open Partner Console',
          secondaryCta: 'Register New Deal',
          cards: [
            { title: 'ISV App Analytics', metric: 'Real-Time', subtitle: 'Subscriber Usage & LMA' },
            { title: 'Consulting Tiers', metric: 'Summit', subtitle: 'Joint Go-To-Market Enablement' },
            { title: 'Partner Certification', metric: 'AI Ready', subtitle: 'Accredited Delivery Tracks' },
          ],
        };
    }
  }

  // www.salesforce.com specific test cases T01..T08
  switch (idUpper) {
    case 'T02':
      return {
        propertyBadge: 'Sales Cloud · #1 AI Sales Platform',
        accentHex: '#0176d3',
        SecondaryHex: '#032d60',
        heroBgGradient: ['#eff6ff', '#e0f2fe'],
        announcementBanner: 'Gartner Magic Quadrant Leader for 18 Consecutive Years',
        headline: 'Close More Deals Faster with Agentforce for Sales',
        subheadline:
          'Unite seller workflows, autonomousSDR pipeline generation, revenue intelligence, and Einstein Conversation Insights.',
        primaryCta: 'Watch Sales Cloud Demo',
        secondaryCta: 'Try Sales Cloud Free',
        cards: [
          { title: 'Autonomous SDR Agent', metric: '+34%', subtitle: 'Qualified Pipeline Velocity' },
          { title: 'Forecast Accuracy', metric: '96.4%', subtitle: 'AI Revenue Intelligence' },
          { title: 'CRM Sync Latency', metric: 'Real-Time', subtitle: 'Zero-Copy Data Cloud Graph' },
        ],
      };
    case 'T03':
      return {
        propertyBadge: 'Agentforce AI & Einstein Copilot Platform',
        accentHex: '#5867e8',
        SecondaryHex: '#0176d3',
        heroBgGradient: ['#eef2ff', '#e0e7ff'],
        announcementBanner: 'NEW: Agentforce 2.0 Autonomous Reasoning Engine & Atlas Architecture',
        headline: 'Humans with Agents Drive Customer Success Together',
        subheadline:
          'Build and deploy autonomous AI agents grounded in your enterprise Data Cloud with strict Einstein Trust Layer guardrails.',
        primaryCta: 'Build Your First Agent',
        secondaryCta: 'Explore Atlas Engine',
        cards: [
          { title: 'Atlas Reasoning Engine', metric: '2.4x', subtitle: 'Higher Multi-Step Accuracy' },
          { title: 'Einstein Trust Layer', metric: 'Zero-Data', subtitle: 'PII Masking & Zero Retention' },
          { title: 'Out-of-Box Topics', metric: '100+', subtitle: 'Service, Sales, Commerce & IT' },
        ],
      };
    case 'T04':
      return {
        propertyBadge: 'What is CRM? · Salesforce Customer 360 Guide',
        accentHex: '#0176d3',
        SecondaryHex: '#032d60',
        heroBgGradient: ['#f0f9ff', '#e0f2fe'],
        announcementBanner: '301 Edge Redirect Verified: /crm -> /crm/ (Akamai Edge Redirector)',
        headline: 'The Complete Guide to AI-Powered CRM',
        subheadline:
          'Discover how Customer Relationship Management connects sales, service, marketing, commerce, and Data Cloud.',
        primaryCta: 'Explore Customer 360',
        secondaryCta: 'Calculate ROI',
        cards: [
          { title: 'Unified Customer Profile', metric: '360°', subtitle: 'Real-Time Identity Resolution' },
          { title: 'Edge Redirect Status', metric: '301 -> 200', subtitle: '2-Hop Canonical Normalization' },
          { title: 'Customer ROI', metric: '+29%', subtitle: 'Faster Time-to-Value' },
        ],
      };
    case 'T05':
      return {
        propertyBadge: 'Salesforce Free Trial · Instant 30-Day Sandbox',
        accentHex: '#04844b',
        SecondaryHex: '#0176d3',
        heroBgGradient: ['#f0fdf4', '#eff6ff'],
        announcementBanner: 'No Credit Card Required · Preloaded with Sample CRM & AI Data',
        headline: 'Start Your Free 30-Day Salesforce Trial',
        subheadline:
          'Experience Sales, Service, and Einstein AI out of the box with guided onboarding flows and live dashboards.',
        primaryCta: 'Start My Free Trial',
        secondaryCta: 'Talk to an Expert',
        cards: [
          { title: 'Instant Org Provisioning', metric: '< 15 sec', subtitle: 'Preconfigured Hyperforce Org' },
          { title: 'Guided Setup', metric: 'Step-by-Step', subtitle: 'Interactive In-App Walkthroughs' },
          { title: 'Security & Privacy', metric: 'SOC2 / ISO', subtitle: 'Enterprise Grade Protection' },
        ],
      };
    case 'T06':
      return {
        propertyBadge: 'Editions & Pricing · Sales & Customer 360 Matrix',
        accentHex: '#0176d3',
        SecondaryHex: '#032d60',
        heroBgGradient: ['#f8fafc', '#eff6ff'],
        announcementBanner: 'Transparent Per-User & Autonomous Conversation Pricing',
        headline: 'Flexible Editions Built for Every Stage of Growth',
        subheadline:
          'Compare Starter Suite, Pro Suite, Enterprise, Unlimited, and Einstein 1 Sales editions side by side.',
        primaryCta: 'Compare All Features',
        secondaryCta: 'Download Pricing PDF',
        cards: [
          { title: 'Starter Suite', metric: '$25/user', subtitle: 'Sales, Service & Email Outreach' },
          { title: 'Enterprise Edition', metric: '$165/user', subtitle: 'Advanced Pipeline & Workflow API' },
          { title: 'Einstein 1 Edition', metric: '$500/user', subtitle: 'Full Agentforce + Data Cloud' },
        ],
      };
    case 'T07':
      return {
        propertyBadge: 'Small Business & Starter Suite Solutions',
        accentHex: '#00a1e0',
        SecondaryHex: '#032d60',
        heroBgGradient: ['#f0f9ff', '#fefce8'],
        announcementBanner: 'Built for Growing Teams · All-in-One CRM in Minutes',
        headline: 'The Smartest CRM Suite for Small & Midsize Business',
        subheadline:
          'Find more leads, win more deals, and keep customers happy with built-in AI email templates and unified inbox.',
        primaryCta: 'Try Starter for Free',
        secondaryCta: 'See SMB Case Studies',
        cards: [
          { title: 'Onboarding Speed', metric: '5 Mins', subtitle: 'Import Contacts & Connect Email' },
          { title: 'Productivity Boost', metric: '+36%', subtitle: 'Automated Follow-Up Tasks' },
          { title: 'Built-In Commerce', metric: '1-Click', subtitle: 'Pay Links & Storefront Ready' },
        ],
      };
    case 'T08':
      return {
        propertyBadge: 'About Salesforce · Corporate Overview & Values',
        accentHex: '#032d60',
        SecondaryHex: '#0176d3',
        heroBgGradient: ['#eff6ff', '#f1f5f9'],
        announcementBanner: 'Trust · Customer Success · Innovation · Equality · Sustainability',
        headline: 'We Bring Companies and Customers Together',
        subheadline:
          'Pioneering the 1-1-1 philanthropic model, Net Zero cloud operations, and trusted enterprise AI governance.',
        primaryCta: 'Read Annual Report',
        secondaryCta: 'Global Trust Center',
        cards: [
          { title: '1-1-1 Philanthropy', metric: '$700M+', subtitle: 'Community Grants & 9M+ Hours' },
          { title: 'Net Zero Cloud', metric: '100%', subtitle: 'Renewable Energy Operations' },
          { title: 'Global Offices', metric: '89 Cities', subtitle: 'Serving 150,000+ Enterprises' },
        ],
      };
    default:
      return {
        propertyBadge: 'Salesforce: The #1 AI CRM · Customer 360',
        accentHex: '#0176d3',
        SecondaryHex: '#032d60',
        heroBgGradient: ['#eff6ff', '#dbeafe'],
        announcementBanner: 'Humans with Agents Drive Customer Success Together',
        headline: testName || 'Salesforce: The #1 AI CRM',
        subheadline:
          'Unite Sales, Service, Marketing, Commerce, and Data Cloud on one trusted autonomous AI platform.',
        primaryCta: 'Start Free Trial',
        secondaryCta: 'Watch Demos',
        cards: [
          { title: 'Agentforce AI', metric: '#1 CRM', subtitle: 'Autonomous Enterprise Agents' },
          { title: 'Data Cloud', metric: 'Zero-Copy', subtitle: 'Real-Time Customer Graph' },
          { title: 'Einstein Trust', metric: '100% Safe', subtitle: 'Enterprise Governance & Audit' },
        ],
      };
  }
}

/**
 * Generates a crisp, self-contained 1280x760 SVG webpage screenshot as a `data:image/svg+xml;utf8,...` URI.
 * When `highlightDiff` is true on `Side A`, renders the actual +14px vertical layout shift
 * caused by the staging promotional sub-banner so Side A and Side B visually demonstrate
 * what Amazon Bedrock Nova Lite (`amazon.nova-lite-v1:0`) evaluates.
 */
export function buildDomScreenshotDataUri(options: DomScreenshotOptions): string {
  const {
    testId = 'T01',
    testName = 'Salesforce Global Home & Hero Experience',
    url = 'https://www.salesforce.com/',
    side = 'A',
    highlightDiff = false,
    showOverlay = false,
    overlayText = 'AI Region: +14px vertical offset',
    httpStatus = 200,
    durationMs = 78,
    edgeHostname = 'www.salesforce.com.edgekey.net',
    edgeIp = side === 'A' ? '23.48.201.18' : '23.212.251.15',
    cacheStatus = 'TCP_HIT',
  } = options;

  const theme = resolvePageVisualTheme(url, testId, testName);
  const isShiftedStaging = Boolean(highlightDiff && side === 'A');
  const shiftY = isShiftedStaging ? 26 : 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 760" width="1280" height="760">
  <defs>
    <linearGradient id="heroGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${theme.heroBgGradient[0]}" />
      <stop offset="100%" stop-color="${theme.heroBgGradient[1]}" />
    </linearGradient>
    <linearGradient id="ctaGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${theme.accentHex}" />
      <stop offset="100%" stop-color="#0b5cab" />
    </linearGradient>
    <filter id="cardShadow" x="-4%" y="-4%" width="108%" height="112%">
      <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#032d60" flood-opacity="0.08" />
    </filter>
  </defs>

  <!-- Page Canvas -->
  <rect width="1280" height="760" fill="#f8fafc" />

  <!-- Top Global Navigation Bar -->
  <rect x="0" y="0" width="1280" height="68" fill="#ffffff" />
  <line x1="0" y1="68" x2="1280" y2="68" stroke="#e2e8f0" stroke-width="1.5" />

  <!-- Salesforce Cloud Emblem -->
  <g transform="translate(36, 14)">
    <rect x="0" y="2" width="54" height="36" rx="18" fill="#00a1e0" />
    <circle cx="18" cy="14" r="12" fill="#00a1e0" />
    <circle cx="34" cy="12" r="14" fill="#00a1e0" />
    <text x="27" y="25" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="800" fill="#ffffff" text-anchor="middle">salesforce</text>
  </g>

  <!-- Primary Nav Links -->
  <g font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="600" fill="#032d60">
    <text x="116" y="40">Products</text>
    <text x="196" y="40">Industries</text>
    <text x="284" y="40">Customers</text>
    <text x="378" y="40">Learning</text>
    <text x="458" y="40">Support</text>
    <text x="534" y="40" fill="${theme.accentHex}">Agentforce AI</text>
  </g>

  <!-- Right Nav Utility & CTA -->
  <g transform="translate(880, 16)">
    <rect x="0" y="4" width="136" height="30" rx="15" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1" />
    <text x="68" y="23" font-family="ui-monospace, monospace" font-size="11" font-weight="600" fill="#334155" text-anchor="middle">${escapeXml(testId)} · HTTP ${httpStatus}</text>
    <rect x="150" y="2" width="92" height="34" rx="6" fill="#ffffff" stroke="#0176d3" stroke-width="1.5" />
    <text x="196" y="24" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#0176d3" text-anchor="middle">Login</text>
    <rect x="252" y="2" width="116" height="34" rx="6" fill="#2e844a" />
    <text x="310" y="24" font-family="system-ui, sans-serif" font-size="13" font-weight="700" fill="#ffffff" text-anchor="middle">Try for free</text>
  </g>

  <!-- Announcement Ribbon -->
  <rect x="0" y="69" width="1280" height="36" fill="#032d60" />
  <text x="640" y="92" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="600" fill="#ffffff" text-anchor="middle">
    ✦ ${escapeXml(theme.announcementBanner)} — Explore Now →
  </text>

  ${
    isShiftedStaging
      ? `<!-- STAGING CANDIDATE EXTRA PROMO BAR CAUSING +14px VERTICAL LAYOUT SHIFT -->
  <rect x="0" y="105" width="1280" height="26" fill="#fef3c7" stroke="#f59e0b" stroke-width="1" />
  <text x="640" y="122" font-family="ui-monospace, monospace" font-size="11.5" font-weight="700" fill="#92400e" text-anchor="middle">
    [STAGING CANDIDATE BANNER] Agentforce 2.0 Autonomous AI Preview — Hero container shifted +14px vertically
  </text>`
      : ''
  }

  <!-- Hero Section Background -->
  <g transform="translate(0, ${105 + shiftY})">
    <rect x="0" y="0" width="1280" height="360" fill="url(#heroGrad)" />

    <!-- Left Column: Hero Copy & Actions -->
    <g transform="translate(56, 38)">
      <rect x="0" y="0" width="380" height="28" rx="14" fill="#ffffff" stroke="#bfdbfe" stroke-width="1.5" />
      <circle cx="16" cy="14" r="5" fill="${theme.accentHex}" />
      <text x="30" y="18" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="${theme.SecondaryHex}">
        ${escapeXml(theme.propertyBadge.slice(0, 48))}
      </text>

      <text x="0" y="74" font-family="system-ui, -apple-system, sans-serif" font-size="36" font-weight="800" fill="#032d60">
        ${escapeXml(theme.headline.slice(0, 42))}
      </text>
      ${
        theme.headline.length > 42
          ? `<text x="0" y="116" font-family="system-ui, -apple-system, sans-serif" font-size="34" font-weight="800" fill="${theme.accentHex}">
        ${escapeXml(theme.headline.slice(42, 84))}
      </text>`
          : `<text x="0" y="116" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="700" fill="${theme.accentHex}">
        Powered by Einstein 1 &amp; Autonomous Agents
      </text>`
      }

      <text x="0" y="156" font-family="system-ui, sans-serif" font-size="16" font-weight="400" fill="#334155">
        ${escapeXml(theme.subheadline.slice(0, 74))}
      </text>
      <text x="0" y="180" font-family="system-ui, sans-serif" font-size="16" font-weight="400" fill="#334155">
        ${escapeXml(theme.subheadline.slice(74, 148))}
      </text>

      <!-- Hero CTA Buttons -->
      <g transform="translate(0, 210)">
        <rect x="0" y="0" width="210" height="48" rx="8" fill="url(#ctaGrad)" filter="url(#cardShadow)" />
        <text x="105" y="30" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#ffffff" text-anchor="middle">
          ${escapeXml(theme.primaryCta)}
        </text>

        <rect x="226" y="0" width="196" height="48" rx="8" fill="#ffffff" stroke="#0176d3" stroke-width="2" />
        <text x="324" y="30" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#0176d3" text-anchor="middle">
          ${escapeXml(theme.secondaryCta)}
        </text>
      </g>
    </g>

    <!-- Right Column: Interactive Customer 360 / Agentforce Visual Preview Card -->
    <g transform="translate(740, 32)" filter="url(#cardShadow)">
      <rect x="0" y="0" width="484" height="296" rx="14" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
      <rect x="0" y="0" width="484" height="40" rx="14" fill="#032d60" />
      <circle cx="20" cy="20" r="5" fill="#ef4444" />
      <circle cx="36" cy="20" r="5" fill="#f59e0b" />
      <circle cx="52" cy="20" r="5" fill="#10b981" />
      <text x="74" y="24" font-family="ui-monospace, monospace" font-size="11.5" font-weight="600" fill="#e2e8f0">
        ${escapeXml(url.replace(/^https?:\/\//, '').slice(0, 44))}
      </text>

      <!-- Agentforce Live Telemetry Widget inside Hero Card -->
      <rect x="20" y="56" width="212" height="104" rx="10" fill="#f0f9ff" stroke="#bae6fd" stroke-width="1" />
      <text x="34" y="80" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#0369a1">AGENTFORCE COPILOT</text>
      <text x="34" y="112" font-family="system-ui, sans-serif" font-size="26" font-weight="800" fill="#032d60">99.98%</text>
      <text x="34" y="136" font-family="system-ui, sans-serif" font-size="11.5" fill="#475569">Grounded Data Cloud Resolution</text>

      <rect x="248" y="56" width="216" height="104" rx="10" fill="#f0fdf4" stroke="#bbf7d0" stroke-width="1" />
      <text x="262" y="80" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#15803d">AKAMAI EDGE CACHE</text>
      <text x="262" y="112" font-family="ui-monospace, monospace" font-size="24" font-weight="800" fill="#14532d">${escapeXml(cacheStatus)}</text>
      <text x="262" y="136" font-family="ui-monospace, monospace" font-size="11.5" fill="#475569">TTFB: ${durationMs}ms · IP ${escapeXml(edgeIp)}</text>

      <!-- Mini Chart Bars -->
      <rect x="20" y="176" width="444" height="98" rx="10" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1" />
      <text x="36" y="200" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#1e293b">
        Customer 360 Real-Time Engagement &amp; Edge Telemetry
      </text>
      <rect x="36" y="216" width="320" height="12" rx="6" fill="#0176d3" />
      <rect x="36" y="236" width="265" height="12" rx="6" fill="#00a1e0" />
      <rect x="36" y="254" width="380" height="10" rx="5" fill="#10b981" />
      <text x="448" y="226" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="#032d60" text-anchor="end">HTTP ${httpStatus}</text>
    </g>
  </g>

  <!-- 3 Feature Metric Cards Row -->
  <g transform="translate(56, ${492 + shiftY})">
    ${theme.cards
      .map(
        (card, idx) => `
    <g transform="translate(${idx * 396}, 0)" filter="url(#cardShadow)">
      <rect x="0" y="0" width="376" height="168" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" />
      <rect x="0" y="0" width="376" height="6" rx="3" fill="${idx === 0 ? theme.accentHex : idx === 1 ? '#00a1e0' : '#10b981'}" />
      <text x="24" y="42" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="#475569">
        ${escapeXml(card.title)}
      </text>
      <text x="24" y="92" font-family="system-ui, sans-serif" font-size="36" font-weight="800" fill="#032d60">
        ${escapeXml(card.metric)}
      </text>
      <text x="24" y="132" font-family="system-ui, sans-serif" font-size="13.5" font-weight="500" fill="#64748b">
        ${escapeXml(card.subtitle)}
      </text>
    </g>`
      )
      .join('')}
  </g>

  ${
    isShiftedStaging && showOverlay
      ? `<!-- BEDROCK NOVA LITE AI DIFF BOUNDING BOX OVERLAY -->
  <g>
    <rect x="40" y="102" width="1200" height="270" rx="8" fill="#f59e0b" fill-opacity="0.14" stroke="#d97706" stroke-width="3" stroke-dasharray="10 6" />
    <rect x="40" y="74" width="460" height="30" rx="6" fill="#d97706" />
    <text x="54" y="94" font-family="ui-monospace, monospace" font-size="13" font-weight="700" fill="#ffffff">
      ★ Bedrock Nova Lite Diff: ${escapeXml(overlayText)}
    </text>
  </g>`
      : ''
  }

  <!-- Bottom Edge Telemetry Footer Bar -->
  <rect x="0" y="716" width="1280" height="44" fill="#0f172a" />
  <text x="36" y="743" font-family="ui-monospace, monospace" font-size="12" font-weight="600" fill="#94a3b8">
    SYNTHETIC SNAPSHOT · ${escapeXml(testId)} · ${escapeXml(url)}
  </text>
  <text x="1244" y="743" font-family="ui-monospace, monospace" font-size="12" font-weight="600" fill="#38bdf8" text-anchor="end">
    ${side === 'A' ? 'SIDE A (CANDIDATE)' : side === 'B' ? 'SIDE B (BASELINE)' : 'CAPTURED SNAPSHOT'} · ${escapeXml(edgeHostname)} (${durationMs}ms)
  </text>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * Resolves the real 1280x760 headless Chromium JPEG screenshot URL (`/screenshots/<prop>-<testId>-side<A|B>.jpg`)
 * captured from the live salesforce.com property and served from S3 / CloudFront (`/portal-ui/screenshots/*`).
 */
export function resolveLiveScreenshotUrl(options: DomScreenshotOptions): string {
  const { testId = 'T01', url = 'https://www.salesforce.com/', side = 'A', highlightDiff = false } = options;
  const lowerUrl = (url || '').toLowerCase();
  const idUpper = (testId || 'T01').toUpperCase();

  let propId = 'www';
  if (lowerUrl.includes('login.salesforce.com')) propId = 'login';
  else if (lowerUrl.includes('developer.salesforce.com')) propId = 'developer';
  else if (lowerUrl.includes('help.salesforce.com')) propId = 'help';
  else if (lowerUrl.includes('trailhead.salesforce.com')) propId = 'trailhead';
  else if (lowerUrl.includes('status.salesforce.com')) propId = 'status';
  else if (lowerUrl.includes('appexchange.salesforce.com')) propId = 'appexchange';
  else if (lowerUrl.includes('partners.salesforce.com')) propId = 'partners';

  // For T03 when highlightDiff is active on Side A, serve sideA (with the staging edge candidate banner shift);
  // otherwise serve sideB (clean production edge render) or sideA matching the side parameter.
  const effectiveSide =
    idUpper === 'T03'
      ? side === 'A' && highlightDiff
        ? 'sideA'
        : 'sideB'
      : side === 'B'
      ? 'sideB'
      : 'sideA';

  return `/screenshots/${propId}-${idUpper}-${effectiveSide}.jpg`;
}

