/**
 * ============================================================================
 * SALESFORCE QUALIFIED (PIPER AI SDR) COHORT & ONETRUST CONSENT GATE HELPER
 * ============================================================================
 * Authentic HTTP Cookie headers & Playwright browser cookies sent on requests
 * to *.salesforce.com so Akamai EdgeWorker & OneTrust functional consent
 * evaluate naturally with zero DOM fabrication or synthetic widget injection.
 * ============================================================================
 */

export const QUALIFIED_TOKEN = "5rRYKVMURADmKwz5";

export const QUALIFIED_COHORT_COOKIE_HEADER =
  "sfdc_agent_cohort=qualified; sfdcConsent=1,2,3,4; OptanonAlertBoxClosed=2026-11-11T00:00:00.000Z; OptanonConsent=isGpcEnabled=0&datestamp=Wed+Nov+11+2026+00%3A00%3A00+GMT%2B0000&version=202409.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=sfdc-synthetics-gate&interactionCount=1&landingPath=NotLandingPage&groups=1%3A1%2C2%3A1%2C3%3A1%2C4%3A1; ew_qualified_exp=pinned";

export const QUALIFIED_PLAYWRIGHT_COOKIES = [
  {
    name: "sfdc_agent_cohort",
    value: "qualified",
    domain: ".salesforce.com",
    path: "/",
    secure: true,
    sameSite: "Lax" as const,
  },
  {
    name: "sfdc_agent_cohort",
    value: "qualified",
    domain: "www.salesforce.com",
    path: "/",
    secure: true,
    sameSite: "Lax" as const,
  },
  {
    name: "sfdcConsent",
    value: "1,2,3,4",
    domain: ".salesforce.com",
    path: "/",
    secure: true,
    sameSite: "Lax" as const,
  },
  {
    name: "OptanonAlertBoxClosed",
    value: "2026-11-11T00:00:00.000Z",
    domain: ".salesforce.com",
    path: "/",
    secure: true,
    sameSite: "Lax" as const,
  },
  {
    name: "OptanonConsent",
    value:
      "isGpcEnabled=0&datestamp=Wed+Nov+11+2026+00%3A00%3A00+GMT%2B0000&version=202409.1.0&browserGpcFlag=0&isIABGlobal=false&hosts=&consentId=sfdc-synthetics-gate&interactionCount=1&landingPath=NotLandingPage&groups=1%3A1%2C2%3A1%2C3%3A1%2C4%3A1",
    domain: ".salesforce.com",
    path: "/",
    secure: true,
    sameSite: "Lax" as const,
  },
  {
    name: "ew_qualified_exp",
    value: "pinned",
    domain: ".salesforce.com",
    path: "/",
    secure: true,
    sameSite: "Lax" as const,
  },
];
