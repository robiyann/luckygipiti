const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { HttpsProxyAgent } = require("https-proxy-agent");
const USER_AGENTS = [
  {
    ua: "Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/137.0.0.0\x20Safari/537.36",
    ch: "\x22Chromium\x22;v=\x22137\x22,\x20\x22Not/A)Brand\x22;v=\x2224\x22,\x20\x22Google\x20Chrome\x22;v=\x22137\x22",
    platform: "\x22Windows\x22",
  },
  {
    ua: "Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/136.0.0.0\x20Safari/537.36",
    ch: "\x22Chromium\x22;v=\x22136\x22,\x20\x22Not.A/Brand\x22;v=\x2299\x22,\x20\x22Google\x20Chrome\x22;v=\x22136\x22",
    platform: "\x22Windows\x22",
  },
  {
    ua: "Mozilla/5.0\x20(Macintosh;\x20Intel\x20Mac\x20OS\x20X\x2010_15_7)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/137.0.0.0\x20Safari/537.36",
    ch: "\x22Chromium\x22;v=\x22137\x22,\x20\x22Not/A)Brand\x22;v=\x2224\x22,\x20\x22Google\x20Chrome\x22;v=\x22137\x22",
    platform: "\x22macOS\x22",
  },
  {
    ua: "Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/137.0.0.0\x20Safari/537.36\x20Edg/137.0.0.0",
    ch: "\x22Not/A)Brand\x22;v=\x2224\x22,\x20\x22Microsoft\x20Edge\x22;v=\x22137\x22,\x20\x22Chromium\x22;v=\x22137\x22",
    platform: "\x22Windows\x22",
  },
  {
    ua: "Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/136.0.0.0\x20Safari/537.36\x20Edg/136.0.0.0",
    ch: "\x22Not.A/Brand\x22;v=\x2299\x22,\x20\x22Microsoft\x20Edge\x22;v=\x22136\x22,\x20\x22Chromium\x22;v=\x22136\x22",
    platform: "\x22Windows\x22",
  },
  {
    ua: "Mozilla/5.0\x20(Macintosh;\x20Intel\x20Mac\x20OS\x20X\x2010_15_7)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/136.0.0.0\x20Safari/537.36\x20Edg/136.0.0.0",
    ch: "\x22Not.A/Brand\x22;v=\x2299\x22,\x20\x22Microsoft\x20Edge\x22;v=\x22136\x22,\x20\x22Chromium\x22;v=\x22136\x22",
    platform: "\x22macOS\x22",
  },
  {
    ua: "Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64;\x20rv:138.0)\x20Gecko/20100101\x20Firefox/138.0",
    ch: null,
    platform: null,
  },
  {
    ua: "Mozilla/5.0\x20(Macintosh;\x20Intel\x20Mac\x20OS\x20X\x2010.15;\x20rv:138.0)\x20Gecko/20100101\x20Firefox/138.0",
    ch: null,
    platform: null,
  },
  {
    ua: "Mozilla/5.0\x20(Windows\x20NT\x2010.0;\x20Win64;\x20x64)\x20AppleWebKit/537.36\x20(KHTML,\x20like\x20Gecko)\x20Chrome/135.0.0.0\x20Safari/537.36",
    ch: "\x22Chromium\x22;v=\x22135\x22,\x20\x22Not-A.Brand\x22;v=\x228\x22,\x20\x22Google\x20Chrome\x22;v=\x22135\x22",
    platform: "\x22Windows\x22",
  },
  {
    ua: "Mozilla/5.0\x20(Macintosh;\x20Intel\x20Mac\x20OS\x20X\x2010_15_7)\x20AppleWebKit/605.1.15\x20(KHTML,\x20like\x20Gecko)\x20Version/18.4\x20Safari/605.1.15",
    ch: null,
    platform: null,
  },
];
function getRandomUA() {
  return USER_AGENTS[Math["floor"](Math["random"]() * USER_AGENTS["length"])];
}
const USER_AGENT = USER_AGENTS[0x0]["ua"];
function createClient(a) {
  const b = new CookieJar();
  const c = getRandomUA();
  const d = {
    "User-Agent": c["ua"],
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip,\x20deflate,\x20br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };
  if (c["ch"]) {
    d["sec-ch-ua"] = c["ch"];
    d["sec-ch-ua-mobile"] = "?0";
    d["sec-ch-ua-platform"] = c["platform"];
  }
  const e = {
    maxRedirects: 0x0,
    validateStatus: (g) => g < 0x1f4,
    headers: d,
    timeout: 0x7530,
  };
  if (a) {
    const g = new HttpsProxyAgent(a);
    e["httpsAgent"] = g;
    e["httpAgent"] = g;
    e["proxy"] = ![];
  }
  const f = axios["create"](e);
  f["interceptors"]["request"]["use"](async (h) => {
    try {
      const i = await b["getCookieString"](h["url"] || h["baseURL"] || "");
      if (i) {
        h["headers"] = h["headers"] || {};
        h["headers"]["Cookie"] = i;
      }
    } catch (j) {}
    return h;
  });
  f["interceptors"]["response"]["use"](async (h) => {
    try {
      const i = h["headers"]["set-cookie"];
      if (i) {
        const j = h["config"]["url"] || h["config"]["baseURL"] || "";
        const k = Array["isArray"](i) ? i : [i];
        for (const l of k) {
          await b["setCookie"](l, j);
        }
      }
    } catch (m) {}
    return h;
  });
  f["followRedirects"] = async function (h, j = {}, k = 0xa) {
    let l = h;
    let m;
    for (let n = 0x0; n < k; n++) {
      m = await f["get"](l, { ...j, maxRedirects: 0x0 });
      if (
        m["status"] >= 0x12c &&
        m["status"] < 0x190 &&
        m["headers"]["location"]
      ) {
        l = new URL(m["headers"]["location"], l)["href"];
      } else {
        break;
      }
    }
    return m;
  };
  return { client: f, jar: b };
}
function buildProxyUrl(a, b, c, d, e) {
  const f = Math["random"]()["toString"](0x24)["substring"](0x2, 0xa);
  const g = b + "__cr." + a + "__sid." + f;
  return "http://" + g + ":" + c + "@" + d + ":" + e;
}
module["exports"] = {
  createClient: createClient,
  buildProxyUrl: buildProxyUrl,
  USER_AGENT: USER_AGENT,
};
