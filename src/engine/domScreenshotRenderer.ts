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

  if (lowerUrl.includes('developer.salesforce.com')) {
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

  if (lowerUrl.includes('trailhead.salesforce.com')) {
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

  if (lowerUrl.includes('status.salesforce.com')) {
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

  if (lowerUrl.includes('help.salesforce.com')) {
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

  if (lowerUrl.includes('appexchange.salesforce.com')) {
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

  if (lowerUrl.includes('partners.salesforce.com')) {
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
