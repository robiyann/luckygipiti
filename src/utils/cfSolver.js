const BASE = "https://chatgpt.com";
const AUTH_BASE = "https://auth.openai.com";
const CF_POLL_INTERVAL = 0x5dc;
const CF_MAX_WAIT = 0xea60;
let _stealthApplied = ![];
function parseProxy(a) {
  if (!a) return null;
  try {
    const b = new URL(a);
    return {
      server: b["hostname"] + ":" + b["port"],
      username: decodeURIComponent(b["username"] || ""),
      password: decodeURIComponent(b["password"] || ""),
    };
  } catch {
    return null;
  }
}
function loadPuppeteer() {
  let a, b;
  try {
    a = require("puppeteer-extra");
    b = require("puppeteer-extra-plugin-stealth");
  } catch {
    throw new Error(
      "Missing\x20deps\x20—\x20run:\x20npm\x20install\x20puppeteer\x20puppeteer-extra\x20puppeteer-extra-plugin-stealth",
    );
  }
  if (!_stealthApplied) {
    a["use"](b());
    _stealthApplied = !![];
  }
  return a;
}
async function launchBrowser(a, b) {
  const c = parseProxy(b);
  const d = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,720",
  ];
  if (c?.["server"]) d["push"]("--proxy-server=" + c["server"]);
  const e = await a["launch"]({
    headless: !![],
    args: d,
    ignoreHTTPSErrors: !![],
  });
  const f = await e["newPage"]();
  if (c?.["username"]) {
    await f["authenticate"]({
      username: c["username"],
      password: c["password"],
    });
  }
  await f["setViewport"]({ width: 0x500, height: 0x2d0 });
  return { browser: e, page: f };
}
async function waitForCfClearance(a) {
  const b = Date["now"]() + CF_MAX_WAIT;
  while (Date["now"]() < b) {
    const c = await a["cookies"](BASE);
    if (c["some"]((e) => e["name"] === "cf_clearance")) return !![];
    const d = await a["content"]()["catch"](() => "");
    if (!d["includes"]("cf_chl_opt") && !d["includes"]("challenge-platform"))
      return ![];
    await new Promise((e) => setTimeout(e, CF_POLL_INTERVAL));
  }
  return ![];
}
async function getAuthSession(a, { email: b, deviceId: c, sessionId: d }) {
  const e = loadPuppeteer();
  const { browser: f, page: g } = await launchBrowser(e, a);
  try {
    await g["goto"](BASE + "/", {
      waitUntil: "domcontentloaded",
      timeout: 0x7530,
    })["catch"]((n) => {
      if (
        !n["message"]?.["includes"]("timeout") &&
        !n["message"]?.["includes"]("net::")
      )
        throw n;
    });
    await waitForCfClearance(g);
    const h = await g["evaluate"](async (n) => {
      const o = await fetch(n + "/api/auth/csrf", {
        credentials: "same-origin",
      });
      const p = await o["json"]()["catch"](() => null);
      return p?.["csrfToken"] || null;
    }, BASE);
    if (!h) throw new Error("CSRF\x20fetch\x20failed\x20inside\x20browser");
    const i = new URLSearchParams({
      prompt: "login",
      "ext-oai-did": c,
      auth_session_logging_id: d,
      screen_hint: "login_or_signup",
      login_hint: b,
    })["toString"]();
    const j = new URLSearchParams({
      callbackUrl: BASE + "/",
      csrfToken: h,
      json: "true",
    })["toString"]();
    const k = await g["evaluate"](
      async (n, o, p) => {
        const q = await fetch(n + "/api/auth/signin/openai?" + o, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: p,
          credentials: "same-origin",
        });
        const s = await q["json"]()["catch"](() => null);
        return s?.["url"] || null;
      },
      BASE,
      i,
      j,
    );
    if (!k)
      throw new Error(
        "Signin\x20failed\x20—\x20no\x20authorize\x20URL\x20returned",
      );
    await g["goto"](k, { waitUntil: "domcontentloaded", timeout: 0xea60 })[
      "catch"
    ]((n) => {
      if (
        !n["message"]?.["includes"]("timeout") &&
        !n["message"]?.["includes"]("net::")
      )
        throw n;
    });
    await g["waitForFunction"](
      () =>
        location["href"]["includes"]("/create-account/") ||
        location["href"]["includes"]("/email-verification"),
      { timeout: 0xafc8, polling: 0xc8 },
    )["catch"](() => {});
    const l = await g["cookies"](BASE + "/");
    const m = await g["cookies"](AUTH_BASE + "/");
    return { csrfToken: h, authorizeUrl: k, cookies: [...l, ...m] };
  } finally {
    await f["close"]();
  }
}
async function runSignupViaBrowser(
  a,
  {
    email: b,
    password: c,
    name: d,
    birthdate: e,
    deviceId: f,
    sessionId: g,
    sentinelFn: h,
    otpFn: i,
    onStep: j,
  },
) {
  const k = loadPuppeteer();
  const { browser: l, page: m } = await launchBrowser(k, a);
  try {
    j?.("CF\x20solve\x20(chatgpt.com)");
    await m["goto"](BASE + "/", {
      waitUntil: "domcontentloaded",
      timeout: 0x7530,
    })["catch"]((z) => {
      if (
        !z["message"]?.["includes"]("timeout") &&
        !z["message"]?.["includes"]("net::")
      )
        throw z;
    });
    await waitForCfClearance(m);
    j?.("CSRF\x20✓");
    const n = await m["evaluate"](async (z) => {
      const A = await fetch(z + "/api/auth/csrf", {
        credentials: "same-origin",
      });
      return (await A["json"]()["catch"](() => null))?.["csrfToken"] || null;
    }, BASE);
    if (!n)
      return {
        success: ![],
        step: "csrf",
        error: "CSRF\x20failed\x20in\x20browser",
      };
    j?.("Signin");
    const o = new URLSearchParams({
      prompt: "login",
      "ext-oai-did": f,
      auth_session_logging_id: g,
      screen_hint: "login_or_signup",
      login_hint: b,
    })["toString"]();
    const p = new URLSearchParams({
      callbackUrl: BASE + "/",
      csrfToken: n,
      json: "true",
    })["toString"]();
    const q = await m["evaluate"](
      async (z, A, B) => {
        const C = await fetch(z + "/api/auth/signin/openai?" + A, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: B,
          credentials: "same-origin",
        });
        return (await C["json"]()["catch"](() => null))?.["url"] || null;
      },
      BASE,
      o,
      p,
    );
    if (!q)
      return {
        success: ![],
        step: "signin",
        error: "No\x20authorize\x20URL\x20from\x20signin",
      };
    j?.("Authorize\x20+\x20Sentinel\x20(parallel)");
    const [, r] = await Promise["all"]([
      (async () => {
        await m["goto"](q, { waitUntil: "domcontentloaded", timeout: 0xea60 })[
          "catch"
        ]((z) => {
          if (
            !z["message"]?.["includes"]("timeout") &&
            !z["message"]?.["includes"]("net::")
          )
            throw z;
        });
        await m["waitForFunction"](
          () =>
            location["href"]["includes"]("/create-account/") ||
            location["href"]["includes"]("/email-verification"),
          { timeout: 0xafc8, polling: 0xc8 },
        )["catch"](() => {});
        await m["waitForSelector"]("input[type=\x22password\x22]", {
          timeout: 0x7530,
        })["catch"](() => {});
      })(),
      (async () => {
        try {
          return await h?.();
        } catch {
          return null;
        }
      })(),
    ]);
    const s = await m["cookies"](AUTH_BASE + "/");
    j?.(
      "Register\x20(page:\x20" +
        m["url"]()["replace"]("https://auth.openai.com", "") +
        "\x20|\x20" +
        s["length"] +
        "\x20cookies)",
    );
    await m["waitForSelector"]("input[type=\x22password\x22]", {
      timeout: 0x4e20,
    })["catch"](() => {});
    let t = null,
      u = null;
    const v = async (z) => {
      if (z["url"]()["includes"]("/api/accounts/user/register")) {
        t = z["status"]();
        u = await z["json"]()["catch"](() => null);
      }
    };
    m["on"]("response", v);
    try {
      await m["focus"]("input[type=\x22password\x22]");
      await m["type"]("input[type=\x22password\x22]", c, { delay: 0x50 });
      await m["waitForFunction"](
        () => {
          const B =
            document["querySelector"]("button[type=\x22submit\x22]") ||
            Array["from"](document["querySelectorAll"]("button"))["find"]((C) =>
              /continue|create|next/i["test"](C["textContent"]),
            );
          return B && !B["disabled"] && !B["getAttribute"]("aria-disabled");
        },
        { timeout: 0x1f40 },
      )["catch"](() => {});
      await new Promise((B) => setTimeout(B, 0x12c));
      const z = await m["evaluate"](() => {
        const B =
          document["querySelector"]("button[type=\x22submit\x22]") ||
          Array["from"](document["querySelectorAll"]("button"))["find"]((C) =>
            /continue|create|next/i["test"](C["textContent"]),
          );
        if (B) {
          B["click"]();
          return B["textContent"]?.["trim"]() || "clicked";
        }
        return ![];
      });
      if (!z) {
        await m["focus"]("input[type=\x22password\x22]");
        await m["keyboard"]["press"]("Enter");
      }
      const A = Date["now"]() + 0x3a98;
      while (Date["now"]() < A && t === null) {
        await new Promise((B) => setTimeout(B, 0xc8));
      }
    } finally {
      m["off"]("response", v);
    }
    if (t === null) {
      j?.("Register\x20fallback\x20(direct\x20fetch)");
      const B = await m["evaluate"](
        async (C, D, E) => {
          const F = { "Content-Type": "application/json" };
          if (E) F["openai-sentinel-token"] = E;
          const G = await fetch(C + "/api/accounts/user/register", {
            method: "POST",
            headers: F,
            body: JSON["stringify"](D),
            credentials: "include",
          });
          return {
            status: G["status"],
            data: await G["json"]()["catch"](() => null),
          };
        },
        AUTH_BASE,
        { password: c, username: b },
        r,
      );
      t = B["status"];
      u = B["data"];
    }
    if (t !== 0xc8) {
      return { success: ![], step: "register", status: t, data: u };
    }
    j?.("OTP\x20send");
    await m["evaluate"](async (C) => {
      await fetch(C + "/api/accounts/email-otp/send", {
        credentials: "include",
      });
    }, AUTH_BASE);
    j?.("OTP\x20wait");
    const w = await i?.();
    if (!w)
      return { success: ![], step: "otp", error: "OTP\x20not\x20received" };
    j?.("OTP\x20validate\x20(" + w + ")");
    const x = await m["evaluate"](
      async (C, D) => {
        const E = await fetch(C + "/api/accounts/email-otp/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: C,
            Referer: C + "/email-verification",
          },
          body: JSON["stringify"]({ code: D }),
          credentials: "include",
        });
        return {
          status: E["status"],
          data: await E["json"]()["catch"](() => null),
        };
      },
      AUTH_BASE,
      w["toString"](),
    );
    if (x["status"] !== 0xc8) {
      return {
        success: ![],
        step: "otp_validate",
        status: x["status"],
        data: x["data"],
      };
    }
    j?.("Create\x20account");
    const y = await m["evaluate"](
      async (C, D) => {
        const E = await fetch(C + "/api/accounts/create_account", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: C,
            Referer: C + "/about-you",
          },
          body: JSON["stringify"](D),
          credentials: "include",
        });
        return {
          status: E["status"],
          data: await E["json"]()["catch"](() => null),
        };
      },
      AUTH_BASE,
      { name: d, birthdate: e },
    );
    if (y["status"] !== 0xc8) {
      return {
        success: ![],
        step: "create_account",
        status: y["status"],
        data: y["data"],
      };
    }
    return { success: !![] };
  } finally {
    await l["close"]();
  }
}
module["exports"] = {
  runSignupViaBrowser: runSignupViaBrowser,
  getAuthSession: getAuthSession,
};
