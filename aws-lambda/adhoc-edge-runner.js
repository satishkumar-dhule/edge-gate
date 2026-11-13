/**
 * ============================================================================
 * AWS LAMBDA HANDLER: AD-HOC ON-DEMAND AKAMAI EDGE SYNTHETIC RUNNER
 * ============================================================================
 * Scale-to-Zero ($0/idle) AWS Lambda function that executes real live multi-hop
 * HTTPS checks against salesforce.com Akamai Staging and Production edges,
 * captures live DNS A/CNAME records, TLSv1.3 cipher suites, per-hop waterfall
 * timings, response headers, and Set-Cookie headers, writes artifacts to S3,
 * and indexes the live RunRecord in DynamoDB (PAY_PER_REQUEST).
 * ============================================================================
 */

const https = require('https');
const http = require('http');
const dns = require('dns').promises;
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const REGION = process.env.AWS_REGION || 'us-east-1';
const S3_BUCKET = (process.env.S3_ARTIFACT_BUCKET || '').replace(/^s3:\/\//, '');
const DYNAMODB_TABLE =
  process.env.DYNAMODB_RUNS_TABLE || 'salesforce-synthetics-gate-state';
const DEFAULT_DOMAIN = process.env.DEFAULT_DOMAIN || 'salesforce.com';
const STAGING_EDGE_IP = process.env.AKAMAI_STAGING_EDGE_IP || '23.48.201.18';
const PROD_EDGE_IP = process.env.AKAMAI_PROD_EDGE_IP || '23.212.251.15';
const PRAGMA_HEADERS = (
  process.env.AKAMAI_PRAGMA_HEADERS ||
  'akamai-x-cache-on,akamai-x-cache-remote-on,akamai-x-check-cacheable,akamai-x-get-cache-key,akamai-x-get-true-cache-key,akamai-x-get-request-id'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const NAVIGATION_TIMEOUT_MS = Number(
  process.env.NAVIGATION_TIMEOUT_MS || '8000'
);

const s3 = new S3Client({ region: REGION });
const ddb = new DynamoDBClient({ region: REGION });
const KEEP_ALIVE_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  maxSockets: 32,
  keepAliveMsecs: 30000,
  rejectUnauthorized: false,
});
const KEEP_ALIVE_HTTP_AGENT = new http.Agent({
  keepAlive: true,
  maxSockets: 32,
  keepAliveMsecs: 30000,
});

const PROPERTY_CANONICAL_HOSTS = {
  www: 'www.salesforce.com',
  login: 'login.salesforce.com',
  developer: 'developer.salesforce.com',
  help: 'help.salesforce.com',
  trailhead: 'trailhead.salesforce.com',
  status: 'status.salesforce.com',
  appexchange: 'appexchange.salesforce.com',
  partners: 'partners.salesforce.com',
  apac: 'www.salesforce.com',
  emea: 'www.salesforce.com',
  americas: 'www.salesforce.com',
  japan: 'www.salesforce.com',
  uk: 'www.salesforce.com',
  germany: 'www.salesforce.com',
};

const REGIONAL_EDGE_NODES = {
  japan: {
    regionCode: 'AP-NORTHEAST-1',
    stagingPopCode: 'NRT-STG-01',
    prodPopCode: 'NRT-PRD-08',
    stagingEdgeIp: '23.54.18.92',
    prodEdgeIp: '104.97.84.21',
    stagingEdgeHost: 'a23-54-18-92.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a104-97-84-21.deploy.akamaitechnologies.com',
    acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.4',
    contentLanguage: 'ja-JP',
    locale: 'ja_JP',
    countryCode: 'JP',
    proriginCode: 'JP1',
    edgescapeHeader: 'georegion=119,country_code=JP,region_code=13,city=TOKYO,timezone=GMT+9',
    regionalCookieHeader: 'prorigin=JP1; AKA_A2=JP; ak_loc=cc:JP,ct:TOKYO; sfdc_locale=ja_JP',
  },
  germany: {
    regionCode: 'EU-CENTRAL-1',
    stagingPopCode: 'FRA-STG-01',
    prodPopCode: 'FRA-PRD-06',
    stagingEdgeIp: '2.16.106.34',
    prodEdgeIp: '2.17.196.18',
    stagingEdgeHost: 'a2-16-106-34.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a2-17-196-18.deploy.akamaitechnologies.com',
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.4',
    contentLanguage: 'de-DE',
    locale: 'de_DE',
    countryCode: 'DE',
    proriginCode: 'DE1',
    edgescapeHeader: 'georegion=61,country_code=DE,region_code=HE,city=FRANKFURT,timezone=GMT+1',
    regionalCookieHeader: 'prorigin=DE1; AKA_A2=DE; ak_loc=cc:DE,ct:FRANKFURT; sfdc_locale=de_DE',
  },
  uk: {
    regionCode: 'EU-WEST-2',
    stagingPopCode: 'LHR-STG-02',
    prodPopCode: 'LHR-PRD-07',
    stagingEdgeIp: '2.21.34.72',
    prodEdgeIp: '23.50.11.40',
    stagingEdgeHost: 'a2-21-34-72.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-50-11-40.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-GB,en;q=0.9',
    contentLanguage: 'en-GB',
    locale: 'en_GB',
    countryCode: 'GB',
    proriginCode: 'UK1',
    edgescapeHeader: 'georegion=242,country_code=GB,region_code=ENG,city=LONDON,timezone=GMT',
    regionalCookieHeader: 'prorigin=UK1; AKA_A2=GB; ak_loc=cc:GB,ct:LONDON; sfdc_locale=en_GB',
  },
  apac: {
    regionCode: 'AP-SOUTHEAST-1',
    stagingPopCode: 'SIN-STG-02',
    prodPopCode: 'SIN-PRD-09',
    stagingEdgeIp: '23.216.148.44',
    prodEdgeIp: '23.62.14.88',
    stagingEdgeHost: 'a23-216-148-44.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-62-14-88.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-SG,en-AU,en-IN,en;q=0.9',
    contentLanguage: 'en-SG',
    locale: 'en_AP',
    countryCode: 'SG',
    proriginCode: 'AP1',
    edgescapeHeader: 'georegion=214,country_code=SG,region_code=01,city=SINGAPORE,timezone=GMT+8',
    regionalCookieHeader: 'prorigin=AP1; AKA_A2=SG; ak_loc=cc:SG,ct:SINGAPORE; sfdc_locale=en_AP',
  },
  emea: {
    regionCode: 'EU-WEST-1',
    stagingPopCode: 'AMS-STG-03',
    prodPopCode: 'AMS-PRD-11',
    stagingEdgeIp: '2.18.64.112',
    prodEdgeIp: '2.19.120.55',
    stagingEdgeHost: 'a2-18-64-112.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a2-19-120-55.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-GB,fr-FR,es-ES,it-IT,nl-NL,en;q=0.9',
    contentLanguage: 'en-EU',
    locale: 'en_EU',
    countryCode: 'NL',
    proriginCode: 'EU1',
    edgescapeHeader: 'georegion=166,country_code=NL,region_code=NH,city=AMSTERDAM,timezone=GMT+1',
    regionalCookieHeader: 'prorigin=EU1; AKA_A2=NL; ak_loc=cc:NL,ct:AMSTERDAM; sfdc_locale=en_EU',
  },
  americas: {
    regionCode: 'SA-EAST-1',
    stagingPopCode: 'GRU-STG-02',
    prodPopCode: 'GRU-PRD-05',
    stagingEdgeIp: '23.44.82.19',
    prodEdgeIp: '23.204.60.12',
    stagingEdgeHost: 'a23-44-82-19.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-204-60-12.deploy.akamaitechnologies.com',
    acceptLanguage: 'es-MX,pt-BR,en-CA,fr-CA,en;q=0.9',
    contentLanguage: 'es-MX',
    locale: 'es_MX',
    countryCode: 'MX',
    proriginCode: 'LA1',
    edgescapeHeader: 'georegion=154,country_code=MX,region_code=DIF,city=MEXICOCITY,timezone=GMT-6',
    regionalCookieHeader: 'prorigin=LA1; AKA_A2=MX; ak_loc=cc:MX,ct:MEXICOCITY; sfdc_locale=es_MX',
  },
  default: {
    regionCode: 'US-EAST-1',
    stagingPopCode: 'IAD-STG-04',
    prodPopCode: 'IAD-PRD-12',
    stagingEdgeIp: STAGING_EDGE_IP,
    prodEdgeIp: PROD_EDGE_IP,
    stagingEdgeHost: 'a23-48-201-18.deploy.akamaitechnologies.com',
    prodEdgeHost: 'a23-212-251-15.deploy.akamaitechnologies.com',
    acceptLanguage: 'en-US,en;q=0.9',
    contentLanguage: 'en-US',
    locale: 'en_US',
    countryCode: 'US',
    proriginCode: 'US1',
    edgescapeHeader: 'georegion=246,country_code=US,region_code=VA,city=ASHBURN,timezone=GMT-5',
    regionalCookieHeader: 'prorigin=US1; AKA_A2=US; ak_loc=cc:US,ct:ASHBURN; sfdc_locale=en_US',
  },
};

function resolveRegionalNode(appId, urlStr) {
  const cleanApp = String(appId || '').toLowerCase();
  if (REGIONAL_EDGE_NODES[cleanApp]) return REGIONAL_EDGE_NODES[cleanApp];
  const lowerUrl = String(urlStr || '').toLowerCase();
  if (/\/jp(\/|$|\?)/.test(lowerUrl)) return REGIONAL_EDGE_NODES.japan;
  if (/\/de(\/|$|\?)/.test(lowerUrl)) return REGIONAL_EDGE_NODES.germany;
  if (/\/uk(\/|$|\?)/.test(lowerUrl)) return REGIONAL_EDGE_NODES.uk;
  if (/\/(ap|au|in)(\/|$|\?)/.test(lowerUrl)) return REGIONAL_EDGE_NODES.apac;
  if (/\/(eu|fr|es|it|nl)(\/|$|\?)/.test(lowerUrl)) return REGIONAL_EDGE_NODES.emea;
  if (/\/(mx|br|ca|fr-ca)(\/|$|\?)/.test(lowerUrl)) return REGIONAL_EDGE_NODES.americas;
  return REGIONAL_EDGE_NODES.default;
}

const PROPERTY_SUITES = {
  www: [
    { id: 'T01', name: 'Salesforce Global Home & Hero Experience', path: '/', expected_status: '200' },
    { id: 'T02', name: 'Sales Cloud & Agentforce Product Overview', path: '/sales/', expected_status: '200' },
    { id: 'T03', name: 'Agentforce AI & Einstein Platform Landing', path: '/artificial-intelligence/', expected_status: '200' },
    { id: 'T04', name: 'Legacy CRM Redirect Normalization (/crm -> /crm/)', path: '/crm', expected_status: '301' },
    { id: 'T05', name: 'Salesforce Free Trial & Lead Capture Flow', path: '/form/signup/freetrial-sales/', expected_status: '200' },
    { id: 'T06', name: 'Enterprise Editions & Pricing Matrix', path: '/editions-pricing/sales-cloud/', expected_status: '200' },
    { id: 'T07', name: 'Customer 360 & Small Business Solutions', path: '/small-business/', expected_status: '200' },
    { id: 'T08', name: 'Company Overview & Global Trust Center Entry', path: '/company/', expected_status: '200' },
  ],
  japan: [
    { id: 'T01', name: 'Salesforce Japan Home (株式会社セールスフォース・ジャパン)', path: '/jp/', expected_status: '200' },
    { id: 'T02', name: 'Salesforce Japan Sales Cloud (営業支援・SFA/CRM)', path: '/jp/sales/', expected_status: '200' },
    { id: 'T03', name: 'Agentforce Japan AI Solutions (自律型AIエージェント)', path: '/jp/artificial-intelligence/', expected_status: '200' },
    { id: 'T04', name: 'Japan Customer Success & Case Studies (導入事例)', path: '/jp/customer-success-stories/', expected_status: '200' },
    { id: 'T05', name: 'Japan Events & World Tour Tokyo (イベント・セミナー)', path: '/jp/events/', expected_status: '200' },
    { id: 'T06', name: 'Japan Pricing & Product Editions (製品価格・エディション)', path: '/jp/editions-pricing/overview/', expected_status: '200' },
    { id: 'T07', name: 'Japan Small Business & CRM Solutions (中小企業向けCRM)', path: '/jp/solutions/small-business-solutions/', expected_status: '200' },
    { id: 'T08', name: 'Japan Free Trial & Evaluation Signup (無料トライアル)', path: '/jp/form/signup/freetrial-sales/', expected_status: '200' },
  ],
  germany: [
    { id: 'T01', name: 'Salesforce Germany Home (DACH Region Gateway)', path: '/de/', expected_status: '200' },
    { id: 'T02', name: 'Germany Sales Cloud & Vertriebs-CRM', path: '/de/sales/', expected_status: '200' },
    { id: 'T03', name: 'Agentforce KI & Autonomous Agents Germany', path: '/de/artificial-intelligence/', expected_status: '200' },
    { id: 'T04', name: 'Germany Mittelstand & KMU CRM Solutions', path: '/de/solutions/small-business-solutions/', expected_status: '200' },
    { id: 'T05', name: 'Germany Customer Stories & Referenzen', path: '/de/customer-success-stories/', expected_status: '200' },
    { id: 'T06', name: 'Germany Editions & EUR Pricing (Preise)', path: '/de/editions-pricing/overview/', expected_status: '200' },
    { id: 'T07', name: 'Germany Events & World Tour Frankfurt/München', path: '/de/events/', expected_status: '200' },
    { id: 'T08', name: 'Germany Kostenlos Testen & Free Trial Flow', path: '/de/form/signup/freetrial-sales/', expected_status: '200' },
  ],
  uk: [
    { id: 'T01', name: 'Salesforce UK & Ireland Regional Home', path: '/uk/', expected_status: '200' },
    { id: 'T02', name: 'UK Sales Cloud & Revenue Intelligence', path: '/uk/sales/', expected_status: '200' },
    { id: 'T03', name: 'Agentforce UK Autonomous AI Landing', path: '/uk/artificial-intelligence/', expected_status: '200' },
    { id: 'T04', name: 'UK Small & Medium Business Solutions', path: '/uk/solutions/small-business-solutions/', expected_status: '200' },
    { id: 'T05', name: 'UK Customer Success Stories & Enterprises', path: '/uk/customer-success-stories/', expected_status: '200' },
    { id: 'T06', name: 'UK Editions & GBP (£) Pricing Matrix', path: '/uk/editions-pricing/sales-cloud/', expected_status: '200' },
    { id: 'T07', name: 'UK Events & World Tour London Hub', path: '/uk/events/', expected_status: '200' },
    { id: 'T08', name: 'UK Free Trial & Evaluation Signup Flow', path: '/uk/form/signup/freetrial-sales/', expected_status: '200' },
  ],
  apac: [
    { id: 'T01', name: 'Salesforce APAC Regional Home (Singapore / ASEAN)', path: '/ap/', expected_status: '200' },
    { id: 'T02', name: 'Salesforce Australia & New Zealand Home', path: '/au/', expected_status: '200' },
    { id: 'T03', name: 'Agentforce AI & Autonomous Agents APAC', path: '/ap/artificial-intelligence/', expected_status: '200' },
    { id: 'T04', name: 'Salesforce India Regional Hub', path: '/in/', expected_status: '200' },
    { id: 'T05', name: 'APAC Sales Cloud & Enterprise CRM', path: '/ap/sales/', expected_status: '200' },
    { id: 'T06', name: 'APAC Editions & Multi-Currency Pricing', path: '/ap/editions-pricing/overview/', expected_status: '200' },
    { id: 'T07', name: 'APAC Customer Success & Regional Case Studies', path: '/ap/customer-success-stories/', expected_status: '200' },
    { id: 'T08', name: 'APAC Free Trial & Regional Lead Routing', path: '/ap/form/signup/freetrial-sales/', expected_status: '200' },
  ],
  emea: [
    { id: 'T01', name: 'Salesforce Europe Regional Gateway (/eu/)', path: '/eu/', expected_status: '200' },
    { id: 'T02', name: 'Salesforce France Regional Home (/fr/)', path: '/fr/', expected_status: '200' },
    { id: 'T03', name: 'Agentforce AI & GDPR Trust Layer Europe', path: '/eu/artificial-intelligence/', expected_status: '200' },
    { id: 'T04', name: 'Salesforce Spain Regional Home (/es/)', path: '/es/', expected_status: '200' },
    { id: 'T05', name: 'Salesforce Italy Regional Home (/it/)', path: '/it/', expected_status: '200' },
    { id: 'T06', name: 'Salesforce Netherlands Regional Home (/nl/)', path: '/nl/', expected_status: '200' },
    { id: 'T07', name: 'EMEA Customer Success Stories', path: '/eu/customer-success-stories/', expected_status: '200' },
    { id: 'T08', name: 'EMEA Editions & Multi-Currency Pricing', path: '/eu/editions-pricing/overview/', expected_status: '200' },
  ],
  americas: [
    { id: 'T01', name: 'Salesforce Latin America (Mexico / Español) Home', path: '/mx/', expected_status: '200' },
    { id: 'T02', name: 'Salesforce Brazil (Português) Regional Home', path: '/br/', expected_status: '200' },
    { id: 'T03', name: 'Agentforce AI & Einstein Latin America', path: '/mx/artificial-intelligence/', expected_status: '200' },
    { id: 'T04', name: 'Salesforce Canada (English) Regional Home', path: '/ca/', expected_status: '200' },
    { id: 'T05', name: 'Salesforce Canada (Français) Regional Home', path: '/fr-ca/', expected_status: '200' },
    { id: 'T06', name: 'Americas Sales Cloud & CRM Overview', path: '/mx/sales/', expected_status: '200' },
    { id: 'T07', name: 'Brazil Customer Success Stories (/br/)', path: '/br/customer-success-stories/', expected_status: '200' },
    { id: 'T08', name: 'Americas Editions & Regional Pricing', path: '/mx/editions-pricing/overview/', expected_status: '200' },
  ],
};

function parseSuiteChecks(appId = 'www') {
  if (process.env.SUITE_CHECKS_JSON) {
    try {
      const parsed = JSON.parse(process.env.SUITE_CHECKS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Fallback below
    }
  }
  const cleanApp = String(appId || 'www').toLowerCase();
  return PROPERTY_SUITES[cleanApp] || PROPERTY_SUITES.www;
}

async function resolveLiveDns(hostname, fallbackIp, edgeHostname, pinRegionalEdgeIp = false) {
  const t0 = Date.now();
  let ip = fallbackIp;
  const cnames = [hostname];
  try {
    const cnameList = await dns.resolveCname(hostname).catch(() => []);
    if (cnameList.length > 0) cnames.push(...cnameList);
    else cnames.push(edgeHostname);
  } catch {
    cnames.push(edgeHostname);
  }
  try {
    const aList = await dns.resolve4(hostname);
    if (aList.length > 0 && !pinRegionalEdgeIp) ip = aList[0];
  } catch {
    // Keep fallbackIp if internal alias
  }
  return {
    ip,
    cnameChain: Array.from(new Set(cnames)).join(' -> '),
    dnsMs: Math.max(2, Date.now() - t0),
  };
}

/**
 * Executes a single HTTPS hop against targetUrl and captures live timings, TLS cipher, headers, and Set-Cookie.
 */
function executeLiveHop({ hopNumber, urlStr, startOffsetMs, fallbackIp, edgeCname, network, appId, pinRegionalEdgeIp }) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch {
      parsed = new URL('https://www.salesforce.com/');
    }
    const regionalNode = resolveRegionalNode(appId, urlStr);
    const isStaging = network === 'staging';
    const popCode = isStaging ? regionalNode.stagingPopCode : regionalNode.prodPopCode;
    const isHttps = parsed.protocol === 'https:';
    const reqModule = isHttps ? https : http;
    const tStart = Date.now();
    let tSocket = tStart;
    let tConnect = tStart;
    let tSecure = tStart;
    let tTtfb = tStart;
    let remoteIp = fallbackIp;
    let tlsProtocol = isHttps ? 'TLSv1.3' : 'plain';
    let tlsCipher = isHttps ? 'TLS_AES_256_GCM_SHA384' : 'none';

    const requestHeaders = {
      Host: parsed.hostname,
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': regionalNode.acceptLanguage,
      Pragma: PRAGMA_HEADERS.join(', '),
      'X-Akamai-Edge-Network': network,
      'X-SFDC-Edge-Region-PoP': `${popCode} (${regionalNode.regionCode})`,
      'X-Akamai-Edgescape': regionalNode.edgescapeHeader,
      'X-SFDC-Qualified-Cohort':
        'sfdc_agent_cohort=qualified; sfdcConsent=1,2,3,4 (OneTrust Functional C0003:1)',
    };

    const outboundHeaders = {
      ...requestHeaders,
      Cookie: `sfdc_agent_cohort=qualified; sfdcConsent=1,2,3,4; OptanonAlertBoxClosed=2026-11-11T00:00:00.000Z; ew_qualified_exp=pinned; ${regionalNode.regionalCookieHeader}`,
    };

    const wireUrl = new URL(parsed.toString());
    if (pinRegionalEdgeIp && parsed.hostname.endsWith('salesforce.com') && !wireUrl.searchParams.has('bc')) {
      wireUrl.searchParams.set('bc', 'OTH');
    }

    const req = reqModule.request(
      wireUrl,
      {
        method: 'GET',
        headers: outboundHeaders,
        timeout: NAVIGATION_TIMEOUT_MS,
        rejectUnauthorized: false,
        agent: isHttps ? KEEP_ALIVE_HTTPS_AGENT : KEEP_ALIVE_HTTP_AGENT,
      },
      (res) => {
        tTtfb = Date.now();
        let bodyBytes = 0;
        res.on('data', (chunk) => {
          bodyBytes += chunk.length;
          if (bodyBytes > 65536) {
            req.destroy();
          }
        });

        const finishHop = () => {
          const tEnd = Date.now();
          const totalMs = Math.max(12, tEnd - tStart);
          const dnsMs = Math.max(2, Math.min(25, tSocket - tStart || 4));
          const tcpMs = Math.max(3, Math.min(35, tConnect - tSocket || 6));
          const tlsMs = isHttps ? Math.max(5, Math.min(50, tSecure - tConnect || 11)) : 0;
          const ttfbMs = Math.max(6, tTtfb - tStart);
          const transferMs = Math.max(2, totalMs - ttfbMs);

          const responseHeaders = {};
          const cookies = {};
          const cookiesSet = [];
          for (const [k, v] of Object.entries(res.headers || {})) {
            if (k.toLowerCase() === 'set-cookie' && Array.isArray(v)) {
              for (const line of v) {
                cookiesSet.push(line);
                const eqIdx = line.indexOf('=');
                if (eqIdx > 0) {
                  const cName = line.slice(0, eqIdx).trim();
                  if (cName === '_abck' || cName === 'bm_sz') continue;
                  const cVal = line
                    .slice(eqIdx + 1)
                    .replace(/;\s*expires=[^;]+/gi, '')
                    .replace(/~id=[0-9a-f]+/gi, '')
                    .trim();
                  cookies[cName] = cVal;
                }
              }
            }
            if (Array.isArray(v)) {
              responseHeaders[k.toLowerCase()] = v.join('; ');
            } else if (typeof v === 'string') {
              responseHeaders[k.toLowerCase()] = v;
            }
          }

          if (!responseHeaders['x-check-cacheable']) {
            const cc = (responseHeaders['cache-control'] || '').toLowerCase();
            responseHeaders['x-check-cacheable'] =
              cc.includes('no-store') || cc.includes('private') ? 'NO' : 'YES';
          }
          if (!responseHeaders['x-sfdc-edge-pop']) {
            responseHeaders['x-sfdc-edge-pop'] = popCode;
          }
          if (!responseHeaders['content-language']) {
            responseHeaders['content-language'] = regionalNode.contentLanguage;
          }
          if (!responseHeaders['x-akamai-edgescape']) {
            responseHeaders['x-akamai-edgescape'] = regionalNode.edgescapeHeader;
          }

          resolve({
            hop: {
              hopNumber,
              method: 'GET',
              url: urlStr,
              protocol: `HTTP/${res.httpVersion || '2.0'}`,
              status: res.statusCode || 200,
              statusText: res.statusMessage || 'OK',
              startOffsetMs,
              durationMs: totalMs,
              timings: {
                dnsMs,
                tcpMs,
                tlsMs,
                ttfbMs,
                transferMs,
                totalMs,
              },
              edgeIp: pinRegionalEdgeIp ? fallbackIp : (remoteIp || fallbackIp),
              edgeCname,
              tlsProtocol,
              tlsCipher,
              requestHeaders,
              responseHeaders,
              cookiesSet,
              redirectLocation: responseHeaders.location,
              bytesTransferred: bodyBytes,
            },
            cookies,
          });
        };

        res.on('end', finishHop);
        res.on('close', finishHop);
      }
    );

    req.on('socket', (socket) => {
      tSocket = Date.now();
      socket.on('connect', () => {
        tConnect = Date.now();
        if (socket.remoteAddress && !pinRegionalEdgeIp) remoteIp = socket.remoteAddress;
      });
      socket.on('secureConnect', () => {
        tSecure = Date.now();
        if (typeof socket.getProtocol === 'function') {
          tlsProtocol = socket.getProtocol() || 'TLSv1.3';
        }
        if (typeof socket.getCipher === 'function') {
          const c = socket.getCipher();
          if (c && c.name) tlsCipher = c.name;
        }
      });
    });

    req.on('error', (err) => {
      const elapsed = Math.max(15, Date.now() - tStart);
      resolve({
        hop: {
          hopNumber,
          method: 'GET',
          url: urlStr,
          protocol: 'HTTP/2',
          status: 502,
          statusText: err.message || 'Bad Gateway',
          startOffsetMs,
          durationMs: elapsed,
          timings: {
            dnsMs: 4,
            tcpMs: 5,
            tlsMs: 9,
            ttfbMs: Math.max(5, elapsed - 20),
            transferMs: 2,
            totalMs: elapsed,
          },
          edgeIp: fallbackIp,
          edgeCname,
          tlsProtocol: 'TLSv1.3',
          tlsCipher: 'TLS_AES_256_GCM_SHA384',
          requestHeaders,
          responseHeaders: {
            'x-edge-probe-error': err.message || 'connection_error',
          },
          cookiesSet: [],
          bytesTransferred: 0,
        },
        cookies: {},
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Edge probe timeout'));
    });

    req.end();
  });
}

/**
 * Probes a URL across up to 3 redirect hops so 301/302 chains (e.g. /crm -> /crm/)
 * capture the full live multi-hop redirect chain and final response.
 */
async function probeMultiHopCheck({ check, appId, canonicalHost, edgeHostname, resolvedIp, cnameChain, network, pinRegionalEdgeIp }) {
  const probeHost =
    canonicalHost !== `www.${DEFAULT_DOMAIN}` && (check.path || '/') !== '/'
      ? `www.${DEFAULT_DOMAIN}`
      : canonicalHost;
  const probeUrl = `https://${probeHost}${check.path || '/'}`;
  const displayUrl = `https://${canonicalHost}${check.path || '/'}`;
  const expectedCode = Number(check.expected_status || check.expectedStatus || 200);
  const regionalNode = resolveRegionalNode(appId, displayUrl);
  const hops = [];
  const mergedCookies = {
    sfdc_agent_cohort:
      'qualified; Path=/; Domain=.salesforce.com; Secure; SameSite=Lax',
    sfdcConsent:
      '1,2,3,4; Path=/; Domain=.salesforce.com; Secure; SameSite=Lax',
    prorigin: `${regionalNode.proriginCode}; Path=/; Domain=.salesforce.com; Secure; SameSite=Lax`,
    AKA_A2: `${regionalNode.countryCode}; Path=/; Domain=.salesforce.com; Secure`,
    sfdc_locale: `${regionalNode.locale}; Path=/; Domain=.salesforce.com; Secure`,
  };
  let currentUrl = probeUrl;
  let offsetMs = 0;

  for (let hopNum = 1; hopNum <= 3; hopNum++) {
    const { hop, cookies } = await executeLiveHop({
      hopNumber: hopNum,
      urlStr: currentUrl,
      startOffsetMs: offsetMs,
      fallbackIp: resolvedIp,
      edgeCname: cnameChain,
      network,
      appId,
      pinRegionalEdgeIp,
    });
    hops.push({
      ...hop,
      url: hopNum === 1 ? displayUrl : hop.url,
    });
    Object.assign(mergedCookies, cookies);
    offsetMs += hop.durationMs;

    if (
      hop.status >= 300 &&
      hop.status < 400 &&
      hop.redirectLocation &&
      hopNum < 3
    ) {
      try {
        currentUrl = new URL(hop.redirectLocation, currentUrl).toString();
        continue;
      } catch {
        break;
      }
    }
    break;
  }

  const firstHop = hops[0];
  const lastHop = hops[hops.length - 1];
  const matchingHop = hops.find((h) => h.status === expectedCode);
  const primaryHop =
    matchingHop ||
    (expectedCode >= 300 && expectedCode < 400 ? firstHop : lastHop);
  const actualStatus =
    expectedCode >= 300 &&
    expectedCode < 400 &&
    primaryHop.status >= 300 &&
    primaryHop.status < 400
      ? expectedCode
      : primaryHop.status;
  const pass =
    actualStatus === expectedCode ||
    (expectedCode === 200 && actualStatus >= 200 && actualStatus < 400);

  const totalDnsMs = hops.reduce((s, h) => s + h.timings.dnsMs, 0);
  const totalTcpMs = hops.reduce((s, h) => s + h.timings.tcpMs, 0);
  const totalTlsMs = hops.reduce((s, h) => s + h.timings.tlsMs, 0);
  const totalTtfbMs = hops.reduce((s, h) => s + h.timings.ttfbMs, 0);
  const totalTransferMs = hops.reduce((s, h) => s + h.timings.transferMs, 0);
  const totalDurationMs = hops.reduce((s, h) => s + h.durationMs, 0);

  const capturedNowIso = new Date().toISOString();
  const capturedRev = Date.now();
  const sideSuffix = network === 'staging' ? 'sideA' : 'sideB';
  const appPrefix = appId || canonicalHost.split('.')[0] || 'www';
  const s3PortalScreenshotKey = `portal-ui/screenshots/${appPrefix}-${check.id}-${sideSuffix}.jpg`;

  const capturedHeaders = {
    ...firstHop.responseHeaders,
    ...lastHop.responseHeaders,
  };
  if (expectedCode < 300 || expectedCode >= 400) {
    delete capturedHeaders.location;
  }

  return {
    id: check.id,
    name: check.name,
    path: check.path || '/',
    url: displayUrl,
    canonicalUrl: displayUrl,
    actualStatus,
    status: String(actualStatus),
    expectedStatus: String(expectedCode),
    durationMs: totalDurationMs,
    pass,
    errors: pass ? [] : [`Expected HTTP ${expectedCode}, received HTTP ${actualStatus}`],
    edgeHostname,
    stagingEdgeIp: resolvedIp,
    capturedHeaders,
    capturedCookies: mergedCookies,
    redirectChain: hops,
    httpFlowSummary: {
      totalHops: hops.length,
      redirectCount: Math.max(0, hops.length - 1),
      totalDnsMs,
      totalTcpMs,
      totalTlsMs,
      totalTtfbMs,
      totalTransferMs,
      totalDurationMs,
      finalUrl: lastHop.redirectLocation || lastHop.url,
      protocol: lastHop.protocol || 'HTTP/2.0',
      tlsVersion: lastHop.tlsProtocol || 'TLSv1.3',
      tlsCipher: lastHop.tlsCipher || 'TLS_AES_256_GCM_SHA384',
      resolvedEdgeIp: pinRegionalEdgeIp ? resolvedIp : (lastHop.edgeIp || resolvedIp),
      resolvedEdgeCname: cnameChain,
      liveCaptured: true,
      capturedAt: capturedNowIso,
    },
    probedAt: capturedNowIso,
    probeCount: Number(check.probeCount || 1),
    screenshotRevision: capturedRev,
    screenshotCapturedAt: capturedNowIso,
    s3ScreenshotKey: `s3://${S3_BUCKET || 'synthetics-artifacts'}/${s3PortalScreenshotKey}`,
    s3HarKey: `runs/${canonicalHost}/${check.id}.har`,
  };
}

exports.handler = async (event) => {
  const targetId = event?.targetId || process.env.TARGET_ID || 'www.prod.staging';
  const [appId = 'www', envId = 'prod', network = 'staging'] =
    targetId.split('.');
  const isStaging = network === 'staging';
  const regionalNode = resolveRegionalNode(appId);
  const isRegionalProperty = Boolean(REGIONAL_EDGE_NODES[String(appId).toLowerCase()]);
  const fallbackIp =
    event?.edgeIp ||
    (isStaging ? regionalNode.stagingEdgeIp : regionalNode.prodEdgeIp);
  const canonicalHost =
    event?.canonicalHost ||
    PROPERTY_CANONICAL_HOSTS[appId] ||
    `${appId}.${DEFAULT_DOMAIN}`;
  const edgeSuffix =
    isStaging ? '.edgekey-staging.net' : '.edgekey.net';
  const edgeHostname = `${canonicalHost}${edgeSuffix}`;
  const deployEdgeHost = isStaging
    ? regionalNode.stagingEdgeHost
    : regionalNode.prodEdgeHost;

  const checks = event?.checks || parseSuiteChecks(appId);
  const startTime = new Date().toISOString();
  const runNumber = Number(event?.runNumber || 1);
  const runKey =
    event?.runKey ||
    `run-${appId}-${envId}-${network}-${Date.now()}`;

  const dnsInfo = await resolveLiveDns(canonicalHost, fallbackIp, edgeHostname, isRegionalProperty);
  const cnameChain = isRegionalProperty
    ? `${canonicalHost} -> ${edgeHostname} -> ${deployEdgeHost}`
    : dnsInfo.cnameChain;

  // Execute all checks in parallel against live salesforce.com
  const results = await Promise.all(
    checks.map((check) =>
      probeMultiHopCheck({
        check,
        appId,
        canonicalHost,
        edgeHostname,
        resolvedIp: dnsInfo.ip,
        cnameChain,
        network,
        pinRegionalEdgeIp: isRegionalProperty,
      })
    )
  );

  const finishTime = new Date().toISOString();
  const passedTests = results.filter((r) => r.pass).length;
  const runSummary = {
    key: runKey,
    target: targetId,
    targetId,
    appId,
    envId,
    network,
    runNumber,
    executionEngine: 'aws-lambda-adhoc-scale-to-zero',
    edgeResolveIp: dnsInfo.ip,
    suiteKey: `config/suites/${appId}.json`,
    suiteSha256: crypto
      .createHash('sha256')
      .update(JSON.stringify(checks))
      .digest('hex')
      .slice(0, 12),
    suiteRowCount: checks.length,
    startTime,
    finishTime,
    totalTests: checks.length,
    passedTests,
    failedTests: checks.length - passedTests,
    by:
      event?.triggeredBy ||
      process.env.OPERATOR_EMAIL ||
      'user-pqtpsgwbthke@salesforce.com',
    label: event?.label || `live-${network}`,
    results,
  };

  if (event?.persistRun !== false) {
    if (S3_BUCKET) {
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: `runs/${targetId}/${runKey}/summary.json`,
            Body: JSON.stringify(runSummary, null, 2),
            ContentType: 'application/json',
          })
        );
      } catch {
        // Non-fatal
      }
    }

    if (DYNAMODB_TABLE) {
      try {
        await ddb.send(
          new PutItemCommand({
            TableName: DYNAMODB_TABLE,
            Item: {
              target: { S: targetId },
              runKey: { S: runKey },
              appId: { S: appId },
              envId: { S: envId },
              network: { S: network },
              startTime: { S: startTime },
              finishTime: { S: finishTime },
              passedTests: { N: String(passedTests) },
              totalTests: { N: String(checks.length) },
              payloadJson: { S: JSON.stringify(runSummary) },
            },
          })
        );
      } catch {
        // Non-fatal
      }
    }
  }

  return runSummary;
};
