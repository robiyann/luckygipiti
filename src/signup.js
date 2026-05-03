const { v4: uuidv4 } = require("uuid");
const { createClient, buildProxyUrl } = require("./utils/httpClient");
const { fetchOtpWithRetry } = require("./utils/otpFetcher");
const { generateRandomBirthday } = require("./utils/emailGenerator");
const { generateSentinelTokens } = require("./utils/sentinelToken");
const { askTelegram } = require("./telegramHandler");
const { clearOtpCache } = require("./db");
const logger = require("./utils/logger");
const BASE_CHATGPT = "https://chatgpt.com";
const BASE_AUTH = "https://auth.openai.com";
class ChatGPTSignup {
  constructor(a) {
    this.email = a.email;
    this.password = a.password;
    this.name = a.name;
    this.birthdate = a.birthdate;
    this.clientId = a.clientId;
    this.redirectUri = a.redirectUri;
    this.audience = a.audience;
    this.deviceId = uuidv4();
    this.sessionId = uuidv4();
    this.sentinelId = uuidv4();
    this.tag = a.threadId ? " \u001b[36m[#" + a.threadId + (this.email ? " | " + this.email : "") + "]\u001b[0m " : "";
    this.otpConfig = { provider: "manual" };
    // Sticky session proxy for DataImpulse
    const sessionToken = this.sessionId.substring(0, 8);
    const rawProxy = process.env.GENERAL_PROXY_URL || a.proxyUrl || null;
    const getProxy = (country) => {
      if (!rawProxy) return null;
      if (rawProxy.includes('gw.dataimpulse.com')) {
        return rawProxy.replace(/(https?:\/\/)([^_:]+)(?:__[^:]*)?:([^@]+)@(.+)/, (m, p1, userBase, pass, host) => {
          return `${p1}${userBase}__cr.${country}__session-${sessionToken}:${pass}@${host}`;
        });
      }
      return rawProxy;
    };
    const krJp = Math.random() > 0.5 ? 'us' : 'jp';
    this.proxyUrl = getProxy(krJp) || rawProxy;

    this.proxyConfig = a.proxyConfig || null;
    this.signupRetries = a.signupRetries || 0x3;
    this.sharedCycleTLS = a.sharedCycleTLS || null;
    this.otpFn = a.otpFn || null;
    const { client: b, jar: c } = createClient(this.proxyUrl);
    this.client = b;
    this.jar = c;
    this.csrfToken = null;
    this.authorizeUrl = null;
  }
  _refreshClient() {
    if (this.proxyConfig) {
      const {
        country: c,
        user: d,
        pass: e,
        host: f,
        port: g,
      } = this.proxyConfig;
      this.proxyUrl = buildProxyUrl(c, d, e, f, g);
    } else {
      // Re-apply sticky session to ensure it persists across refreshes
      const sessionToken = this.sessionId.substring(0, 8);
      const rawProxy = process.env.GENERAL_PROXY_URL || null;
      const getProxy = (country) => {
        if (!rawProxy) return null;
        if (rawProxy.includes('gw.dataimpulse.com')) {
          return rawProxy.replace(/(https?:\/\/)([^_:]+)(?:__[^:]*)?:([^@]+)@(.+)/, (m, p1, userBase, pass, host) => {
            return `${p1}${userBase}__cr.${country}__session-${sessionToken}:${pass}@${host}`;
          });
        }
        return rawProxy;
      };
      const krJp = Math.random() > 0.5 ? 'kr' : 'jp';
      this.proxyUrl = getProxy(krJp) || rawProxy;
    }
    const { client: a, jar: b } = createClient(this.proxyUrl);
    this.client = a;
    this.jar = b;
  }
  _isCfChallenge(a) {
    const b = a.headers?.["cf-mitigated"];
    if (b === "challenge") return !![];
    const c = typeof a.data === "string" ? a.data : "";
    return (
      c.includes("cf_chl_opt") ||
      c.includes("challenge-platform") ||
      (c.includes("Just a moment") && c.includes("cloudflare"))
    );
  }
  async _injectCookies(a) {
    for (const b of a) {
      if (!b.name || !b.value) continue;
      const d = (b.domain || "chatgpt.com").replace(/^\./, "");
      const e =
        b.name +
        "=" +
        b.value +
        "; Path=" +
        (b.path || "/") +
        (b.secure ? "; Secure" : "");
      try {
        await this.jar.setCookie(e, "https://" + d + "/");
      } catch (f) { }
    }
  }
  async _runAuthViaBrowser() {
    const { getAuthSession: a } = require("./utils/cfSolver");
    logger.info(this.tag + "Auth: memulai sesi browser...");
    const b = await a(this.proxyUrl, {
      email: this.email,
      deviceId: this.deviceId,
      sessionId: this.sessionId,
    });
    await this._injectCookies(b.cookies);
    this.csrfToken = b.csrfToken;
    logger.info(
      this.tag + "Sesi browser aktif ✓ (" + b.cookies.length + " cookies)",
    );
  }
  async getCsrfToken() {
    const a = await this.client.get(BASE_CHATGPT + "/api/auth/csrf");
    if (this._isCfChallenge(a)) {
      throw new Error("CF_CHALLENGE_CSRF");
    }
    this.csrfToken = a.data.csrfToken;
    if (!this.csrfToken) {
      throw new Error("CSRF token not found in response");
    }
    logger.info(this.tag + "CSRF ✓");
    return this.csrfToken;
  }
  async initiateSignin() {
    const a = new URLSearchParams({
      prompt: "login",
      "ext-oai-did": this.deviceId,
      auth_session_logging_id: this.sessionId,
      screen_hint: "login_or_signup",
      login_hint: this.email,
    });
    const b = new URLSearchParams({
      callbackUrl: BASE_CHATGPT + "/",
      csrfToken: this.csrfToken,
      json: "true",
    });
    const c = await this.client.post(
      BASE_CHATGPT + "/api/auth/signin/openai?" + a.toString(),
      b.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: BASE_CHATGPT,
          Referer: BASE_CHATGPT + "/",
        },
      },
    );
    if (this._isCfChallenge(c)) {
      throw new Error("CF_CHALLENGE_SIGNIN");
    }
    const d = c.data?.url;
    if (d) {
      this.authorizeUrl = d;
    } else {
      logger.warn(
        this.tag + "Signin returned no URL (" + c.status + ") — using fallback",
      );
      this.authorizeUrl = this._buildAuthorizeUrl();
    }
    logger.info(this.tag + "Signin ✓");
    return this.authorizeUrl;
  }
  _buildAuthorizeUrl() {
    const a = new URLSearchParams({
      client_id: this.clientId,
      scope:
        "openid email profile offline_access model.request model.read organization.read organization.write",
      response_type: "code",
      redirect_uri: this.redirectUri,
      audience: this.audience,
      device_id: this.deviceId,
      prompt: "login",
      "ext-oai-did": this.deviceId,
      auth_session_logging_id: this.sessionId,
      screen_hint: "login_or_signup",
      login_hint: this.email,
    });
    return BASE_AUTH + "/api/accounts/authorize?" + a.toString();
  }
  async authorize() {
    const a = await this.client.followRedirects(this.authorizeUrl, {
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: BASE_CHATGPT + "/",
      },
    });
    logger.info(this.tag + "Auth ✓");
    return a;
  }
  async register() {
    let a = null;
    try {
      const e =
        this.client.defaults?.headers?.["User-Agent"] ||
        this.client.defaults?.headers?.common?.["User-Agent"] ||
        "";
      const f = await generateSentinelTokens(
        this.proxyUrl,
        e,
        "username_password_create",
        this.sentinelId,
        this.sharedCycleTLS
      );
      a = f.sentinelToken;
    } catch (g) {
      logger.debug(this.tag + "Sentinel gen failed (register): " + g.message);
    }
    const b = { password: this.password, username: this.email };
    const c = {
      "Content-Type": "application/json",
      Origin: BASE_AUTH,
      Referer: BASE_AUTH + "/create-account/password",
    };
    if (a) {
      c["openai-sentinel-token"] = a;
      logger.debug(this.tag + "Sentinel token generated (register)");
    }
    const d = await this.client.post(
      BASE_AUTH + "/api/accounts/user/register",
      b,
      { headers: c },
    );
    if (d.status === 0xc8) {
      logger.info(this.tag + "Register ✓");
    } else if (d.status !== 0x193) {
      logger.error(this.tag + "Register failed (" + d.status + ")");
      const h = d.data
        ? JSON.stringify(d.data).substring(0x0, 0x1f4)
        : "no response body";
      logger.error(this.tag + "Register body: " + h);
    }
    return d;
  }
  async sendOtp() {
    const a = await this.client.followRedirects(
      BASE_AUTH + "/api/accounts/email-otp/send",
      { headers: { Referer: BASE_AUTH + "/create-account/password" } },
    );
    logger.info(this.tag + "OTP sent ✓");
    return a;
  }
  async validateOtp(a) {
    const b = await this.client.post(
      BASE_AUTH + "/api/accounts/email-otp/validate",
      { code: a.toString() },
      {
        headers: {
          "Content-Type": "application/json",
          Origin: BASE_AUTH,
          Referer: BASE_AUTH + "/email-verification",
        },
      },
    );
    if (b.status === 0xc8) {
      logger.info(this.tag + "OTP valid ✓");
    } else {
      logger.error(this.tag + "OTP failed (" + b.status + ")");
    }
    return b;
  }
  async createAccount() {
    const a = {
      "Content-Type": "application/json",
      Origin: BASE_AUTH,
      Referer: BASE_AUTH + "/about-you",
    };
    const b = await this.client.post(
      BASE_AUTH + "/api/accounts/create_account",
      { name: this.name, birthdate: this.birthdate },
      { headers: a },
    );
    if (b.status === 0xc8) {
      logger.success(this.tag + "Account created ✓");
    } else {
      const c = b.data
        ? JSON.stringify(b.data).substring(0x0, 0xc8)
        : "no response body";
      logger.warn(this.tag + "Create account failed (" + b.status + "): " + c);
    }
    return b;
  }
  async runSignup() {
    const { runSignupViaAPI: a } = require("./utils/apiSignup");
    const b = this.signupRetries || 0xa;
    let c = 0x0;
    for (let d = 0x0; d < b; d++) {
      if (d > 0x0) {
        if (!this.proxyUrl && !this.proxyConfig) {
          logger.warn(this.tag + "Proxy tidak dikonfigurasi. Berhenti coba ulang.");
          break;
        }
        logger.info(
          this.tag + "Mencoba ulang... (percobaan " + (d + 1) + "/" + b + ")",
        );
        this._refreshClient();
        this.deviceId = uuidv4();
        this.sessionId = uuidv4();
        await new Promise((k) => setTimeout(k, 0x3e8));
      }
      logger.info(
        this.tag + "Memulai... (percobaan " + (d + 0x1) + "/" + b + ")",
      );
      let e;
      try {
        const k = this.email;
        // Hapus cache OTP lama sebelum setiap sesi signup baru
        // agar LuckMail tidak mengembalikan kode dari sesi/batch sebelumnya
        clearOtpCache(this.email);
        e = await a(this.proxyUrl, {
          email: this.email,
          password: this.password,
          name: this.name,
          birthdate: this.birthdate,
          deviceId: this.deviceId,
          sessionId: this.sessionId,
          sharedCycleTLS: this.sharedCycleTLS,
          sentinelFn: async (l = "username_password_create", m, n) => {
            try {
              const o = await generateSentinelTokens(
                this.proxyUrl,
                "",
                l,
                this.sentinelId,
                n,
              );
              return o;
            } catch (p) {
              logger.info(this.tag + "Sentinel failed: " + p.message);
              return null;
            }
          },
          otpFn: async () => {
            if (this.otpFn) return await this.otpFn();
            logger.info(this.tag + "Kode verifikasi dikirim ke " + this.email + " — cek inbox.");
            return await askTelegram("Masukkan kode verifikasi untuk " + this.email + ": ", this.tag);
          },
          onStep: (l) => logger.info("" + this.tag + l),
        });
      } catch (l) {
        const m =
          l.message?.includes("socket") ||
            l.message?.includes("ECONN") ||
            l.message?.includes("ETIMEDOUT")
            ? "Network/proxy error"
            : l.message;
        logger.warn(this.tag + "Error: " + m);
        if (d < b - 0x1) continue;
        return { success: ![], email: this.email, error: m };
      }
      if (e.success) {
        logger.success(this.tag + "Account created ✓");
        return {
          success: !![],
          email: this.email,
          password: this.password,
          name: this.name,
          accessToken: e.accessToken || null,
          cookies: e.cookieJar || null, // <- tambahkan cookieJar
          message: "Akun berhasil dibuat!",
        };
      }
      const { step: f, status: g, data: h } = e;
      const i = e.error || "";
      let j = i;
      try {
        const n = typeof h === "object" ? h : JSON.parse(i);
        j = n?.error?.message || n?.detail || n?.message || i;
      } catch { }
      if (!j) j = h ? JSON.stringify(h).substring(0x0, 0x64) : "unknown";

      if (j && typeof j === 'string' && j.includes("Invalid authorization step")) {
        logger.error(this.tag + "register: " + j + " (Akun kemungkinan sudah terdaftar. Skip retry)");
        return { success: ![], email: this.email, error: j };
      }
      if (
        f === "init" ||
        f === "csrf" ||
        f === "signin" ||
        f === "register"
      ) {
        const o =
          {
            init: "Init",
            csrf: "CSRF",
            signin: "Sign-in",
            register: "Register",
          }[f] || f;
        if (f === "register" && g === 0x199) {
          logger.warn("" + this.tag + o + ": email conflict (409) — retry");
        } else {
          logger.warn("" + this.tag + o + ": " + j + " — retry");
        }
        if (d < b - 0x1) continue;
      }
      // Jika Register sudah berhasil tapi OTP gagal/salah, JANGAN retry dari awal
      // karena akan memanggil Register lagi dan menyebabkan invalid_auth_step!
      // Kembalikan error khusus agar index.js menanganinya via Recovery Login Flow.
      if (f === "otp_validate") {
        logger.warn(this.tag + "OTP Validate: " + j + " — Register selesai, OTP salah/terlambat. Mengirim sinyal REGISTER_DONE_OTP_FAILED.");
        return { success: ![], email: this.email, error: "REGISTER_DONE_OTP_FAILED" };
      }
      if (f === "otp") {
        logger.warn(this.tag + "OTP tidak diterima — Register selesai. Mengirim sinyal REGISTER_DONE_OTP_FAILED.");
        return { success: ![], email: this.email, error: "REGISTER_DONE_OTP_FAILED" };
      }
      if (f === "create_account") {
        const s = h?.error?.code || "";
        if (s === "unsupported_country") {
          return {
            success: ![],
            email: this.email,
            error: "Country tidak didukung OpenAI. Ganti proxy ke negara lain.",
          };
        }
        logger.error(this.tag + "Create account failed (" + g + "): " + j);
        return {
          success: ![],
          email: this.email,
          error:
            "Create account failed (" + g + "). Coba ganti domain/run ulang.",
        };
      }
      logger.error("" + this.tag + f + ": " + j);
      return { success: ![], email: this.email, error: j || f + " failed" };
    }
    return { success: ![], email: this.email, error: "Semua percobaan habis" };
  }
}
module.exports = ChatGPTSignup;
