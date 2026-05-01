const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const { createClient } = require("./utils/httpClient");
const { fetchOtpWithRetry } = require("./utils/otpFetcher");
const { generateSentinelTokens } = require("./utils/sentinelToken");
const initCycleTLS = require("cycletls");
const logger = require("./utils/logger");
const { askTelegram } = require("./telegramHandler");
const readline = require("readline");
const { fetchGopayOtp, triggerMacrodroidWebhook, waitForGopayReset } = require("./utils/gopayOtpFetcher");
// --- Fingerprint Pool (dipilih acak per-instance untuk menghindari deteksi massal) ---
const FINGERPRINT_POOL = [
  { // Chrome 147 Windows
    ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
    h2: "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    sec: "\x22Chromium\x22;v=\x22147\x22, \x22Not/A)Brand\x22;v=\x2224\x22, \x22Google Chrome\x22;v=\x22147\x22",
    build: "5674830",
  },
  { // Chrome 136 Windows
    ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
    h2: "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    sec: "\x22Chromium\x22;v=\x22136\x22, \x22Not/A)Brand\x22;v=\x2224\x22, \x22Google Chrome\x22;v=\x22136\x22",
    build: "5501483",
  },
  { // Chrome 135 Windows
    ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
    h2: "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    sec: "\x22Chromium\x22;v=\x22135\x22, \x22Not/A)Brand\x22;v=\x2224\x22, \x22Google Chrome\x22;v=\x22135\x22",
    build: "5341033",
  },
  { // Chrome 134 Windows
    ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
    h2: "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    sec: "\x22Chromium\x22;v=\x22134\x22, \x22Not/A)Brand\x22;v=\x2224\x22, \x22Google Chrome\x22;v=\x22134\x22",
    build: "5195226",
  },
  { // Chrome 135 macOS
    ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
    h2: "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    sec: "\x22Chromium\x22;v=\x22135\x22, \x22Not/A)Brand\x22;v=\x2224\x22, \x22Google Chrome\x22;v=\x22135\x22",
    build: "5341033",
  },
];
function pickFingerprint() {
  return FINGERPRINT_POOL[Math.floor(Math.random() * FINGERPRINT_POOL.length)];
}
const BASE_CHATGPT = "https://chatgpt.com";
const BASE_AUTH = "https://auth.openai.com";
const STRIPE_API = "https://api.stripe.com";
const MIDTRANS_API = "https://app.midtrans.com";
const GOPAY_MERCHANTS_APP = "https://merchants-gws-app.gopayapi.com";
const GOPAY_GWA_API = "https://gwa.gopayapi.com";
const GOPAY_CUSTOMER_API = "https://customer.gopayapi.com";
const GOPAY_PIN_CLIENT_ID = "51b5f09a-3813-11ee-be56-0242ac120002-MGUPA";
const STRIPE_PK =
  "pk_live_51HOrSwC6h1nxGoI3lTAgRjYVrz4dU3fVOabyCcKR3pbEJguCVAlqCxdxCUvoRh1XWwRacViovU3kLKvpkjh7IqkW00iXQsjo3n";
const STRIPE_VERSION =
  "2025-03-31.basil; checkout_server_update_beta=v1; checkout_manual_approval_preview=v1";
const INDONESIA_CITIES = [
  { city: "Jakarta Pusat", state: "DKI Jakarta", postalBase: 0x65 },
  { city: "Jakarta Selatan", state: "DKI Jakarta", postalBase: 0x79 },
  { city: "Jakarta Barat", state: "DKI Jakarta", postalBase: 0x72 },
  { city: "Jakarta Timur", state: "DKI Jakarta", postalBase: 0x82 },
  { city: "Surabaya", state: "East Java", postalBase: 0x259 },
  { city: "Bandung", state: "West Java", postalBase: 0x191 },
  { city: "Medan", state: "North Sumatra", postalBase: 0xc9 },
  { city: "Semarang", state: "Central Java", postalBase: 0x1f5 },
  { city: "Makassar", state: "South Sulawesi", postalBase: 0x385 },
  { city: "Palembang", state: "South Sumatra", postalBase: 0x12d },
  { city: "Denpasar", state: "Bali", postalBase: 0x321 },
  { city: "Yogyakarta", state: "DI Yogyakarta", postalBase: 0x227 },
  { city: "Malang", state: "East Java", postalBase: 0x28b },
  { city: "Bogor", state: "West Java", postalBase: 0xa1 },
  { city: "Tangerang", state: "Banten", postalBase: 0x97 },
  { city: "Depok", state: "West Java", postalBase: 0xa4 },
  { city: "Bekasi", state: "West Java", postalBase: 0xab },
  { city: "Solo", state: "Central Java", postalBase: 0x23b },
  { city: "Balikpapan", state: "East Kalimantan", postalBase: 0x2f9 },
  { city: "Manado", state: "North Sulawesi", postalBase: 0x3b7 },
];
const STREET_NAMES = [
  "Jl. Merdeka",
  "Jl. Sudirman",
  "Jl. Thamrin",
  "Jl. Gatot Subroto",
  "Jl. Ahmad Yani",
  "Jl. Diponegoro",
  "Jl. Imam Bonjol",
  "Jl. Hayam Wuruk",
  "Jl. Gajah Mada",
  "Jl. Pemuda",
  "Jl. Pahlawan",
  "Jl. Veteran",
  "Jl. Kartini",
  "Jl. Pattimura",
  "Jl. Cendrawasih",
  "Jl. Mawar",
  "Jl. Melati",
  "Jl. Kenanga",
  "Jl. Anggrek",
  "Jl. Dahlia",
  "Jl. Mangga",
  "Jl. Rambutan",
  "Jl. Durian",
  "Jl. Kelapa",
  "Jl. Kebon Jeruk",
  "Jl. Tebet Raya",
  "Jl. Raya Bogor",
  "Jl. Raya Serpong",
  "Jl. Sisingamangaraja",
  "Jl. Pangeran Antasari",
  "Jl. Wolter Monginsidi",
  "Jl. Letjen S. Parman",
];
const KOMPLEK_NAMES = [
  "Perumahan Griya Indah",
  "Komplek Taman Sari",
  "Perumahan Bumi Asri",
  "Green Residence",
  "Grand Mansion",
  "Taman Permata",
  "Villa Bukit Mas",
  "Puri Kencana",
  "Graha Sentosa",
  "Citra Garden",
];
const FIRST_NAMES = [
  "Andi",
  "Budi",
  "Citra",
  "Dewi",
  "Eko",
  "Fitri",
  "Gunawan",
  "Hendra",
  "Irfan",
  "Joko",
  "Kartika",
  "Lina",
  "Mega",
  "Nadia",
  "Putri",
  "Rizki",
  "Sari",
  "Tono",
  "Udin",
  "Wati",
  "Yusuf",
  "Zahra",
  "Agus",
  "Bambang",
  "Dian",
  "Fajar",
  "Gilang",
  "Hani",
  "Indra",
  "Kurnia",
];
const LAST_NAMES = [
  "Pratama",
  "Saputra",
  "Nugraha",
  "Permana",
  "Hidayat",
  "Wijaya",
  "Santoso",
  "Purnomo",
  "Wibowo",
  "Kusuma",
  "Setiawan",
  "Rahayu",
  "Susanto",
  "Handoko",
  "Hartono",
  "Darmawan",
  "Suryadi",
  "Lestari",
  "Suharto",
  "Mulyadi",
];
function randomItem(a) {
  return a[Math.floor(Math.random() * a.length)];
}
function randomInt(a, b) {
  return Math.floor(Math.random() * (b - a + 0x1)) + a;
}
function generateRandomName() {
  return randomItem(FIRST_NAMES) + " " + randomItem(LAST_NAMES);
}
function generateBillingAddress(a) {
  const b = randomItem(INDONESIA_CITIES);
  const c = String(b.postalBase) + String(randomInt(0xa, 0x63));
  const d = randomItem(STREET_NAMES);
  const e = randomInt(0x1, 0xfa);
  const f = String(randomInt(0x1, 0x14)).padStart(0x2, "0");
  const g = String(randomInt(0x1, 0xf)).padStart(0x2, "0");
  const h = [
    d + " No." + e + " RT" + f + "/RW" + g,
    d + " No." + e,
    d +
    " No." +
    e +
    ", Blok " +
    String.fromCharCode(0x41 + randomInt(0x0, 0x7)) +
    randomInt(0x1, 0x1e),
    randomItem(KOMPLEK_NAMES) + ", " + d + " No." + e,
    d + " No." + e + " RT" + f + "/RW" + g + ", Kel. " + b.city,
  ];
  const i = Math.random() > 0.3 ? generateRandomName() : a;
  return {
    name: i,
    country: "ID",
    line1: randomItem(h),
    city: b.city,
    state: b.state,
    postal_code: c,
  };
}
async function getUserInput(a) {
  return await askTelegram(a, "");
}
function sleep(a) {
  return new Promise((b) => setTimeout(b, a));
}
class LoginCookieJar {
  constructor() {
    this.store = new Map();
  }
  capture(a, b) {
    const c = new URL(b).hostname;
    const d = a?.["Set-Cookie"] || a?.["set-cookie"];
    if (!d) return;
    const e = Array.isArray(d) ? d : [d];
    for (const f of e) {
      const g = f.match(/^([^=]+)=([^;]*)/);
      if (!g) continue;
      const h = g[0x1].trim();
      const i = g[0x2];
      const j = f.match(/[;]\s*[Dd]omain=\.?([^;,\s]+)/i);
      const k = j ? j[0x1].toLowerCase() : c;
      if (!this.store.has(k)) this.store.set(k, new Map());
      this.store.get(k).set(h, i);
    }
  }
  headerFor(a) {
    const b = new URL(a).hostname;
    const c = [];
    for (const [d, e] of this.store) {
      if (
        b === d ||
        b.endsWith("." + d) ||
        d.endsWith("." + b) ||
        b.includes(d)
      ) {
        for (const [f, g] of e) c.push(f + "=" + g);
      }
    }
    return c.length ? c.join("; ") : undefined;
  }
}
class ChatGPTAutopay {
  constructor(a) {
    this.email = a.email;
    this.password = a.password;
    this.name = a.name;
    this.deviceId = a.deviceId || uuidv4();
    // Pilih fingerprint acak per-instance
    const _fp = pickFingerprint();
    this._ja3 = _fp.ja3;
    this._h2 = _fp.h2;
    this._ua = _fp.ua;
    this._sec = _fp.sec;
    this._build = _fp.build;
    this.sessionId = uuidv4();
    this.stripeJsId = uuidv4();
    this.tag = a.threadId ? " \u001b[36m[#" + a.threadId + (this.email ? " | " + this.email : "") + "]\u001b[0m " : "";
    this.clientId = a.clientId || "app_X8zY6vW2pQ9tR3dE7nK1jL5gH";
    this.redirectUri =
      a.redirectUri || "https://chatgpt.com/api/auth/callback/openai";
    this.audience = a.audience || "https://api.openai.com/v1";
    this.otpConfig = { provider: "manual" };
    this.gopayPhone = a.gopayPhone;
    this.gopayPin = a.gopayPin;
    this.serverNumber = a.serverNumber || '1';
    this.webhookAction = a.webhookAction || 'reset-link';
    this.onAcquireGopay = a.onAcquireGopay || null;
    this.onReleaseGopay = a.onReleaseGopay || null;
    this.skipOtp = a.skipOtp || ![];
    this.skipLogin = a.skipLogin || ![];
    this.earlyReleaseFn = a.earlyReleaseFn || null;

    // Sticky session proxy for DataImpulse (unik per task, mencegah shared connection)
    const sessionToken = this.sessionId.substring(0, 8);

    const rawKoreaProxy = process.env.KOREA_PROXY_URL || null;
    if (rawKoreaProxy && rawKoreaProxy.includes('gw.dataimpulse.com')) {
      this.koreaProxyUrl = rawKoreaProxy.replace(/:\/\/([^/:]+):([^/@]+)@/, `://$1__session-${sessionToken}k:$2@`);
    } else {
      this.koreaProxyUrl = rawKoreaProxy;
    }

    const rawGeneralProxy = process.env.GENERAL_PROXY_URL || null;
    if (rawGeneralProxy && rawGeneralProxy.includes('gw.dataimpulse.com')) {
      this.generalProxyUrl = rawGeneralProxy.replace(/:\/\/([^/:]+):([^/@]+)@/, `://$1__session-${sessionToken}:$2@`);
    } else {
      this.generalProxyUrl = rawGeneralProxy;
    }
    
    this.proxyUrl = this.generalProxyUrl;
    this.loginProxyUrl =
      a.loginProxyUrl !== undefined ? a.loginProxyUrl : this.proxyUrl;
    this.sharedCycleTLS = a.sharedCycleTLS || null;
    this.otpFn = a.otpFn || null;
    const { client: b, jar: c } = createClient(this.proxyUrl);
    this.client = b;
    this.jar = c;
    if (this.loginProxyUrl !== this.proxyUrl) {
      const { client: h, jar: i } = createClient(this.loginProxyUrl);
      this.loginClient = h;
      this.loginJar = i;
    } else {
      this.loginClient = this.client;
      this.loginJar = this.jar;
    }
    const sgpProxy = process.env.SGP_PROXY_URL || this.proxyUrl;
    const { client: d, jar: e } = createClient(sgpProxy);
    this.stripeClient = d;
    this.stripeJar = e;
    
    // Midtrans menggunakan General Proxy (DataImpulse) karena SGP (SwiftProxy) kena blok 502 WAF Midtrans.
    const generalProxy = this.proxyUrl || process.env.GENERAL_PROXY_URL;
    const { client: f, jar: g } = createClient(generalProxy);
    this.midtransClient = f;
    this.midtransJar = g;
    this.checkoutSessionId = null;
    this.publishableKey = null;
    this.paymentMethodId = null;
    this.midtransSnapId = null;
    this.gopayReference = null;
    this.stripeReturnNonce = null;
    this.accessToken = a.accessToken || null;
    this.buildNumber = this._build || "5674830";
    this.clientVersion = "prod-6ee9d1a31e859a475cea92af39e34971bf5582c6";
    this._cycleTLS = null;
    this._oaiJar = null;
  }
  _oaiHeaders() {
    const a = {
      "Content-Type": "application/json",
      "oai-device-id": this.deviceId,
      "oai-session-id": this.sessionId,
      "oai-client-build-number": this.buildNumber,
      "oai-client-version": this.clientVersion,
      "oai-language": "en-US",
      Origin: BASE_CHATGPT,
      Referer: BASE_CHATGPT + "/",
    };
    if (this.accessToken) {
      a.Authorization = "Bearer " + this.accessToken;
    }
    return a;
  }
  _parseBody(a) {
    if (typeof a === "object") return a;
    try {
      return JSON.parse(a);
    } catch {
      return a;
    }
  }
  _cycleTlsOpts(a, b = {}) {
    const c = this._oaiJar?.headerFor(a);
    return {
      ja3: this._ja3,
      http2Fingerprint: this._h2,
      userAgent: this._ua,
      timeout: 0x3c,
      proxy: this.proxyUrl || undefined,
      disableRedirect: !![],
      enableConnectionReuse: !![],
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": this._sec,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\x22Windows\x22",
        ...(c ? { Cookie: c } : {}),
        ...b,
      },
    };
  }
  async _oaiGet(a, b = {}, proxy = null) {
    const c = this._cycleTlsOpts(a, {
      Accept: "application/json",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...this._oaiHeaders(),
      ...b,
    });
    if (proxy) c.proxy = proxy;
    const d = await this._cycleTLS(a, c, "get");
    this._oaiJar.capture(d.headers, d.finalUrl || a);
    return {
      status: d.status,
      data: this._parseBody(d.data),
      headers: d.headers,
    };
  }
  async _oaiPost(a, b, c = {}, proxy = null) {
    const d = this._cycleTlsOpts(a, {
      Accept: "application/json",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...this._oaiHeaders(),
      ...c,
    });
    if (proxy) d.proxy = proxy;
    d.body = typeof b === "string" ? b : JSON.stringify(b);
    const e = await this._cycleTLS(a, d, "post");
    this._oaiJar.capture(e.headers, e.finalUrl || a);
    return {
      status: e.status,
      data: this._parseBody(e.data),
      headers: e.headers,
    };
  }
  async _oaiGetHtml(a, b = {}) {
    const c = this._cycleTlsOpts(a, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      ...b,
    });
    const d = await this._cycleTLS(a, c, "get");
    this._oaiJar.capture(d.headers, d.finalUrl || a);
    return { status: d.status, data: d.data, headers: d.headers };
  }
  async cleanup() {
    if (this._cycleTLS && !this.sharedCycleTLS) {
      try {
        await this._cycleTLS.exit();
      } catch { }
    }
  }
  _midtransHeaders() {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-source": "snap",
      "x-source-app-type": "redirection",
      "x-source-version": "2.3.0",
      "x-request-id": uuidv4(),
      Origin: MIDTRANS_API,
    };
  }
  async loginToChatGPT() {
    this._cycleTLS = this.sharedCycleTLS || (await initCycleTLS());
    const a = this.loginProxyUrl || this.proxyUrl || "";
    this._oaiJar = new LoginCookieJar();
    const b = this._oaiJar;
    const c = (j, k = {}) => {
      const l = b.headerFor(j);
      return {
        ja3: this._ja3,
        http2Fingerprint: this._h2,
        userAgent: this._ua,
        timeout: 0x3c,
        proxy: a || undefined,
        disableRedirect: !![],
        enableConnectionReuse: !![],
        headers: {
          "Accept-Language": "en-US,en;q=0.9",
          "sec-ch-ua": this._sec,
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": "\x22Windows\x22",
          ...(l ? { Cookie: l } : {}),
          ...k,
        },
      };
    };
    const d = async (j, k = {}) => {
      const l = c(j, {
        Accept: "application/json",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        ...k,
      });
      const m = await this._cycleTLS(j, l, "get");
      b.capture(m.headers, m.finalUrl || j);
      return m;
    };
    const f = async (j, k = {}) => {
      const l = c(j, {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        ...k,
      });
      const m = await this._cycleTLS(j, l, "get");
      b.capture(m.headers, m.finalUrl || j);
      return m;
    };
    const g = async (j, k, l = {}) => {
      const m = c(j, {
        Accept: "application/json",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        ...l,
      });
      m.body = typeof k === "string" ? k : JSON.stringify(k);
      const n = await this._cycleTLS(j, m, "post");
      b.capture(n.headers, n.finalUrl || j);
      return n;
    };
    const h = async (j, k = 0xf) => {
      let l = j;
      let m;
      for (let n = 0x0; n < k; n++) {
        m = await f(l, { Referer: n === 0x0 ? BASE_CHATGPT + "/" : l });
        const o = m.headers?.Location || m.headers?.location;
        if (m.status >= 0x12c && m.status < 0x190 && o) {
          l = new URL(o, l).href;
        } else {
          break;
        }
      }
      return { ...m, finalUrl: l };
    };
    const i = (j) => {
      if (typeof j.data === "object") return j.data;
      try {
        return JSON.parse(j.data);
      } catch {
        return null;
      }
    };
    try {
      const j = (async () => {
        const D = new Set();
        try {
          const E =
            this.otpConfig.provider !== "generator.email" &&
            this.otpConfig.provider !== "2" &&
            this.otpConfig.provider !== "ikona-oni" &&
            this.otpConfig.provider !== "3";
          let F;
          if (this.otpConfig.provider === "ikona-oni" || this.otpConfig.provider === "3") {
            F = await fetchOtpIkonaCandidates(
              this.email,
              {
                supabaseUrl: this.otpConfig.ikonaSupabaseUrl,
                supabaseKey: this.otpConfig.ikonaSupabaseKey,
              },
            );
          } else if (E && this.otpConfig.serviceDomain && this.otpConfig.apiKey) {
            F = await fetchOtpTmailCandidates(
              this.email,
              this.otpConfig.serviceDomain,
              this.otpConfig.apiKey,
            );
          } else {
            F = await fetchOtpGeneratorCandidates(
              this.email,
              this.otpConfig.geDomain,
              { quick: !![] },
            );
          }
          for (const G of F) D.add(String(G));
        } catch { }
        return D;
      })();
      const k = await d(BASE_CHATGPT + "/api/auth/csrf");
      const l = i(k);
      if (!l?.csrfToken) throw new Error("CSRF gagal");
      logger.info(this.tag + "Sesi: CSRF ✓");
      const m =
        BASE_CHATGPT +
        "/api/auth/signin/openai?prompt=login&ext-oai-did=" +
        this.deviceId +
        "&auth_session_logging_id=" +
        this.sessionId +
        "&ext-passkey-client-capabilities=11";
      const n =
        "callbackUrl=" +
        encodeURIComponent(BASE_CHATGPT + "/") +
        "&csrfToken=" +
        l.csrfToken +
        "&json=true";
      const o = await g(m, n, {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: BASE_CHATGPT,
        Referer: BASE_CHATGPT + "/",
      });
      const p = i(o);
      if (!p?.url) throw new Error("Signin gagal");
      logger.info(this.tag + "Sesi: URL otorisasi ✓");
      const q = await h(p.url);
      logger.info(this.tag + "Sesi: Auth aktif ✓");
      let r = new Set();
      try {
        r = await j;
      } catch (D) {
        logger.debug(
          this.tag +
          "Baseline OTP fetch failed: " +
          D.message?.substring(0x0, 0x50),
        );
      }
      const s = uuidv4();
      const { sentinelToken: t } = await generateSentinelTokens(
        a,
        this._ua,
        "authorize_continue",
        s,
        this._cycleTLS
      );
      const u = {
        "Content-Type": "application/json",
        Origin: BASE_AUTH,
        Referer: q.finalUrl,
        "sec-fetch-site": "same-origin",
      };
      if (t) u["OpenAI-Sentinel-Token"] = t;
      const v = await g(
        BASE_AUTH + "/api/accounts/authorize/continue",
        { username: { kind: "email", value: this.email } },
        u,
      );
      const w = i(v);
      if (!w?.continue_url) throw new Error("authorize/continue gagal");
      logger.info(this.tag + "Sesi: Email dikirim ✓");
      const x = w?.page?.payload?.email_verification_mode;
      const y = w.continue_url;
      const z = y.includes("/email-verification") || x === "login_challenge";
      let A = y;
      let B = x;
      if (z) {
        logger.info(this.tag + "Sesi: Rute kode verifikasi");
      } else {
        const { sentinelToken: E } = await generateSentinelTokens(
          a,
          this._ua,
          "password_verify",
          s,
          this._cycleTLS
        );
        const F = {
          "Content-Type": "application/json",
          Origin: BASE_AUTH,
          Referer: BASE_AUTH + "/log-in/password",
          "sec-fetch-site": "same-origin",
        };
        if (E) F["OpenAI-Sentinel-Token"] = E;
        const G = await g(
          BASE_AUTH + "/api/accounts/password/verify",
          { password: this.password },
          F,
        );
        const H = i(G);
        if (!H?.continue_url) {
          const I = H?.error?.code || "unknown";
          throw new Error("Password verify gagal: " + I);
        }
        logger.info(this.tag + "Sesi: Kata sandi ✓");
        A = H.continue_url;
        B = H?.page?.payload?.email_verification_mode;
      }
      if (A.includes("/email-verification") || B === "login_challenge") {
        logger.info(this.tag + "Sesi: Tantangan kode...");
        let M = false;

        if (this.otpConfig.provider === "manual" || this.otpFn) {
          // Manual mode: prompt user directly without waiting
          let manualCode = null;
          for (let R = 0; R < 3; R++) {
            try {
              if (this.otpFn) {
                const res = await this.otpFn();
                manualCode = Array.isArray(res) ? res[0] : res;
              } else {
                manualCode = await askTelegram("Masukkan kode verifikasi: ", this.tag);
              }
            } catch { }
            if (!manualCode) { 
                logger.warn(this.tag + "Sesi: Kode kosong, coba lagi..."); 
                continue; 
            }
            if (r.has(String(manualCode))) { 
                logger.warn(this.tag + "Sesi: Kode sudah pernah dipakai, masukkan yang baru..."); 
                manualCode = null; 
                continue; 
            }
            r.add(String(manualCode));
            logger.info(this.tag + "Sesi: Mencoba kode " + manualCode + "...");
            const Vm = await g(
              BASE_AUTH + "/api/accounts/email-otp/validate",
              { code: manualCode },
              { "Content-Type": "application/json", Origin: BASE_AUTH, Referer: BASE_AUTH + "/email-verification", "sec-fetch-site": "same-origin" },
            );
            const Wm = i(Vm);
            if (Wm?.continue_url) { A = Wm.continue_url; M = true; logger.info(this.tag + "Sesi: Kode ✓"); break; }
            const Xm = Wm?.error?.code || "unknown";
            if (Xm === "wrong_email_otp_code") { logger.warn(this.tag + "Sesi: Kode salah, masukkan ulang..."); manualCode = null; continue; }
            throw new Error("OTP validate gagal: " + Xm);
          }
        } else {
            // Auto mode logic
            const waitTimes = [10000, 10000, 10000];
            for (let R = 0; R < waitTimes.length; R++) {
                logger.info(this.tag + "Login: Waiting OTP... (" + (waitTimes[R]/1000) + "s)");
                await sleep(waitTimes[R]);
                
                let candidates = [];
                try {
                    // Try to fetch candidates again
                    const provider = this.otpConfig.provider;
                    if (provider === "ikona-oni" || provider === "3") {
                        candidates = await fetchOtpIkonaCandidates(this.email, {
                            supabaseUrl: this.otpConfig.ikonaSupabaseUrl,
                            supabaseKey: this.otpConfig.ikonaSupabaseKey,
                        });
                    } else if (this.otpConfig.serviceDomain && this.otpConfig.apiKey) {
                        candidates = await fetchOtpTmailCandidates(this.email, this.otpConfig.serviceDomain, this.otpConfig.apiKey);
                    } else {
                        candidates = await fetchOtpGeneratorCandidates(this.email, this.otpConfig.geDomain, { quick: true });
                    }
                } catch { candidates = []; }

                const newOtp = candidates.find((o) => !r.has(String(o)));
                if (!newOtp) continue;

                r.add(String(newOtp));
                logger.info(this.tag + "Sesi: Mencoba kode " + newOtp + "...");
                const VRes = await g(
                    BASE_AUTH + "/api/accounts/email-otp/validate",
                    { code: newOtp },
                    { "Content-Type": "application/json", Origin: BASE_AUTH, Referer: BASE_AUTH + "/email-verification", "sec-fetch-site": "same-origin" },
                );
                const WRes = i(VRes);
                if (WRes?.continue_url) {
                    A = WRes.continue_url;
                    M = true;
                    logger.info(this.tag + "Sesi: Kode ✓");
                    break;
                }
                const XErr = WRes?.error?.code || "unknown";
                if (XErr === "wrong_email_otp_code") {
                    logger.warn(this.tag + "Sesi: Kode tidak cocok, coba lagi...");
                    continue;
                }
                throw new Error("OTP validate gagal: " + XErr);
            }
        }
        if (!M) {
          const Y = new Error("OTP tidak diterima");
          Y.otpTimeout = true;
          throw Y;
        }
      }

      if (A.includes("callback") || A.includes("code=")) {
        await h(A);
      }
      let C = null;
      for (let Z = 0x0; Z < 0x3; Z++) {
        if (Z > 0x0) await sleep(0x7d0);
        const a0 = await d(BASE_CHATGPT + "/api/auth/session", {
          Referer: BASE_CHATGPT + "/",
        });
        const a1 = i(a0);
        if (a1?.accessToken) {
          C = a1.accessToken;
          break;
        }
      }
      if (!C) throw new Error("Access token gagal didapat");
      this.accessToken = C;
      logger.success(this.tag + "Sesi: Token ✓");
      return { accessToken: C };
    } catch (a2) {
      await this.cleanup();
      throw a2;
    }
  }
  async _followOAuthChain(a) {
    let b = a;
    let c;
    for (let d = 0x0; d < 0xf; d++) {
      c = await this.client.get(b, {
        maxRedirects: 0x0,
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: d === 0x0 ? BASE_AUTH + "/" : b,
        },
      });
      logger.debug(this.tag + "  hop " + d + ": " + c.status);
      if (c.status >= 0x12c && c.status < 0x190 && c.headers.location) {
        b = new URL(c.headers.location, b).href;
      } else {
        break;
      }
    }
    logger.debug(this.tag + "OAuth chain done");
    return { finalUrl: b, response: c };
  }
  async getPricingCountries() {
    const a = await this._oaiGet(
      BASE_CHATGPT + "/backend-api/checkout_pricing_config/countries",
    );
    logger.debug(this.tag + "Pricing countries ✓");
    return a.data;
  }
  async getPricingConfig() {
    const a = await this._oaiGet(
      BASE_CHATGPT + "/backend-api/checkout_pricing_config/configs/ID",
      {},
      this.koreaProxyUrl
    );
    logger.debug(this.tag + "Pricing config ✓");
    return a.data;
  }
  async createCheckoutSession() {
    logger.info(this.tag + "Sesi checkout (via ErdogAI)...");
    const res = await axios.post("https://tools.erdogai.com/get_plus_1month_free_url", {
      access_token: this.accessToken,
      country: "ID",
      currency: "IDR"
    }, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": this._ua,
        "Accept": "*/*",
        "Origin": "https://tools.erdogai.com",
        "Referer": "https://tools.erdogai.com/"
      },
      timeout: 30000
    });
    if (res.data?.status !== "success") {
      throw new Error("Gagal mendapatkan link trial dari ErdogAI: " + (res.data?.message || JSON.stringify(res.data)));
    }
    const d = res.data.data;
    this.checkoutSessionId = d.checkout_session_id;
    this.publishableKey = d.publishable_key || STRIPE_PK;
    logger.success(this.tag + "Checkout ✓ (" + res.data.forwarded_to + ")");
    return d;
  }
  async initStripeCheckout() {
    const a = new URLSearchParams();
    a.append("browser_locale", "en-US");
    a.append("browser_timezone", "Asia/Jakarta");
    a.append(
      "elements_session_client[client_betas][0]",
      "custom_checkout_server_updates_1",
    );
    a.append(
      "elements_session_client[client_betas][1]",
      "custom_checkout_manual_approval_1",
    );
    a.append(
      "elements_session_client[elements_init_source]",
      "custom_checkout",
    );
    a.append("elements_session_client[referrer_host]", "chatgpt.com");
    a.append("elements_session_client[stripe_js_id]", this.stripeJsId);
    a.append("elements_session_client[locale]", "en-US");
    a.append("elements_session_client[is_aggregation_expected]", "false");
    a.append("elements_options_client[stripe_js_locale]", "auto");
    a.append(
      "elements_options_client[saved_payment_method][enable_save]",
      "never",
    );
    a.append(
      "elements_options_client[saved_payment_method][enable_redisplay]",
      "never",
    );
    a.append("key", this.publishableKey);
    a.append("_stripe_version", STRIPE_VERSION);
    const b = await this.stripeClient.post(
      STRIPE_API + "/v1/payment_pages/" + this.checkoutSessionId + "/init",
      a.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Origin: "https://js.stripe.com",
          Referer: "https://js.stripe.com/",
        },
      },
    );
    this.initChecksum = b.data?.init_checksum || b.data?.checksum;
    this.elementsSessionConfigId = b.data?.elements_session_config_id;
    this.checkoutConfigId = b.data?.checkout_config_id;
    logger.debug(
      this.tag +
      "Stripe init ✓" +
      (this.initChecksum
        ? " (checksum: " + this.initChecksum.substring(0x0, 0xa) + "...)"
        : ""),
    );
    return b.data;
  }
  async initStripeSession() {
    const a = new URLSearchParams({
      "client_betas[0]": "custom_checkout_server_updates_1",
      "client_betas[1]": "custom_checkout_manual_approval_1",
      "deferred_intent[mode]": "subscription",
      "deferred_intent[amount]": "0",
      "deferred_intent[currency]": "idr",
      "deferred_intent[setup_future_usage]": "off_session",
      "deferred_intent[payment_method_types][0]": "card",
      "deferred_intent[payment_method_types][1]": "gopay",
      currency: "idr",
      key: this.publishableKey,
      _stripe_version: STRIPE_VERSION,
      elements_init_source: "custom_checkout",
      referrer_host: "chatgpt.com",
      stripe_js_id: this.stripeJsId,
      locale: "en",
      type: "deferred_intent",
      checkout_session_id: this.checkoutSessionId,
    });
    let b;
    try {
      b = await this.stripeClient.post(
        STRIPE_API + "/v1/elements/sessions",
        a.toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Origin: "https://js.stripe.com",
            Referer: "https://js.stripe.com/",
          },
        },
      );
    } catch {
      b = await this.stripeClient.get(
        STRIPE_API + "/v1/elements/sessions?" + a.toString(),
        {
          headers: {
            Accept: "application/json",
            Origin: "https://js.stripe.com",
            Referer: "https://js.stripe.com/",
          },
        },
      );
    }
    this.elementsSessionId = b.data?.session?.id || b.data?.id || null;
    logger.debug(this.tag + "Stripe session ✓");
    return b.data;
  }
  async createPaymentMethod(a) {
    const b = new URLSearchParams();
    b.append("billing_details[name]", a.name);
    b.append("billing_details[email]", this.email);
    b.append("billing_details[address][country]", a.country);
    b.append("billing_details[address][line1]", a.line1);
    b.append("billing_details[address][city]", a.city);
    b.append("billing_details[address][postal_code]", a.postal_code);
    b.append("billing_details[address][state]", a.state);
    b.append("type", "gopay");
    b.append(
      "payment_user_agent",
      "stripe.js/804ae66e17; stripe-js-v3/804ae66e17; payment-element; deferred-intent",
    );
    b.append("referrer", "https://chatgpt.com");
    b.append(
      "time_on_page",
      String(Math.floor(Math.random() * 0x7530) + 0x7530),
    );
    b.append("client_attribution_metadata[client_session_id]", this.stripeJsId);
    b.append(
      "client_attribution_metadata[checkout_session_id]",
      this.checkoutSessionId,
    );
    b.append(
      "client_attribution_metadata[merchant_integration_source]",
      "checkout",
    );
    b.append(
      "client_attribution_metadata[merchant_integration_subtype]",
      "payment-element",
    );
    b.append(
      "client_attribution_metadata[merchant_integration_version]",
      "custom",
    );
    b.append(
      "client_attribution_metadata[merchant_integration_additional_elements][0]",
      "payment",
    );
    b.append(
      "client_attribution_metadata[merchant_integration_additional_elements][1]",
      "address",
    );
    b.append(
      "client_attribution_metadata[payment_intent_creation_flow]",
      "deferred",
    );
    b.append(
      "client_attribution_metadata[payment_method_selection_flow]",
      "automatic",
    );
    b.append("guid", uuidv4().replace(/-/g, "").substring(0x0, 0x24));
    b.append("muid", uuidv4().replace(/-/g, "").substring(0x0, 0x24));
    b.append("sid", uuidv4().replace(/-/g, "").substring(0x0, 0x24));
    b.append("key", this.publishableKey);
    b.append("_stripe_version", STRIPE_VERSION);
    const c = await this.stripeClient.post(
      STRIPE_API + "/v1/payment_methods",
      b.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Origin: "https://js.stripe.com",
          Referer: "https://js.stripe.com/",
        },
      },
    );
    if (c.status !== 0xc8) {
      throw new Error(
        "Create payment method failed: " +
        c.status +
        " " +
        JSON.stringify(c.data),
      );
    }
    this.paymentMethodId = c.data.id;
    logger.debug(this.tag + "Payment method ✓ (" + this.paymentMethodId + ")");
    return c.data;
  }
  async confirmCheckout(a) {
    const b =
      "https://checkout.stripe.com/c/pay/" +
      this.checkoutSessionId +
      "?returned_from_redirect=true&ui_mode=hosted&return_url=" +
      encodeURIComponent(
        BASE_CHATGPT +
        "/checkout/verify?stripe_session_id=" +
        this.checkoutSessionId +
        "&processor_entity=openai_llc&plan_type=plus",
      );
    const c = new URLSearchParams();
    c.append("eid", "NA");
    c.append("payment_method", this.paymentMethodId);
    c.append("expected_amount", "0");
    c.append("consent[terms_of_service]", "accepted");
    c.append("expected_payment_method_type", "gopay");
    c.append("return_url", b);
    c.append("_stripe_version", "2020-08-27;custom_checkout_beta=v1");
    c.append("guid", uuidv4().replace(/-/g, "").substring(0x0, 0x24));
    c.append("muid", uuidv4().replace(/-/g, "").substring(0x0, 0x24));
    c.append("sid", uuidv4().replace(/-/g, "").substring(0x0, 0x24));
    c.append("key", this.publishableKey || STRIPE_PK);
    c.append("version", "12427d159a"); // Dari curl
    if (this.initChecksum) {
      c.append("init_checksum", this.initChecksum);
    }
    
    // Attribution Metadata (wajib untuk hosted checkout via API)
    c.append("client_attribution_metadata[client_session_id]", this.stripeJsId);
    c.append("client_attribution_metadata[checkout_session_id]", this.checkoutSessionId);
    c.append("client_attribution_metadata[merchant_integration_source]", "checkout");
    c.append("client_attribution_metadata[merchant_integration_version]", "hosted_checkout");
    c.append("client_attribution_metadata[payment_method_selection_flow]", "automatic");
    if (this.checkoutConfigId) {
      c.append("client_attribution_metadata[checkout_config_id]", this.checkoutConfigId);
    }
    const d = await this.stripeClient.post(
      STRIPE_API + "/v1/payment_pages/" + this.checkoutSessionId + "/confirm",
      c.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          Origin: "https://js.stripe.com",
          Referer: "https://js.stripe.com/",
        },
      },
    );
    if (d.status !== 0xc8) {
      const e = JSON.stringify(d.data || "");
      const f = d.data?.error || {};
      const g = f.code || "";
      const h = f.decline_code || "";
      const i = f.message || "";
      if (e.includes("checkout_amount_mismatch")) {
        const j = new Error("Akun tidak tersedia trial!");
        j.hint = "Akun ini sudah pernah pakai trial atau amount tidak cocok";
        throw j;
      }
      if (g === "payment_method_provider_decline") {
        const k = new Error(
          "GoPay ditolak: " + (h || "provider_decline") + " — " + i,
        );
        k.hint =
          "GoPay processing error. Coba: (1) tunggu 15-30 menit, (2) cek saldo & status GoPay di Gojek, (3) ganti nomor GoPay lain";
        throw k;
      }
      if (g) {
        throw new Error(
          "Stripe " +
          d.status +
          ": [" +
          g +
          "] " +
          (h ? "(" + h + ") " : "") +
          i,
        );
      }
      throw new Error("Confirm checkout failed: " + d.status + " " + e);
    }
    logger.success(this.tag + "Stripe confirmed ✓");
    logger.debug(
      this.tag +
      "Confirm: approval=" +
      d.data?.approval_method +
      " si=" +
      (d.data?.setup_intent ? "yes" : "null") +
      " pi=" +
      (d.data?.payment_intent ? "yes" : "null"),
    );
    return d.data;
  }
  async followStripeRedirect(a) {
    let b = null;
    const c = (k) => {
      if (!k || typeof k !== "object") return null;
      if (k.status === "succeeded") return "SUCCEEDED";
      if (k.next_action?.redirect_to_url?.url)
        return k.next_action.redirect_to_url.url;
      if (k.next_action?.use_stripe_sdk?.stripe_js)
        return k.next_action.use_stripe_sdk.stripe_js;
      if (k.next_action?.use_stripe_sdk?.url)
        return k.next_action.use_stripe_sdk.url;
      if (k.next_action?.type === "redirect_to_url" && k.next_action?.url)
        return k.next_action.url;
      const l = JSON.stringify(k);
      const n = l.match(/https?:\\?\/\\?\/pm-redirects\.stripe\.com[^"\\]*/);
      if (n) return n[0x0].replace(/\\\//g, "/");
      const o = l.match(/https?:\\?\/\\?\/app\.midtrans\.com[^"\\]*/);
      if (o) return o[0x0].replace(/\\\//g, "/");
      return null;
    };
    const f = encodeURIComponent(STRIPE_VERSION);
    const g = async (k) => {
      const l = k.startsWith("seti_") ? "setup_intents" : "payment_intents";
      logger.debug(this.tag + "Fetching " + l + "/" + k + "...");
      const m = await this.stripeClient.get(
        STRIPE_API +
        "/v1/" +
        l +
        "/" +
        k +
        "?key=" +
        this.publishableKey +
        "&_stripe_version=" +
        f,
        {
          headers: {
            Accept: "application/json",
            Origin: "https://js.stripe.com",
            Referer: "https://js.stripe.com/",
          },
        },
      );
      return m.status === 0xc8 ? m.data : null;
    };
    const h = async () => {
      const k = new URLSearchParams({
        "client_betas[0]": "custom_checkout_server_updates_1",
        "client_betas[1]": "custom_checkout_manual_approval_1",
        "deferred_intent[mode]": "subscription",
        "deferred_intent[amount]": "0",
        "deferred_intent[currency]": "idr",
        "deferred_intent[setup_future_usage]": "off_session",
        "deferred_intent[payment_method_types][0]": "card",
        "deferred_intent[payment_method_types][1]": "gopay",
        currency: "idr",
        key: this.publishableKey,
        _stripe_version: STRIPE_VERSION,
        elements_init_source: "custom_checkout",
        referrer_host: "chatgpt.com",
        stripe_js_id: this.stripeJsId,
        locale: "en",
        type: "deferred_intent",
        checkout_session_id: this.checkoutSessionId,
      });
      if (this.elementsSessionId) {
        k.append("elements_session_client[session_id]", this.elementsSessionId);
      }
      let l;
      try {
        l = await this.stripeClient.post(
          STRIPE_API + "/v1/elements/sessions",
          k.toString(),
          {
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
              Origin: "https://js.stripe.com",
              Referer: "https://js.stripe.com/",
            },
          },
        );
      } catch {
        l = await this.stripeClient.get(
          STRIPE_API + "/v1/elements/sessions?" + k.toString(),
          {
            headers: {
              Accept: "application/json",
              Origin: "https://js.stripe.com",
              Referer: "https://js.stripe.com/",
            },
          },
        );
      }
      if (l.status !== 0xc8 || !l.data) return null;
      const n = l.data;
      const o = [
        n.payment_intent,
        n.setup_intent,
        n.session?.payment_intent,
        n.session?.setup_intent,
        n.deferred_intent,
      ];
      for (const t of o) {
        if (!t) continue;
        const u = c(t);
        if (u) return u;
      }
      const p = JSON.stringify(n);
      const q = p.match(/https?:\\?\/\\?\/pm-redirects\.stripe\.com[^"\\]*/);
      if (q) return q[0x0].replace(/\\\//g, "/");
      const s = p.match(/https?:\\?\/\\?\/app\.midtrans\.com[^"\\]*/);
      if (s) return s[0x0].replace(/\\\//g, "/");
      return null;
    };
    const i = async () => {
      const { sentinelToken: k } = await generateSentinelTokens(
        this.proxyUrl || "",
        this._ua,
        "chatgpt_checkout",
        this.deviceId,
        this._cycleTLS
      );
      const l = {};
      if (k) l["OpenAI-Sentinel-Token"] = k;
      return this._oaiPost(
        BASE_CHATGPT + "/backend-api/payments/checkout/approve",
        {
          checkout_session_id: this.checkoutSessionId,
          processor_entity: "openai_llc",
        },
        l,
      );
    };
    if (a?.next_action?.redirect_to_url?.url) {
      b = a.next_action.redirect_to_url.url;
    }
    if (!b) {
      let k = a?.setup_intent;
      let l = a?.payment_intent;
      if (typeof k === "object" && k) {
        const m = c(k);
        if (m === "SUCCEEDED") return { alreadySucceeded: !![] };
        if (m) b = m;
      }
      if (!b && typeof l === "object" && l) {
        const n = c(l);
        if (n === "SUCCEEDED") return { alreadySucceeded: !![] };
        if (n) b = n;
      }
      if (!b && typeof l === "string") {
        const o = await g(l);
        const p = c(o);
        if (p === "SUCCEEDED") return { alreadySucceeded: !![] };
        if (p) b = p;
      }
      if (!b && typeof k === "string") {
        const q = await g(k);
        const s = c(q);
        if (s === "SUCCEEDED") return { alreadySucceeded: !![] };
        if (s) b = s;
      }
      if (!b) {
        logger.info(this.tag + "Menunggu konfirmasi...");
        let t = null;
        if (a?.approval_method === "manual") {
          try {
            const v = await i();
            logger.info(
              this.tag + "Approve: " + (v.status === 0xc8 ? "✓" : v.status),
            );
          } catch (w) {
            logger.warn(
              this.tag + "Approve failed: " + w.message?.substring(0x0, 0x64),
            );
          }
        }
        const u = 0x2;
        for (let x = 0x0; x < u; x++) {
          await sleep(0x1388);
          const y =
            typeof l === "string" ? l : typeof k === "string" ? k : null;
          if (y) {
            const A = await g(y);
            if (A) {
              const B = c(A);
              if (B === "SUCCEEDED") return { alreadySucceeded: !![] };
              if (B) {
                b = B;
                break;
              }
            }
          }
          const z = await this.stripeClient.get(
            STRIPE_API +
            "/v1/payment_pages/" +
            this.checkoutSessionId +
            "?key=" +
            this.publishableKey +
            "&_stripe_version=" +
            f,
            {
              headers: {
                Accept: "application/json",
                Origin: "https://js.stripe.com",
                Referer: "https://js.stripe.com/",
              },
            },
          );
          if (z.status === 0xc8) {
            const C = z.data;
            t = C;
            k = C?.setup_intent;
            l = C?.payment_intent;
            const D = C?.status;
            const E = C?.payment_status;
            if (C?.next_action?.redirect_to_url?.url) {
              b = C.next_action.redirect_to_url.url;
              break;
            }
            if (typeof k === "object" && k) {
              const F = c(k);
              if (F === "SUCCEEDED") return { alreadySucceeded: !![] };
              if (F) {
                b = F;
                break;
              }
            }
            if (typeof l === "object" && l) {
              const G = c(l);
              if (G === "SUCCEEDED") return { alreadySucceeded: !![] };
              if (G) {
                b = G;
                break;
              }
            }
            if (!y && typeof l === "string") {
              const H = await g(l);
              const I = c(H);
              if (I === "SUCCEEDED") return { alreadySucceeded: !![] };
              if (I) {
                b = I;
                break;
              }
            }
            if (!y && typeof k === "string") {
              const J = await g(k);
              const K = c(J);
              if (K === "SUCCEEDED") return { alreadySucceeded: !![] };
              if (K) {
                b = K;
                break;
              }
            }
            logger.debug(
              this.tag +
              "Approve poll " +
              (x + 0x1) +
              "/" +
              u +
              ": " +
              D +
              "/" +
              E +
              " si=" +
              (k ? "yes" : "-") +
              " pi=" +
              (l ? "yes" : "-"),
            );
          }
          if (!b) {
            try {
              const L = await h();
              if (L === "SUCCEEDED") return { alreadySucceeded: !![] };
              if (L) {
                b = L;
                break;
              }
            } catch (M) {
              if (x % 0xa === 0x0)
                logger.debug(
                  this.tag +
                  "elements/sessions poll error: " +
                  M.message?.substring(0x0, 0x50),
                );
            }
          }
        }
        if (!b && t) {
          a = t;
        }
        if (!b && a?.approval_method === "manual") {
          const N = new Error("[GoPay] Akun not eligible");
          N.hint =
            "Akun ini kemungkinan tidak eligible trial setelah approval manual";
          throw N;
        }
      }
    }
    if (!b) {
      const O = JSON.stringify(a);
      const P = O.match(/https?:\\?\/\\?\/pm-redirects\.stripe\.com[^"\\]*/);
      if (P) {
        b = P[0x0].replace(/\\\//g, "/");
      } else {
        const Q = O.match(/https?:\\?\/\\?\/app\.midtrans\.com[^"\\]*/);
        if (Q) b = Q[0x0].replace(/\\\//g, "/");
      }
    }
    if (!b) {
      const R = a || {};
      const S = JSON.stringify(R, null, 0x2);
      logger.warn(
        this.tag +
        "No redirect URL found — status=" +
        R.status +
        " approval=" +
        R.approval_method +
        " si=" +
        (R.setup_intent ? "yes" : "null") +
        " pi=" +
        (R.payment_intent ? "yes" : "null"),
      );
      logger.debug(this.tag + "Dump: " + S.substring(0x0, 0x5dc));
      throw new Error("[GoPay] Stripe redirect URL not found after polling");
    }
    logger.debug(this.tag + "Following Stripe redirect...");
    // Gunakan stripeClient (SGP proxy) untuk hit hooks.stripe.com karena DataImpulse (General Proxy) memblokirnya.
    const j = await this.stripeClient.get(b, {
      maxRedirects: 0x0,
      validateStatus: (T) => T < 0x1f4,
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: "https://chatgpt.com/",
      },
    });
    if (j.status === 0x12e || j.status === 0x12d) {
      const T = j.headers.location;
      const U = T.match(/\/snap\/v4\/redirection\/([a-f0-9-]+)/);
      if (U) {
        this.midtransSnapId = U[0x1];
        const V = b.match(/sa_nonce_([A-Za-z0-9]+)/);
        if (V) {
          this.stripeReturnNonce = V[0x1];
        }
        logger.debug(
          this.tag + "Midtrans SNAP ✓ (" + this.midtransSnapId + ")",
        );
        return { snapId: this.midtransSnapId, redirectUrl: T };
      }
    }
    throw new Error(
      "Unexpected redirect response: " +
      j.status +
      " " +
      (j.headers.location || "no location"),
    );
  }
  async getMidtransTransaction() {
    const a = await this.midtransClient.get(
      MIDTRANS_API + "/snap/v1/transactions/" + this.midtransSnapId,
      {
        headers: {
          ...this._midtransHeaders(),
          Referer: MIDTRANS_API + "/snap/v4/redirection/" + this.midtransSnapId,
        },
      },
    );
    logger.debug(this.tag + "Midtrans transaction ✓");
    return a.data;
  }
  async linkGoPay() {
    const a = {
      type: "gopay",
      country_code: "62",
      phone_number: this.gopayPhone,
    };
    const b = await this.midtransClient.post(
      MIDTRANS_API + "/snap/v3/accounts/" + this.midtransSnapId + "/linking",
      a,
      {
        headers: {
          ...this._midtransHeaders(),
          Referer: MIDTRANS_API + "/snap/v4/redirection/" + this.midtransSnapId,
        },
      },
    );
    if (b.status !== 0xc9 && b.status !== 0xc8) {
      const c = JSON.stringify(b.data || "");
      if (
        (b.status === 406 || b.status === 410 || b.status === 409) &&
        c.includes("linked")
      ) {
        // Try to recover Account ID from the error response
        const linkedId = b.data?.account_id || b.data?.id;
        if (linkedId) {
            logger.info(this.tag + "GoPay detected as already linked, reusing ID...");
            this.gopayReference = linkedId;
            return b.data;
        }

        // AUTO-RETRY LOGIC DIHAPUS.
        // Berdasarkan arsitektur baru, jika terjadi konflik linked:
        // Bot akan lempar error -> WorkerPool catch error -> panggil releaseGopaySlot -> 
        // -> OTP Server (`/gopay/release`) akan otomatis kirim reset-link webhook ke HP
        // -> HP dipaksa bersih, siap dipakai slot-claim berikutnya.
        
        const d = new Error("GoPay sudah terhubung!");
        d.hint = "Server akan otomatis me-reset slot ini. Coba pakai slot yang lain.";
        d.noRetry = true; // Langsung gagal, ganti akun/slot.
        d.linkedConflict = true; // Flag for index.js to force release
        throw d;
      }
      throw new Error("GoPay linking failed: " + b.status + " " + c);
    }
    this.gopayReference =
      b.data?.reference || b.data?.gopay_reference || b.data?.id;
    if (!this.gopayReference && b.data) {
      const e = JSON.stringify(b.data);
      const f = e.match(
        /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/,
      );
      if (f) {
        this.gopayReference = f[0x0];
      }
    }
    logger.success(this.tag + "GoPay linked ✓");
    return b.data;
  }
  async gopayAuthorize(a) {
    const b = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: GOPAY_MERCHANTS_APP,
      Referer: GOPAY_MERCHANTS_APP + "/",
      "x-user-locale": "en-US",
    };
    try {
      const d = await this.midtransClient.post(
        GOPAY_GWA_API + "/v1/linking/validate-reference",
        { reference_id: this.gopayReference },
        { headers: b },
      );
      logger.debug(this.tag + "GoPay validate-reference ✓");
    } catch (f) {
      logger.debug(this.tag + "Validate reference: " + f.message);
    }
    const c = await this.midtransClient.post(
      GOPAY_GWA_API + "/v1/linking/user-consent",
      { reference_id: this.gopayReference },
      { headers: b },
    );
    if (c.status !== 0xc8) {
      throw new Error("GoPay user-consent failed: " + c.status);
    }
    logger.debug(this.tag + "GoPay consent ✓ (OTP sent to WhatsApp)");
    return c.data;
  }
  async handleGoPayOtpAndPin() {
    const a = {
      cyan: "[36m",
      yellow: "[33m",
      green: "[32m",
      reset: "[0m",
      bold: "[1m",
    };
    console.log(
      "\x0a" +
      a.bold +
      a.yellow +
      "═══════════════════════════════════════" +
      a.reset,
    );
    console.log("" + a.bold + a.cyan + "  Verifikasi GoPay" + a.reset);
    console.log(
      a.yellow + "  Kode dikirim ke WhatsApp: +62" + this.gopayPhone + a.reset,
    );
    console.log(
      "" +
      a.bold +
      a.yellow +
      "═══════════════════════════════════════" +
      a.reset +
      "\x0a",
    );
    // Auto-poll OTP dari server jika OTP_SERVER_URL di-set di .env
    let b;
    const otpServerUrl = process.env.OTP_SERVER_URL;
    if (otpServerUrl && this.gopayPhone) {
      logger.info(this.tag + "[Auto OTP] Polling GoPay OTP dari server...");
      b = await fetchGopayOtp(this.gopayPhone, otpServerUrl, this.serverNumber);
    } else {
      b = await getUserInput("Masukkan kode GoPay dari WhatsApp: ");
    }
    if (!b || b.length < 0x4) {
      throw new Error("Invalid OTP code");
    }
    logger.debug(this.tag + "OTP entered: " + b);
    const c = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: GOPAY_MERCHANTS_APP,
      Referer: GOPAY_MERCHANTS_APP + "/",
      "x-user-locale": "en-US",
    };
    const d = await this.midtransClient.post(
      GOPAY_GWA_API + "/v1/linking/validate-otp",
      { reference_id: this.gopayReference, otp: b },
      { headers: c },
    );
    if (d.status !== 0xc8) {
      throw new Error("GoPay validate-otp failed: " + d.status);
    }
    logger.debug(this.tag + "GoPay OTP validated ✓");
    let f = d.data?.challenge_id;
    if (!f) {
      const n = JSON.stringify(d.data);
      const o = n.match(/challengeId[=:]([a-f0-9-]{36})/i);
      if (o) f = o[0x1];
    }
    if (!f) {
      throw new Error("No challengeId from validate-otp response");
    }
    const g = uuidv4();
    const h = uuidv4();
    const i = {
      Accept: "application/json, text/plain, */*",
      Origin: "https://pin-web-client.gopayapi.com",
      Referer: "https://pin-web-client.gopayapi.com/",
      "x-appversion": "1.0.0",
      "x-correlation-id": g,
      "x-is-mobile": "false",
      "x-platform": "Windows 10",
      "x-request-id": h,
      "x-user-locale": "id",
    };
    const j =
      GOPAY_MERCHANTS_APP +
      "/payment/provider-redirect?reference=" +
      this.gopayReference +
      "&action=linking-validate-pin";
    try {
      const p = await this.midtransClient.get(
        GOPAY_CUSTOMER_API + "/api/v2/challenges/" + f + "/pin-page/nb",
        {
          params: { redirect_url: j, action: "linking-validate-pin" },
          headers: i,
        },
      );
      logger.debug(this.tag + "GoPay PIN page ✓");
    } catch (q) {
      logger.debug(this.tag + "PIN page: " + q.message);
    }
    const k = await this.midtransClient.post(
      GOPAY_CUSTOMER_API + "/api/v1/users/pin/tokens/nb",
      { challenge_id: f, client_id: GOPAY_PIN_CLIENT_ID, pin: this.gopayPin },
      { headers: { ...i, "Content-Type": "application/json" } },
    );
    if (k.status !== 0xc8) {
      throw new Error("GoPay PIN submit failed: " + k.status);
    }
    let l = k.data?.token;
    if (!l && k.data) {
      const r = JSON.stringify(k.data);
      const s = r.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
      if (s) l = s[0x0];
    }
    if (!l) {
      throw new Error("No JWT token from PIN submit");
    }
    logger.debug(this.tag + "GoPay PIN verified ✓");
    const m = await this.midtransClient.post(
      GOPAY_GWA_API + "/v1/linking/validate-pin",
      { reference_id: this.gopayReference, token: l },
      { headers: c },
    );
    if (m.status !== 0xc8) {
      throw new Error("GoPay validate-pin failed: " + m.status);
    }
    logger.success(this.tag + "GoPay linking done ✓");
    return m.data;
  }
  async waitForLinkingCallback() {
    for (let a = 0x0; a < 0xc; a++) {
      await sleep(0x1388);
      try {
        const b = await this.midtransClient.get(
          MIDTRANS_API + "/snap/v1/transactions/" + this.midtransSnapId,
          {
            headers: {
              ...this._midtransHeaders(),
              Referer:
                MIDTRANS_API + "/snap/v4/redirection/" + this.midtransSnapId,
            },
          },
        );
        const c = b.data;
        if (
          c?.gopay_account_id ||
          c?.payment_type === "gopay" ||
          c?.status_code === "200"
        ) {
          logger.debug(this.tag + "GoPay linking confirmed");
          return c;
        }
        logger.debug(
          this.tag + "Waiting for linking... (" + (a + 0x1) + "/12)",
        );
      } catch (d) {
        logger.debug(this.tag + "Poll error: " + d.message);
      }
    }
    logger.debug(this.tag + "Linking poll timeout, proceeding...");
    return null;
  }
  async chargeGoPay() {
    const a = {
      payment_type: "gopay",
      tokenization: "true",
      promo_details: null,
    };
    const b = await this.midtransClient.post(
      MIDTRANS_API + "/snap/v2/transactions/" + this.midtransSnapId + "/charge",
      a,
      {
        headers: {
          ...this._midtransHeaders(),
          Referer: MIDTRANS_API + "/snap/v4/redirection/" + this.midtransSnapId,
        },
      },
    );
    if (b.status !== 0xc8) {
      throw new Error(
        "GoPay charge failed: " + b.status + " " + JSON.stringify(b.data),
      );
    }
    logger.success(this.tag + "Charge initiated ✓");
    return b.data;
  }
  async handleChargePin(a) {
    const b = {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: GOPAY_MERCHANTS_APP,
      Referer: GOPAY_MERCHANTS_APP + "/",
    };
    let c = a?.reference_id || a?.gopay_reference;
    if (!c && a?.redirect_url) {
      const g = a.redirect_url.match(/reference[_=]([A-Za-z0-9]+)/);
      if (g) c = g[0x1];
    }
    if (!c && a?.authorize_url) {
      const h = a.authorize_url.match(/reference[=]([A-Za-z0-9-]+)/);
      if (h) c = h[0x1];
    }
    if (!c) {
      const i = JSON.stringify(a);
      const j = i.match(/reference[_"]?\s*[:=]\s*"?([A-Za-z0-9-]+)/);
      if (j) c = j[0x1];
    }
    if (!c) {
      logger.debug(this.tag + "No payment reference found");
      logger.debug(this.tag + "Waiting for charge processing...");
      await sleep(0x2710);
      return null;
    }
    try {
      const k = await this.midtransClient.get(
        GOPAY_GWA_API + "/v1/payment/validate",
        { params: { reference_id: c }, headers: b },
      );
      logger.debug(this.tag + "Payment validated ✓");
    } catch (l) {
      logger.debug(this.tag + "Payment validate: " + l.message);
    }
    let d = null;
    try {
      const m = await this.midtransClient.post(
        GOPAY_GWA_API + "/v1/payment/confirm",
        { payment_instructions: [] },
        { params: { reference_id: c }, headers: b },
      );
      d = m.data;
      logger.debug(this.tag + "Payment confirmed ✓");
    } catch (n) {
      logger.debug(this.tag + "Payment confirm: " + n.message);
    }
    let f = d?.challenge_id;
    if (!f && d) {
      const o = JSON.stringify(d);
      const p = o.match(/challenge[_"]?i?d?[_"]?\s*[:=]\s*"?([a-f0-9-]{36})/i);
      if (p) f = p[0x1];
    }
    if (f) {
      logger.debug(
        this.tag + "Charge PIN challenge: " + f.substring(0x0, 0x8) + "...",
      );
      const q = "47180a8e-f56e-11ed-a05b-0242ac120003-GWC";
      const r = await this.midtransClient.post(
        GOPAY_CUSTOMER_API + "/api/v1/users/pin/tokens/nb",
        { pin: this.gopayPin, challenge_id: f, client_id: q },
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
            Origin: GOPAY_MERCHANTS_APP,
            Referer: GOPAY_MERCHANTS_APP + "/",
            "x-request-id": uuidv4(),
          },
        },
      );
      if (r.status !== 0xc8) {
        throw new Error("Charge PIN failed: " + r.status);
      }
      let s = r.data?.token;
      if (!s && r.data) {
        const u = JSON.stringify(r.data);
        const v = u.match(
          /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
        );
        if (v) s = v[0x0];
      }
      if (!s) {
        throw new Error("No JWT token from charge PIN submit");
      }
      logger.debug(this.tag + "Charge PIN verified ✓");
      const t = await this.midtransClient.post(
        GOPAY_GWA_API + "/v1/payment/process",
        { challenge: { type: "GOPAY_PIN_CHALLENGE", value: { pin_token: s } } },
        { params: { reference_id: c }, headers: b },
      );
      logger.success(this.tag + "Payment processed ✓");
      return t.data;
    }
    logger.debug(this.tag + "Payment confirmed without PIN");
    return d;
  }
  async checkTransactionStatus() {
    for (let a = 0x0; a < 0xc; a++) {
      const b = await this.midtransClient.get(
        MIDTRANS_API +
        "/snap/v1/transactions/" +
        this.midtransSnapId +
        "/status",
        {
          headers: {
            ...this._midtransHeaders(),
            Referer:
              MIDTRANS_API + "/snap/v4/redirection/" + this.midtransSnapId,
          },
        },
      );
      const c = b.data?.transaction_status;
      const d = b.data?.status_code;
      logger.debug(
        this.tag + "Status: " + (c || "unknown") + " [" + (a + 0x1) + "/12]",
      );
      if (c === "settlement" || c === "capture" || d === "200") {
        logger.success(this.tag + "Settlement ✓");
        return b.data;
      }
      if (c === "pending" || !c) {
        await sleep(0x1388);
        continue;
      }
      if (c === "deny" || c === "cancel" || c === "expire" || c === "failure") {
        throw new Error("Payment " + c);
      }
      await sleep(0x1388);
    }
    throw new Error("Payment status check timeout");
  }
  async verifyCheckout() {
    const a =
      BASE_CHATGPT +
      "/checkout/verify?stripe_session_id=" +
      this.checkoutSessionId +
      "&processor_entity=openai_llc&plan_type=plus";
    const b = await this._oaiGetHtml(a, {
      Referer: "https://checkout.stripe.com/",
    });
    logger.debug(this.tag + "Checkout verify ✓");
    await sleep(0xbb8);
    const c = await this._oaiGetHtml(a + "&refresh_account=true", {
      Referer: a,
    });
    logger.success(this.tag + "ChatGPT Plus ✓");
    return c.data;
  }
  async checkSubscriptionStatus() {
    for (let i = 0; i < 10; i++) {
      if (i > 0) await sleep(3000);
      
      // Hit endpoint profil akun secara langsung untuk memastikan status "Plus"
      const a = await this._oaiGet(
        BASE_CHATGPT + "/backend-api/accounts/check/v4-2023-04-27"
      );
      
      // Endpoint ini mengembalikan object accounts. Jika berhasil Plus, account.plan_type = 'plus'
      if (a.data && a.data.accounts) {
        let hasPlus = false;
        let planName = "Unknown";
        
        for (const accountId in a.data.accounts) {
          const acc = a.data.accounts[accountId];
          if (acc.account) {
            const currentPlan = acc.account.plan_type;
            if (currentPlan === "plus") {
              hasPlus = true;
              planName = "ChatGPT Plus";
              break;
            } else {
              logger.debug(this.tag + `Account [${accountId}] plan_type = ${currentPlan}`);
            }
          }
        }
        
        if (hasPlus) {
          logger.success(this.tag + "Subscription: " + planName + " ✓ (Account Verified)");
          return true;
        }
      }
      
      logger.debug(this.tag + `Polling account status... (${i+1}/10)`);
    }
    return false;
  }
  async runAutopay() {
    try {
      if (!this.skipLogin) {
        logger.info(this.tag + "Autentikasi...");
        await this.loginToChatGPT();
      } else {
        if (!this._cycleTLS) {
          this._cycleTLS = this.sharedCycleTLS || (await initCycleTLS());
          this._oaiJar = new LoginCookieJar();
        }
        // Warm-up: hit /api/auth/session agar session cookies OpenAI tersedia
        // sebelum request checkout. Tanpa ini, request 403 karena jar kosong.
        try {
          logger.info(this.tag + "Warming up session cookies...");
          const _ws = await this._oaiGet(
            "https://chatgpt.com/api/auth/session",
            { Referer: "https://chatgpt.com/" }
          );
          logger.debug(this.tag + "Session warm-up status: " + _ws.status);
          await sleep(1500);
        } catch (_we) {
          logger.debug(this.tag + "Session warm-up failed (non-fatal): " + _we.message);
        }
      }

      logger.info(this.tag + "Info harga...");
      await Promise.all([this.getPricingCountries(), this.getPricingConfig()]);
      logger.info(this.tag + "Sesi checkout...");
      // Jika checkout gagal 401 (token expired), coba login ulang 1x
      let checkoutErr = null;
      for (let _ck = 0; _ck < 2; _ck++) {
        try {
          await this.createCheckoutSession();
          checkoutErr = null;
          break;
        } catch (e) {
          const errStr = e.message || '';
          if (_ck === 0 && (errStr.includes('401') || errStr.toLowerCase().includes('unauthorized') || errStr.toLowerCase().includes('access token is missing'))) {
            logger.warn(this.tag + "Checkout 401: token expired! Melakukan login ulang...");
            await this.loginToChatGPT(); // Refresh token
            checkoutErr = e;
          } else {
            throw e; // Bukan auth error, langsung lempar
          }
        }
      }
      if (checkoutErr) throw checkoutErr;
      logger.info(this.tag + "Inisiasi pembayaran...");
      const a = generateBillingAddress(this.name);
      const [, b] = await Promise.all([
        this.initStripeCheckout(),
        this.initStripeSession(),
        this.createPaymentMethod(a),
      ]);
      logger.info(this.tag + "Konfirmasi pembayaran...");
      const c = await this.confirmCheckout(b);
      this._pastStripe = !![];
      logger.info(this.tag + "Arah midtrans...");
      const d = await this.followStripeRedirect(c);
      if (d?.alreadySucceeded) {
        logger.info(this.tag + "Transaksi sudah berhasil, melewati GoPay...");
        await sleep(0x1388);
        logger.info(this.tag + "Verifikasi checkout...");
        await this.verifyCheckout();
      } else {
        await this.getMidtransTransaction();

        let otpSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (!otpSuccess && retryCount < maxRetries) {
          if (!this.gopayPhone && typeof this.onAcquireGopay === 'function') {
            const slot = await this.onAcquireGopay();
            if (slot) {
              this.gopayPhone = slot.phone;
              this.gopayPin = slot.pin;
              this.serverNumber = String(slot.id);
              this.webhookAction = slot.webhook_action;
              logger.success(this.tag + `[Pool] Berhasil mengunci Slot #${this.serverNumber} (${this.gopayPhone})`);
            } else {
              throw new Error("Gagal mengunci slot GoPay dari server OTP.");
            }
          }

          if (!this.gopayPhone) {
            throw new Error("Data GoPay tidak tersedia (Pool kosong).");
          }

          logger.info(this.tag + "Hubungkan GoPay (+62" + this.gopayPhone + ")...");
          try {
            const f = await this.linkGoPay();
            await this.gopayAuthorize(f);
            logger.info(this.tag + "Verifikasi GoPay...");
            await this.handleGoPayOtpAndPin();
            otpSuccess = true;
          } catch (gopayErr) {
            const msg = gopayErr.message || "";
            const isNetworkError = msg.includes("socket disconnected") || msg.includes("ECONNRESET") || msg.includes("socket hang up");
            const isOtpError = msg.includes("OTP") || msg.includes("Timeout") || msg.includes("Failed to connect GoPay") || msg.includes("Invalid verification code");
            
            if (isOtpError || isNetworkError) {
              logger.warn(this.tag + `GoPay Link/Network gagal: ${msg}. Merilis slot #${this.serverNumber} dan rotasi...`);
              if (typeof this.onReleaseGopay === 'function') {
                await this.onReleaseGopay(this.serverNumber);
              }
              this.gopayPhone = null; // kosongkan agar dipinjam yang baru di loop berikutnya
              retryCount++;
              if (retryCount >= maxRetries) {
                throw new Error("Gagal menghubungkan GoPay setelah " + maxRetries + " kali percobaan.");
              }
              await sleep(2000);
            } else {
              throw gopayErr;
            }
          }
        }
        await sleep(0x1388);
        logger.info(this.tag + "Proses pembayaran GoPay...");
        const g = await this.chargeGoPay();
        await this.handleChargePin(g);
        await sleep(0x2710);
        logger.info(this.tag + "Cek penyelesaian...");
        await this.checkTransactionStatus();

        if (typeof this.earlyReleaseFn === 'function') {
           logger.info(this.tag + "Pembayaran selesai, merilis slot GoPay lebih awal untuk di-reset...");
           await this.earlyReleaseFn();
        }

        logger.info(this.tag + "Verifikasi checkout...");
        await this.verifyCheckout();
        // WorkerPool / index.js yang memanggil bot ini PASTI akan melakukan releaseGopaySlot()
        // baik saat try sukses maupun catch error. Sehingga OTP Server lah yang akan handle trigger reset-link akhir.
      }

      logger.info(this.tag + "Verifikasi akhir langganan API...");
      const isSub = await this.checkSubscriptionStatus();
      if (!isSub) {
        throw new Error("Verifikasi API gagal: Status akun belum menjadi Plus setelah polling (menunggu update dari Stripe).");
      }

      return {
        success: true,
        email: this.email,
        password: this.password,
        accountType: 'Plus',
        accessToken: this.accessToken
      };
    } catch (h) {
      const j = this._pastStripe ? "GoPay" : this.accessToken ? "Checkout" : "Login";
      const errMsg = h.message && h.message.length > 0 ? h.message : JSON.stringify(h);
      const i = errMsg.length > 300 ? errMsg.substring(0, 300) + "..." : errMsg;
      logger.warn(this.tag + `Autopay gagal [${j}]: ${i}`);
      return {
        success: false,
        email: this.email,
        password: this.password,
        accountType: 'Free',
        error: "[" + j + "] " + errMsg
      };
    } finally {
      await this.cleanup();
    }
  }
}
module.exports = ChatGPTAutopay;
