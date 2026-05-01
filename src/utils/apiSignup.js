const initCycleTLS = require("cycletls");
const BASE = "https://chatgpt.com";
const AUTH_BASE = "https://auth.openai.com";
const CHROME_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0";
const CHROME_H2 = "1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p";
const CHROME_UA =
  "Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/147.0.0.0\x20Safari/537.36";
const CHROME_SEC_CH_UA =
  "\x22Chromium\x22;v=\x22147\x22,\x20\x22Not/A)Brand\x22;v=\x2224\x22,\x20\x22Google\x20Chrome\x22;v=\x22147\x22";
class CookieJar {
  constructor() {
    this["store"] = new Map();
  }
  ["capture"](a, b) {
    const c = new URL(b)["hostname"];
    const d = a?.["Set-Cookie"] || a?.["set-cookie"];
    if (!d) return;
    const e = Array["isArray"](d) ? d : [d];
    for (const f of e) {
      const g = f["match"](/^([^=]+)=([^;]*)/);
      if (!g) continue;
      const h = g[0x1]["trim"]();
      const i = g[0x2];
      const j = f["match"](/[;]\s*[Dd]omain=\.?([^;,\s]+)/i);
      const k = j ? j[0x1]["toLowerCase"]() : c;
      if (!this["store"]["has"](k)) this["store"]["set"](k, new Map());
      this["store"]["get"](k)["set"](h, i);
    }
  }
  ["headerFor"](a) {
    const b = new URL(a)["hostname"];
    const c = [];
    for (const [d, e] of this["store"]) {
      if (
        b === d ||
        b["endsWith"]("." + d) ||
        d["endsWith"]("." + b) ||
        b["includes"](d)
      ) {
        for (const [f, g] of e) {
          c["push"](f + "=" + g);
        }
      }
    }
    return c["length"] ? c["join"](";\x20") : undefined;
  }
  ["count"]() {
    let a = 0x0;
    for (const b of this["store"]["values"]()) a += b["size"];
    return a;
  }
}
class TLSSession {
  constructor(a, b) {
    this["tls"] = a;
    this["proxy"] = b || undefined;
    this["jar"] = new CookieJar();
  }
  ["_baseOpts"](a, b = {}) {
    const c = this["jar"]["headerFor"](a);
    return {
      ja3: CHROME_JA3,
      http2Fingerprint: CHROME_H2,
      userAgent: CHROME_UA,
      timeout: 0x3c,
      proxy: this["proxy"],
      disableRedirect: !![],
      enableConnectionReuse: !![],
      headers: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": CHROME_SEC_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\x22Windows\x22",
        ...(c ? { Cookie: c } : {}),
        ...b,
      },
    };
  }
  async ["get"](a, b = {}) {
    const c = this["_baseOpts"](a, {
      Accept: "application/json",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...b,
    });
    const d = await this["tls"](a, c, "get");
    this["jar"]["capture"](d["headers"], d["finalUrl"] || a);
    return d;
  }
  async ["getHtml"](a, b = {}) {
    const c = this["_baseOpts"](a, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      ...b,
    });
    const d = await this["tls"](a, c, "get");
    this["jar"]["capture"](d["headers"], d["finalUrl"] || a);
    return d;
  }
  async ["post"](a, b, c = {}) {
    const d = this["_baseOpts"](a, {
      Accept: "application/json",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      ...c,
    });
    d["body"] = typeof b === "string" ? b : JSON["stringify"](b);
    const e = await this["tls"](a, d, "post");
    this["jar"]["capture"](e["headers"], e["finalUrl"] || a);
    return e;
  }
  async ["followRedirects"](a, b = {}, c = 0xf, d) {
    let e = a;
    let f;
    for (let g = 0x0; g < c; g++) {
      d?.("\x20\x20→\x20[" + (g + 0x1) + "]\x20" + e["substring"](0x0, 0x50));
      f = await this["getHtml"](e, {
        ...(g === 0x0 ? { Referer: BASE + "/" } : { Referer: e }),
        ...b,
      });
      d?.(
        "\x20\x20\x20\x20←\x20" +
        f["status"] +
        "\x20(cookies:\x20" +
        this["jar"]["count"]() +
        ")",
      );
      const h = f["headers"]?.["Location"] || f["headers"]?.["location"];
      if (f["status"] >= 0x12c && f["status"] < 0x190 && h) {
        e = new URL(h, e)["href"];
      } else {
        break;
      }
    }
    return { ...f, finalUrl: e };
  }
  async ["close"]() {
    try {
      await this["tls"]["exit"]();
    } catch { }
  }
}
async function runSignupViaAPI(
  a,
  {
    email: b,
    password: c,
    name: d,
    birthdate: f,
    deviceId: g,
    sessionId: h,
    sentinelFn: i,
    otpFn: j,
    onStep: k,
    sharedCycleTLS: l,
  },
) {
  const m = await initCycleTLS();
  const n = new TLSSession(m, a);
  try {
    k?.("Init\x20session");
    if (!n["jar"]["store"]["has"]("chatgpt.com")) {
      n["jar"]["store"]["set"]("chatgpt.com", new Map());
    }
    n["jar"]["store"]["get"]("chatgpt.com")["set"]("oai-did", g);
    const o = await n["getHtml"](BASE + "/");
    if (o["status"] !== 0xc8) {
      const V =
        o["headers"]?.["Cf-Mitigated"] || o["headers"]?.["cf-mitigated"] || "";
      return {
        success: ![],
        step: "init",
        status: o["status"],
        error:
          "Failed\x20to\x20reach\x20chatgpt.com\x20(HTTP\x20" +
          o["status"] +
          (V ? ",\x20CF:" + V : "") +
          ")",
      };
    }
    let p = g;
    for (const [W, X] of n["jar"]["store"]) {
      if (W["includes"]("chatgpt")) {
        const Y = X["get"]("oai-did");
        if (Y) {
          p = Y;
          break;
        }
      }
    }
    if (p !== g) {
      for (const [Z, a0] of n["jar"]["store"]) {
        if (Z["includes"]("chatgpt") && a0["has"]("oai-did")) {
          a0["set"]("oai-did", p);
        }
      }
    }
    const q = await n["get"](BASE + "/api/auth/csrf", {
      Referer: BASE + "/",
      "oai-device-id": p,
      "oai-language": "en-US",
    });
    let r;
    try {
      r = await q["json"]();
    } catch { }
    const s = r?.["csrfToken"];
    if (!s) {
      return {
        success: ![],
        step: "csrf",
        status: q["status"],
        error: "No\x20CSRF\x20token",
      };
    }
    k?.("CSRF\x20✓");
    const u = new URLSearchParams({
      prompt: "login",
      "ext-oai-did": p,
      auth_session_logging_id: h,
      screen_hint: "login_or_signup",
      login_hint: b,
      "ext-passkey-client-capabilities": "0111",
    })["toString"]();
    const v = new URLSearchParams({
      callbackUrl: BASE + "/",
      csrfToken: s,
      json: "true",
    })["toString"]();
    const w = await n["post"](BASE + "/api/auth/signin/openai?" + u, v, {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
      Referer: BASE + "/",
      "oai-device-id": p,
      "oai-language": "en-US",
    });
    let x;
    try {
      x = await w["json"]();
    } catch { }
    const y = x?.["url"];
    if (!y) {
      return {
        success: ![],
        step: "signin",
        status: w["status"],
        error: "No\x20authorize\x20URL",
      };
    }
    k?.("Authorize...");
    const z = await n["followRedirects"](y, {}, 0xf);
    const A = z["finalUrl"] || "";
    if (
      !A["includes"]("/create-account") &&
      !A["includes"]("/email-verification")
    ) {
      if (A["includes"]("/log-in")) {
        return {
          success: ![],
          step: "authorize",
          error: "Email\x20already\x20registered\x20(login\x20page)",
        };
      }
    }
    k?.("Authorize\x20✓");
    const B = [];
    let C = null;
    for (const [a1, a2] of n["jar"]["store"]) {
      for (const [a3, a4] of a2) {
        B["push"]({ name: a3, value: a4, domain: a1 });
        if (a3 === "oai-did") C = a4;
      }
    }
    k?.("Sentinel..." + (C !== p ? "\x20✗\x20oai-did\x20MISMATCH!" : ""));
    let D = null;
    for (let a5 = 0x0; a5 < 0x2; a5++) {
      try {
        const a6 = await i?.("username_password_create", B, m);
        if (a6 && typeof a6 === "object" && a6["sentinelToken"]) {
          k?.("Sentinel\x20✓\x20(" + a6["sentinelToken"]["length"] + "ch)");
          D = a6;
          break;
        }
      } catch (a7) {
        k?.("Sentinel\x20attempt\x20" + (a5 + 0x1) + ":\x20" + a7["message"]);
      }
    }
    if (!D || !D["sentinelToken"]) {
      return {
        success: ![],
        step: "register",
        status: 0x0,
        error:
          "Sentinel\x20token\x20not\x20available\x20—\x20skipping\x20register",
      };
    }
    const E = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (D && typeof D === "object") {
      if (D["sentinelToken"]) {
        E["OpenAI-Sentinel-Token"] = D["sentinelToken"];
      }
      if (D["soToken"]) {
        E["OpenAI-Sentinel-SO-Token"] = D["soToken"];
      }
    } else if (typeof D === "string") {
      E["OpenAI-Sentinel-Token"] = D;
    }
    const F = AUTH_BASE + "/api/accounts/user/register";
    const G = n["jar"]["headerFor"](F);
    const H = [];
    for (const [a8, a9] of n["jar"]["store"]) {
      if (a8["includes"]("openai") || a8["includes"]("auth")) {
        for (const [aa] of a9) H["push"](aa + "@" + a8);
      }
    }
    k?.("Register...");
    const I = {
      ja3: CHROME_JA3,
      http2Fingerprint: CHROME_H2,
      userAgent: CHROME_UA,
      timeout: 0x3c,
      proxy: n["proxy"],
      enableConnectionReuse: !![],
      headers: {
        ...E,
        ...(G ? { Cookie: G } : {}),
        Origin: AUTH_BASE,
        Referer: AUTH_BASE + "/create-account/password",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-ch-ua": CHROME_SEC_CH_UA,
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\x22Windows\x22",
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: JSON["stringify"]({ password: c, username: b }),
    };
    const J = await n["tls"](F, I, "post");
    n["jar"]["capture"](J["headers"], F);
    const K = J["status"];
    let L;
    try {
      L = await J["json"]();
    } catch { }
    if (!L) {
      try {
        const ab = await J["text"]();
        if (ab) L = JSON["parse"](ab);
      } catch { }
    }
    if (K !== 0xc8) {
      const ac =
        L?.["detail"] ||
        L?.["error"]?.["message"] ||
        L?.["message"] ||
        L?.["error"] ||
        JSON["stringify"](L || "empty\x20response");
      const ad = require("./logger");
      ad["info"](
        "Register\x20" +
        K +
        "\x20full\x20response:\x20" +
        JSON["stringify"](L)["substring"](0x0, 0x1f4),
      );
      ad["info"](
        "Register\x20headers\x20sent:\x20sentinel=" +
        (E["OpenAI-Sentinel-Token"]?.["length"] || 0x0) +
        "ch,\x20so=" +
        (E["OpenAI-Sentinel-SO-Token"]?.["length"] || 0x0) +
        "ch,\x20cookie=" +
        (G?.["length"] || 0x0) +
        "ch",
      );
      k?.("Register\x20✗\x20(" + K + "):\x20" + ac);
      return { success: ![], step: "register", status: K, error: "" + ac };
    }
    k?.("Register\x20✓");
    await n["get"](AUTH_BASE + "/api/accounts/email-otp/send", {
      Referer: AUTH_BASE + "/email-verification",
    });
    k?.("OTP:\x20waiting...");
    let N;
    let otpSuccess = false;
    for (let otpRetry = 0; otpRetry < 3; otpRetry++) {
      const M = await j?.();
      if (!M) return { success: ![], step: "otp", error: "OTP\x20not\x20received" };
      k?.("OTP\x20✓\x20(" + M + ")" + (otpRetry > 0 ? " [Retry " + otpRetry + "]" : ""));
      
      N = await n["post"](
        AUTH_BASE + "/api/accounts/email-otp/validate",
        { code: M["toString"]() },
        {
          "Content-Type": "application/json",
          Origin: AUTH_BASE,
          Referer: AUTH_BASE + "/email-verification",
          "sec-fetch-site": "same-origin",
        },
      );

      if (N["status"] === 0xc8) {
        otpSuccess = true;
        break;
      }

      let errorData;
      try { errorData = await N["json"](); } catch (e) {}
      const errorStr = errorData?.detail || errorData?.message || "Wrong code";
      
      if (otpRetry < 2) {
        k?.("OTP Salah: " + errorStr + ". Mencoba lagi...");
        // Beri jeda sedikit sebelum retry fetch
        await new Promise(r => setTimeout(r, 2000));
      } else {
        return {
          success: ![],
          step: "otp_validate",
          status: N["status"],
          data: errorData,
        };
      }
    }
    k?.("Finalizing...");
    let O = null;
    try {
      O = await i?.("oauth_create_account", null, m);
    } catch (af) {
      k?.("Sentinel\x20(finalize):\x20failed");
    }
    const P = {
      "Content-Type": "application/json",
      Origin: AUTH_BASE,
      Referer: AUTH_BASE + "/about-you",
      "sec-fetch-site": "same-origin",
    };
    if (O && typeof O === "object") {
      if (O["sentinelToken"]) {
        P["OpenAI-Sentinel-Token"] = O["sentinelToken"];
      }
      if (O["soToken"]) {
        P["OpenAI-Sentinel-SO-Token"] = O["soToken"];
      }
    } else if (typeof O === "string") {
      P["OpenAI-Sentinel-Token"] = O;
    }
    const Q = await n["post"](
      AUTH_BASE + "/api/accounts/create_account",
      { name: d, birthdate: f },
      P,
    );
    const R = Q["status"];
    let S;
    try {
      S = await Q["json"]();
    } catch { }
    if (R !== 0xc8) {
      const bodySnippet = S ? JSON["stringify"](S).substring(0, 200) : "empty";
      k?.("Finalize\x20✗\x20(" + R + "):\x20" + bodySnippet);
      return { success: ![], step: "create_account", status: R, data: S };
    }
    const T = S?.["continue_url"];
    let U = null;
    if (T) {
      const ag = T["startsWith"]("http") ? T : "" + AUTH_BASE + T;
      k?.("OAuth\x20callback...");
      await n["followRedirects"](ag, {}, 0xf);
      k?.("OAuth\x20✓");
      // Retry session endpoint: OpenAI kadang delay mengembalikan token
      for (let _s = 0; _s < 4; _s++) {
        if (_s > 0) await new Promise(r => setTimeout(r, 2000));
        const ah = await n["get"](BASE + "/api/auth/session", {
          Referer: BASE + "/",
        });
        let ai;
        try {
          ai = await ah["json"]();
        } catch { }
        U = ai?.["accessToken"] || null;
        if (U) break;
        k?.("Session belum ready, retry (" + (_s + 1) + "/4)...");
      }
    }
    k?.("Done\x20✓");
    return { success: !![], accessToken: U };
  } finally {
    await n["close"]();
  }
}
async function runLoginViaAPI(
  a,
  {
    email: b,
    password: c,
    deviceId: d,
    sessionId: f,
    otpFn: g,
    sentinelFn: h,
    onStep: j,
    sharedCycleTLS: k,
  },
) {
  const l = !k;
  const m = k || (await initCycleTLS());
  const n = new TLSSession(m, a);
  try {
    j?.("Init\x20session");
    const o = await n["getHtml"](BASE + "/");
    if (o["status"] !== 0xc8) {
      const B =
        o["headers"]?.["Cf-Mitigated"] || o["headers"]?.["cf-mitigated"] || "";
      return {
        success: ![],
        step: "init",
        error:
          "Failed\x20to\x20reach\x20chatgpt.com\x20(HTTP\x20" +
          o["status"] +
          (B ? ",\x20CF:" + B : "") +
          ")",
      };
    }
    const p = await n["get"](BASE + "/api/auth/csrf", { Referer: BASE + "/" });
    let q;
    try {
      q = await p["json"]();
    } catch { }
    const r = q?.["csrfToken"];
    if (!r) {
      return { success: ![], step: "csrf", error: "No\x20CSRF\x20token" };
    }
    j?.("CSRF\x20✓");
    const s = new URLSearchParams({
      prompt: "login",
      "ext-oai-did": d,
      auth_session_logging_id: f,
      "ext-passkey-client-capabilities": "0111",
      screen_hint: "login_or_signup",
      login_hint: b,
    })["toString"]();
    const t = new URLSearchParams({
      callbackUrl: BASE + "/",
      csrfToken: r,
      json: "true",
    })["toString"]();
    const u = await n["post"](BASE + "/api/auth/signin/openai?" + s, t, {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: BASE,
      Referer: BASE + "/",
    });
    let v;
    try {
      v = await u["json"]();
    } catch { }
    const w = v?.["url"];
    if (!w) {
      return {
        success: ![],
        step: "signin",
        status: u["status"],
        error: "No\x20authorize\x20URL",
      };
    }
    j?.("Authorize...");
    const x = await n["followRedirects"](w, {}, 0xf);
    const y = x["finalUrl"] || "";
    const z = async (C) => {
      const D = C["startsWith"]("http") ? C : "" + AUTH_BASE + C;
      const E = await n["followRedirects"](D, {}, 0xf);
      return E;
    };
    if (y["includes"]("chatgpt.com")) {
      j?.("Already\x20logged\x20in\x20✓");
    } else if (y["includes"]("/email-verification")) {
      j?.("Email\x20verification...");
      const C = await g?.();
      await n["get"](AUTH_BASE + "/api/accounts/email-otp/send", {
        Referer: AUTH_BASE + "/email-verification",
      });
      j?.("OTP: waiting...");
      const D = await g?.();

      if (!D) {
        return { success: ![], step: "otp", error: "OTP\x20not\x20received" };
      }
      j?.("OTP\x20✓\x20(" + D + ")");
      const E = await n["post"](
        AUTH_BASE + "/api/accounts/email-otp/validate",
        { code: D["toString"]() },
        {
          "Content-Type": "application/json",
          Origin: AUTH_BASE,
          Referer: AUTH_BASE + "/email-verification",
        },
      );
      let F;
      try {
        F = await E["json"]();
      } catch { }
      if (E["status"] !== 0xc8) {
        return {
          success: ![],
          step: "otp_validate",
          status: E["status"],
          data: F,
        };
      }
      const G = F?.["continue_url"] || "";
      j?.(
        "OTP\x20validated\x20→\x20" +
        (G["substring"](0x0, 0x3c) || "(empty\x20body)"),
      );
      if (G["includes"]("callback") || G["includes"]("code=")) {
        j?.("OAuth\x20callback...");
        await z(G);
        j?.("OAuth\x20✓");
      } else if (G["includes"]("/about-you")) {
        j?.("Profile\x20incomplete,\x20creating...");
        const J = {
          "Content-Type": "application/json",
          Origin: AUTH_BASE,
          Referer: AUTH_BASE + "/about-you",
        };
        if (h) {
          try {
            const N = await h("oauth_create_account");
            if (N && typeof N === "object") {
              if (N["sentinelToken"])
                J["OpenAI-Sentinel-Token"] = N["sentinelToken"];
              if (N["soToken"]) J["OpenAI-Sentinel-SO-Token"] = N["soToken"];
            } else if (typeof N === "string") {
              J["OpenAI-Sentinel-Token"] = N;
            }
          } catch (O) {
            j?.("Sentinel\x20✗\x20(" + O["message"] + ")");
          }
        }
        const K = b["split"]("@")[0x0]["replace"](/[^a-zA-Z\s]/g, "") || "User";
        const L = await n["post"](
          AUTH_BASE + "/api/accounts/create_account",
          { name: K, birthdate: "1995-06-15" },
          J,
        );
        let M;
        try {
          M = await L["json"]();
        } catch { }
        if (L["status"] === 0xc8 && M?.["continue_url"]) {
          j?.("Profile\x20✓");
          const P = await z(M["continue_url"]);
          if (!P["finalUrl"]?.["includes"]("chatgpt.com")) {
            j?.("Re-authorize...");
            const Q = await n["followRedirects"](w, {}, 0xf);
            if (!Q["finalUrl"]?.["includes"]("chatgpt.com")) {
              return {
                success: ![],
                step: "create_account_oauth",
                error:
                  "Ended\x20on:\x20" + Q["finalUrl"]?.["substring"](0x0, 0x64),
              };
            }
          }
          j?.("OAuth\x20✓");
        } else {
          j?.(
            "Profile\x20✗\x20(" +
            L["status"] +
            ":\x20" +
            JSON["stringify"](M)["substring"](0x0, 0x64) +
            ")",
          );
          return {
            success: ![],
            step: "create_account",
            status: L["status"],
            data: M,
          };
        }
      } else {
        j?.("Re-authorize\x20(original\x20URL)...");
        const R = await n["followRedirects"](w, {}, 0xf);
        const S = R["finalUrl"] || "";
        if (S["includes"]("chatgpt.com")) {
          j?.("OAuth\x20✓");
        } else {
          j?.("Re-auth\x20→\x20" + S["substring"](0x0, 0x3c));
          return {
            success: ![],
            step: "reauthorize",
            error: "Ended\x20on:\x20" + S["substring"](0x0, 0x64),
          };
        }
      }
    } else if (y["includes"]("/log-in") || y["includes"]("/password")) {
      j?.("Password...");
      const T = await n["post"](
        AUTH_BASE + "/api/accounts/password/verify",
        { password: c },
        {
          "Content-Type": "application/json",
          Origin: AUTH_BASE,
          Referer: AUTH_BASE + "/log-in/password",
        },
      );
      let U;
      try {
        U = await T["json"]();
      } catch { }
      if (T["status"] !== 0xc8) {
        j?.("Password\x20✗\x20(" + T["status"] + ")");
        return { success: ![], step: "password", status: T["status"], data: U };
      }
      j?.("Password\x20✓");
      if (U?.["continue_url"]) {
        const V = await z(U["continue_url"]);
        if (!V["finalUrl"]?.["includes"]("chatgpt.com")) {
          return {
            success: ![],
            step: "password_oauth",
            error: "Ended\x20on:\x20" + V["finalUrl"]?.["substring"](0x0, 0x50),
          };
        }
        j?.("OAuth\x20✓");
      }
    } else {
      return {
        success: ![],
        step: "authorize",
        error: "Unexpected\x20page:\x20" + y["substring"](0x0, 0x50),
      };
    }
    j?.("Token...");
    let A = null;
    for (let W = 0x0; W < 0x3; W++) {
      const X = await n["get"](BASE + "/api/auth/session", {
        Referer: BASE + "/",
      });
      let Y;
      try {
        Y = await X["json"]();
      } catch { }
      if (Y?.["accessToken"]) {
        A = Y["accessToken"];
        break;
      }
    }
    if (!A) {
      j?.("Token\x20✗");
      return {
        success: ![],
        step: "token",
        error: "Access\x20token\x20not\x20found",
      };
    }
    j?.("Token\x20✓");
    return { success: !![], accessToken: A, cookieJar: n["jar"] };
  } finally {
    if (l) await n["close"]();
  }
}
module["exports"] = {
  runSignupViaAPI: runSignupViaAPI,
  runLoginViaAPI: runLoginViaAPI,
};
