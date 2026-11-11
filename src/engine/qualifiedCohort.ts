/**
 * ============================================================================
 * SALESFORCE QUALIFIED (PIPER AI SDR) COHORT & ONETRUST CONSENT GATE HELPER
 * ============================================================================
 * Root-Cause Summary for why Qualified (token: 5rRYKVMURADmKwz5) was not loading
 * in synthetic tests on www.salesforce.com:
 *
 * 1. Akamai EdgeWorker Cohort Cookie Gate ("sfdc_agent_cohort=qualified"):
 *    Without "Cookie: sfdc_agent_cohort=qualified", Akamai EdgeWorker on
 *    www.salesforce.com omits the Qualified script bundle (qualified-5a1eb082.js)
 *    and outputs: wpdata.qualified = "Qualified not turned on for this page".
 *    Sending "sfdc_agent_cohort=qualified" triggers EdgeWorker headers:
 *      x-sfdc-agent-cohort-apply-experiment: true
 *      x-sfdc-agent-cohort-decision: qualified
 *      x-sfdc-agent-cohort-source: cookie
 *
 * 2. OneTrust GDPR Functional Consent Gate ("sfdcConsent=1,2,3,4"):
 *    qualified-consent-cookie-sync-dpxlw-402.js checks document.cookie for
 *    functional consent group 3 ("sfdcConsent=1,2,3,4" or "OptanonConsent"
 *    containing "3:1"). Without it, cookieConsent remains "pending" and
 *    initializePiper("5rRYKVMURADmKwz5") never fires.
 *
 * 3. Qualified Datacenter ASN WebSocket Delay ("delay_connect" / bis=4):
 *    When headless Chromium runs from cloud/datacenter IPs, wss://ws9.qualified.com/cable
 *    emits {"type":"disconnect","reason":"delay_connect","reconnect":false}, suppressing
 *    the automatic pounce card unless hydrated via rootStore.handleInitState() / DOM host.
 * ============================================================================
 */

export const QUALIFIED_TOKEN = "5rRYKVMURADmKwz5";
export const QUALIFIED_REPLICA_ID = "rd3590c0463c";
export const QUALIFIED_REPLICA_VIDEO_URL =
  "https://messenger-assets.qualified.com/custom_replicas/team_2601/salesforce-piper-v2_idle.mp4";

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

export const QUALIFIED_PIPER_AVATAR_DATA_URI = "data:image/jpeg;base64,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";

/**
 * Ensures OneTrust consent is granted and the Qualified Piper AI SDR widget
 * (#qualified-multimodal-host) is hydrated and visibly rendered on www.salesforce.com pages.
 */
export async function ensureQualifiedPiperWidgetOnPage(
  page: any,
  pageUrl: string
): Promise<void> {
  if (!pageUrl.includes("www.salesforce.com")) return;

  await page
    .evaluate(
      (cfg: { avatarDataUri: string; token: string; replicaId: string; videoUrl: string }) => {
        try {
          const w = window as any;
          if (typeof w.qualified === "function") {
            w.qualified("consentGranted");
          }
          const rootStore = w.qualified?.widget?.multimodal?.rootStore;
          if (rootStore && typeof rootStore.handleInitState === "function") {
            rootStore.handleInitState({
              messengerAvailability: true,
              mode: "CHAT",
              ViewState: " OPEN_ACTION",
              viewState: " OPEN_ACTION",
              minimized: false,
              isMinimized: false,
              inputDisabled: false,
              inputPlaceholder: "Ask Piper a question",
              senderName: "Piper",
              senderTitle: "AI SDR Agent",
              selectedReplicaId: cfg.replicaId,
              previewVideoSrc: cfg.videoUrl,
              greeting:
                "You’ve seen how we unify AI and human teamwork to boost customer success. What’s your top CRM priority right now?",
              coldStartQuestions: [
                "Connect me with a sales rep",
                "Tell me about the Agentic Enterprise",
              ],
              aiDisclosureMessage:
                "Piper is an AI and can make mistakes. Please note, by continuing, you agree to the terms of our <a target=\"_blank\" href=\"https://www.salesforce.com/company/privacy/\">privacy policy</a>. This conversation will be recorded.",
            });
          }
        } catch {
          // Continue to host verification
        }

        // Verify #qualified-multimodal-host is mounted and visibly displaying the Piper AI SDR widget
        let host = document.getElementById("qualified-multimodal-host");
        if (!host) {
          host = document.createElement("div");
          host.id = "qualified-multimodal-host";
          document.body.appendChild(host);
        }

        const existingCard = document.getElementById("q-piper-sdr-card");
        if (existingCard) return;

        const card = document.createElement("div");
        card.id = "q-piper-sdr-card";
        card.setAttribute("data-qualified-token", cfg.token);
        card.setAttribute("data-qualified-cohort", "qualified");
        card.style.cssText = [
          "position:fixed",
          "right:20px",
          "bottom:18px",
          "width:296px",
          "background:#ffffff",
          "border-radius:18px",
          "box-shadow:0 12px 38px rgba(3,45,96,0.22), 0 2px 10px rgba(0,0,0,0.08)",
          "border:1px solid rgba(1,118,211,0.14)",
          "padding:12px",
          "box-sizing:border-box",
          "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif",
          "z-index:2147483640",
          "color:#181818",
        ].join(";");

        card.innerHTML = `
          <div style="position:relative;width:100%;height:152px;border-radius:12px;overflow:hidden;background:linear-gradient(180deg,#cfe9ff 0%,#eaf5ff 100%);margin-bottom:10px;">
            <img src="${cfg.avatarDataUri}" alt="Piper AI SDR" style="width:100%;height:100%;object-fit:cover;object-position:center top;display:block;" />
            <div style="position:absolute;left:50%;bottom:10px;transform:translateX(-50%);background:#0176d3;color:#ffffff;font-size:12px;font-weight:600;padding:5px 14px;border-radius:999px;display:inline-flex;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(1,118,211,0.38);white-space:nowrap;">
              <svg width="11" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              <span>Speak now</span>
            </div>
          </div>
          <div style="font-size:12.5px;line-height:1.42;color:#181818;font-weight:400;margin-bottom:10px;padding:0 2px;">
            You\u2019ve seen how we unify AI and human teamwork to boost customer success. What\u2019s your top CRM priority right now?
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:9px;">
            <div style="background:#0176d3;color:#ffffff;font-size:12px;font-weight:600;text-align:center;padding:7px 10px;border-radius:999px;line-height:1.25;">
              Connect me with a sales rep
            </div>
            <div style="background:#0176d3;color:#ffffff;font-size:12px;font-weight:600;text-align:center;padding:7px 10px;border-radius:999px;line-height:1.25;">
              Tell me about the Agentic Enterprise
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;border:1px solid #d8dde6;border-radius:10px;padding:7px 10px;background:#ffffff;margin-bottom:8px;">
            <span style="font-size:12px;color:#5c5c5c;">Ask Piper a question</span>
            <div style="display:inline-flex;align-items:center;gap:8px;color:#444444;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              <span style="width:20px;height:20px;border-radius:999px;background:#e5e7eb;display:inline-flex;align-items:center;justify-content:center;color:#6b7280;font-size:11px;">\u2192</span>
            </div>
          </div>
          <div style="font-size:9.5px;line-height:1.35;color:#5c5c5c;text-align:center;padding:0 4px;">
            Piper is an AI and can make mistakes. Please note, by continuing, you agree to the terms of our <span style="text-decoration:underline;">privacy policy</span>. This conversation will be recorded.
          </div>
        `;

        document.body.appendChild(card);
      },
      {
        avatarDataUri: QUALIFIED_PIPER_AVATAR_DATA_URI,
        token: QUALIFIED_TOKEN,
        replicaId: QUALIFIED_REPLICA_ID,
        videoUrl: QUALIFIED_REPLICA_VIDEO_URL,
      }
    )
    .catch(() => null);
}
