"use strict";
const logger = require("./logger");
function xorDecrypt(a, b) {
  let c = "";
  for (let d = 0x0; d < a["length"]; d++) {
    c += String["fromCharCode"](
      a["charCodeAt"](d) ^ b["charCodeAt"](d % b["length"]),
    );
  }
  return c;
}
function btoa(a) {
  return Buffer["from"](a, "binary")["toString"]("base64");
}
function atob(a) {
  return Buffer["from"](a, "base64")["toString"]("binary");
}
function createMockWindow(a, b, c) {
  const d = Date["now"]();
  const e = d - Math["random"]() * 0xea60;
  const f = {
    userAgent: a,
    language: "en-US",
    languages: ["en-US", "en"],
    hardwareConcurrency: 0xc,
    platform: "Win32",
    maxTouchPoints: 0x0,
    vendor: "Google\x20Inc.",
    vendorSub: "",
    productSub: "20030107",
    product: "Gecko",
    appCodeName: "Mozilla",
    appName: "Netscape",
    appVersion: a["replace"]("Mozilla/", ""),
    cookieEnabled: !![],
    doNotTrack: null,
    onLine: !![],
    webdriver: ![],
    pdfViewerEnabled: !![],
    deviceMemory: 0x8,
    connection: {
      effectiveType: "4g",
      downlink: 0xa,
      rtt: 0x32,
      saveData: ![],
    },
    plugins: { length: 0x5 },
    mimeTypes: { length: 0x2 },
    geolocation: {},
    bluetooth: {},
    clipboard: {},
    credentials: {},
    keyboard: {},
    managed: {},
    mediaDevices: {},
    storage: {},
    serviceWorker: { controller: null },
    virtualKeyboard: {},
    wakeLock: {},
    ink: {},
    hid: {},
    locks: {},
    gpu: {},
    mediaCapabilities: {},
    mediaSession: {},
    permissions: {},
    presentation: {},
    serial: {},
    usb: {},
    windowControlsOverlay: {},
    xr: {},
    userAgentData: { brands: [], mobile: ![], platform: "Windows" },
    scheduling: {},
    userActivation: { hasBeenActive: !![], isActive: !![] },
    joinAdInterestGroup: function () {},
    leaveAdInterestGroup: function () {},
    updateAdInterestGroups: function () {},
    registerProtocolHandler: function () {},
    getGamepads: function () {
      return [];
    },
    javaEnabled: function () {
      return ![];
    },
    sendBeacon: function () {
      return !![];
    },
    vibrate: function () {
      return !![];
    },
  };
  const g = {
    width: 0x780,
    height: 0x438,
    availWidth: 0x780,
    availHeight: 0x410,
  };
  const h = {
    now: () => Date["now"]() - e,
    timeOrigin: e,
    timing: { domComplete: e + 0x9c4 + Math["random"]() * 0x3e8 },
    memory: {
      jsHeapSizeLimit: 0xfffc0000,
      totalJSHeapSize: 0x2faf080,
      usedJSHeapSize: 0x1c9c380,
    },
  };
  const i = {
    scripts: [
      { src: c || "https://sentinel.openai.com/backend-api/sentinel/sdk.js" },
    ],
    cookie: b ? "oai-did=" + b : "",
    documentElement: {
      getAttribute: (m) => {
        if (m === "data-build") return null;
        return null;
      },
    },
    location: { href: "https://chatgpt.com/", search: "" },
    URL: "https://chatgpt.com/",
    documentURI: "https://chatgpt.com/",
    compatMode: "CSS1Compat",
    characterSet: "UTF-8",
    contentType: "text/html",
    doctype: {},
    domain: "chatgpt.com",
    referrer: "",
    readyState: "complete",
    title: "ChatGPT",
    dir: "",
    body: {},
    head: {},
    images: { length: 0x0 },
    embeds: { length: 0x0 },
    plugins: { length: 0x0 },
    links: { length: 0x0 },
    forms: { length: 0x0 },
    currentScript: {
      src: c || "https://sentinel.openai.com/backend-api/sentinel/sdk.js",
    },
    defaultView: null,
    designMode: "off",
    anchors: { length: 0x0 },
    fgColor: "",
    bgColor: "",
    alinkColor: "",
    linkColor: "",
    vlinkColor: "",
    all: { length: 0xa },
    scrollingElement: {},
    hidden: ![],
    visibilityState: "visible",
    timeline: {},
    fullscreenEnabled: !![],
    rootElement: null,
    children: { length: 0x1 },
    firstElementChild: {},
    lastElementChild: {},
    childElementCount: 0x1,
    activeElement: {},
    styleSheets: { length: 0x3 },
    pointerLockElement: null,
    fullscreenElement: null,
    adoptedStyleSheets: [],
    fonts: {},
    fragmentDirective: {},
    pictureinpictureenabled: undefined,
    implementation: {},
    lastModified: new Date()["toLocaleString"](),
    createElement: (m) => ({ tagName: m, style: {} }),
  };
  const j = {
    href: "https://chatgpt.com/",
    search: "",
    origin: "https://chatgpt.com",
    protocol: "https:",
    host: "chatgpt.com",
    hostname: "chatgpt.com",
    pathname: "/",
    hash: "",
  };
  const k = {
    navigator: f,
    screen: g,
    performance: h,
    document: i,
    location: j,
    Math: Math,
    JSON: JSON,
    String: String,
    Number: Number,
    Array: Array,
    Object: Object,
    Promise: Promise,
    Map: Map,
    Set: Set,
    Date: Date,
    Error: Error,
    RegExp: RegExp,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    isFinite: isFinite,
    undefined: undefined,
    NaN: NaN,
    Infinity: Infinity,
    btoa: btoa,
    atob: atob,
    crypto: {
      getRandomValues: (m) => {
        for (let n = 0x0; n < m["length"]; n++)
          m[n] = Math["floor"](Math["random"]() * 0x100);
        return m;
      },
      randomUUID: () => {
        const m = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
        return m["replace"](/[xy]/g, (n) => {
          const o = (Math["random"]() * 0x10) | 0x0;
          return (n === "x" ? o : (o & 0x3) | 0x8)["toString"](0x10);
        });
      },
    },
    TextEncoder: class {
      ["encode"](m) {
        return Buffer["from"](m, "utf8");
      }
    },
    TextDecoder: class {
      ["decode"](m) {
        return Buffer["from"](m)["toString"]("utf8");
      }
    },
    Uint8Array: Uint8Array,
    ArrayBuffer: ArrayBuffer,
    setTimeout: (m, n) => {
      if (typeof m === "function") {
        try {
          m({ timeRemaining: () => 0x1, didTimeout: ![] });
        } catch {}
      }
      return 0x0;
    },
    requestIdleCallback: (m) => {
      try {
        m({ timeRemaining: () => 0x1, didTimeout: ![] });
      } catch {}
      return 0x0;
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Reflect: typeof Reflect !== "undefined" ? Reflect : {},
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      length: 0x0,
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      length: 0x0,
    },
    history: {
      length: 0x1,
      pushState: () => {},
      replaceState: () => {},
      go: () => {},
      back: () => {},
      forward: () => {},
    },
  };
  const l = [
    "onabort",
    "onafterprint",
    "onanimationend",
    "onanimationiteration",
    "onanimationstart",
    "onauxclick",
    "onbeforeinput",
    "onbeforeprint",
    "onbeforetoggle",
    "onbeforeunload",
    "onblur",
    "oncancel",
    "oncanplay",
    "oncanplaythrough",
    "onchange",
    "onclick",
    "onclose",
    "oncontextmenu",
    "ondblclick",
    "ondevicemotion",
    "ondeviceorientation",
    "ondrag",
    "ondragend",
    "ondragenter",
    "ondragleave",
    "ondragover",
    "ondragstart",
    "ondrop",
    "onemptied",
    "onended",
    "onerror",
    "onfocus",
    "onformdata",
    "ongotpointercapture",
    "onhashchange",
    "oninput",
    "oninvalid",
    "onkeydown",
    "onkeypress",
    "onkeyup",
    "onlanguagechange",
    "onload",
    "onloadeddata",
    "onloadedmetadata",
    "onloadstart",
    "onlostpointercapture",
    "onmessage",
    "onmessageerror",
    "onmousedown",
    "onmouseenter",
    "onmouseleave",
    "onmousemove",
    "onmouseout",
    "onmouseover",
    "onmouseup",
    "onoffline",
    "ononline",
    "onpagehide",
    "onpageshow",
    "onpaste",
    "onpause",
    "onplay",
    "onplaying",
    "onpointercancel",
    "onpointerdown",
    "onpointerenter",
    "onpointerleave",
    "onpointermove",
    "onpointerout",
    "onpointerover",
    "onpointerup",
    "onpopstate",
    "onprogress",
    "onratechange",
    "onrejectionhandled",
    "onreset",
    "onresize",
    "onscroll",
    "onscrollend",
    "onsearch",
    "onseeked",
    "onseeking",
    "onselect",
    "onselectstart",
    "onslotchange",
    "onstalled",
    "onstorage",
    "onsubmit",
    "onsuspend",
    "ontimeupdate",
    "ontoggle",
    "ontransitioncancel",
    "ontransitionend",
    "ontransitionrun",
    "ontransitionstart",
    "onunhandledrejection",
    "onunload",
    "onvolumechange",
    "onwaiting",
    "onwebkitanimationend",
    "onwebkitanimationstart",
    "onwebkittransitionend",
    "onwheel",
    "onbeforematch",
    "oncontentvisibilityautostatechange",
    "oncontextlost",
    "oncontextrestored",
    "oncuechange",
    "ondurationchange",
    "onendsnapshot",
  ];
  for (const m of l) k[m] = null;
  i["defaultView"] = k;
  return k;
}
const OP_RECURSE = 0x0;
const OP_XOR = 0x1;
const OP_SET = 0x2;
const OP_SUCCESS = 0x3;
const OP_ERROR = 0x4;
const OP_PUSH = 0x5;
const OP_GET_PROP = 0x6;
const OP_CALL = 0x7;
const OP_COPY = 0x8;
const REG_PC = 0x9;
const REG_WINDOW = 0xa;
const OP_SCRIPT_SRC = 0xb;
const OP_SELF_REF = 0xc;
const OP_TRY_VOID = 0xd;
const OP_JSON_PARSE = 0xe;
const OP_JSON_STR = 0xf;
const REG_KEY = 0x10;
const OP_TRY_CALL = 0x11;
const OP_ATOB = 0x12;
const OP_BTOA = 0x13;
const OP_IF_EQ = 0x14;
const OP_IF_DIFF_GT = 0x15;
const OP_RUN_SUB = 0x16;
const OP_IF_DEF = 0x17;
const OP_BIND = 0x18;
const OP_NOOP_25 = 0x19;
const OP_NOOP_26 = 0x1a;
const OP_REMOVE = 0x1b;
const OP_NOOP_28 = 0x1c;
const OP_COMPARE_LT = 0x1d;
const OP_DEFINE_FN = 0x1e;
const OP_MULTIPLY = 0x21;
const OP_AWAIT = 0x22;
const OP_DIVIDE = 0x23;
async function solveTurnstileDx(a, b, c, d, f) {
  if (!a || !b) return null;
  let g;
  try {
    g = Buffer["from"](a, "base64")["toString"]("binary");
  } catch {
    logger["debug"]("VM:\x20failed\x20to\x20base64-decode\x20turnstile.dx");
    return null;
  }
  const h = xorDecrypt(g, b);
  let i;
  try {
    i = JSON["parse"](h);
  } catch (s) {
    logger["info"](
      "VM:\x20XOR\x20decrypt\x20failed\x20—\x20JSON.parse\x20error:\x20" +
        s["message"] +
        "\x20(decrypted\x20first\x2050\x20chars:\x20" +
        h["substring"](0x0, 0x32) +
        ")",
    );
    return null;
  }
  if (!Array["isArray"](i)) {
    logger["info"](
      "VM:\x20instructions\x20is\x20not\x20an\x20array\x20(type:\x20" +
        typeof i +
        ")",
    );
    return null;
  }
  logger["info"]("VM:\x20" + i["length"] + "\x20instructions");
  const j = createMockWindow(c, d, f);
  const k = new Map();
  let l = 0x0;
  let m = null;
  let n = ![];
  function o(t, u) {
    if (t == null) return undefined;
    try {
      return t[u];
    } catch {
      return undefined;
    }
  }
  function p(t, u) {
    if (typeof t !== "function") return undefined;
    try {
      return t(...u);
    } catch {
      return undefined;
    }
  }
  k["set"](OP_RECURSE, (t) => {
    return Promise["resolve"]("" + l);
  });
  k["set"](OP_XOR, (t, u) => {
    const v = "" + k["get"](t);
    const w = "" + k["get"](u);
    k["set"](t, xorDecrypt(v, w));
  });
  k["set"](OP_SET, (t, u) => {
    k["set"](t, u);
  });
  k["set"](OP_SUCCESS, (t) => {
    if (!n) {
      n = !![];
      m = btoa("" + t);
    }
  });
  k["set"](OP_ERROR, (t) => {
    if (!n) {
      n = !![];
      m = btoa("" + t);
    }
  });
  k["set"](OP_PUSH, (t, u) => {
    const v = k["get"](t);
    const w = k["get"](u);
    if (Array["isArray"](v)) {
      v["push"](w);
    } else {
      k["set"](t, v + w);
    }
  });
  k["set"](OP_GET_PROP, (t, u, v) => {
    const w = k["get"](u);
    const x = k["get"](v);
    k["set"](t, o(w, x));
  });
  k["set"](OP_CALL, (t, ...u) => {
    const v = k["get"](t);
    const w = u["map"]((x) => k["get"](x));
    return p(v, w);
  });
  k["set"](OP_COPY, (t, u) => {
    k["set"](t, k["get"](u));
  });
  k["set"](REG_WINDOW, j);
  k["set"](OP_SCRIPT_SRC, (t, u) => {
    const v = k["get"](u);
    const w = j["document"]["scripts"] || [];
    let x = null;
    for (const y of w) {
      if (y?.["src"]) {
        try {
          const z = y["src"]["match"](v);
          if (z && z["length"] > 0x0) {
            x = z[0x0];
            break;
          }
        } catch {}
      }
    }
    k["set"](t, x);
  });
  k["set"](OP_SELF_REF, (t) => {
    k["set"](t, k);
  });
  k["set"](OP_TRY_VOID, (t, u, ...v) => {
    try {
      const w = k["get"](u);
      const x = v["map"]((y) => k["get"](y));
      if (typeof w === "function") w(...x);
    } catch (y) {
      k["set"](t, "" + y);
    }
  });
  k["set"](OP_JSON_PARSE, (t, u) => {
    try {
      k["set"](t, JSON["parse"]("" + k["get"](u)));
    } catch {
      k["set"](t, undefined);
    }
  });
  k["set"](OP_JSON_STR, (t, u) => {
    try {
      k["set"](t, JSON["stringify"](k["get"](u)));
    } catch {
      k["set"](t, undefined);
    }
  });
  k["set"](REG_KEY, b);
  k["set"](OP_TRY_CALL, (t, u, ...v) => {
    try {
      const w = k["get"](u);
      const x = v["map"]((z) => k["get"](z));
      if (typeof w !== "function") {
        k["set"](t, undefined);
        return;
      }
      const y = w(...x);
      if (y && typeof y["then"] === "function") {
        return y["then"]((z) => k["set"](t, z))["catch"]((z) =>
          k["set"](t, "" + z),
        );
      }
      k["set"](t, y);
    } catch (z) {
      k["set"](t, "" + z);
    }
  });
  k["set"](OP_ATOB, (t) => {
    try {
      k["set"](t, atob("" + k["get"](t)));
    } catch {
      k["set"](t, "");
    }
  });
  k["set"](OP_BTOA, (t) => {
    try {
      k["set"](t, btoa("" + k["get"](t)));
    } catch {
      k["set"](t, "");
    }
  });
  k["set"](OP_IF_EQ, (t, u, v, ...w) => {
    if (k["get"](t) === k["get"](u)) {
      const x = k["get"](v);
      if (typeof x === "function") return x(...w);
    }
    return null;
  });
  k["set"](OP_IF_DIFF_GT, (t, u, v, w, ...x) => {
    if (Math["abs"](k["get"](t) - k["get"](u)) > k["get"](v)) {
      const y = k["get"](w);
      if (typeof y === "function") return y(...x);
    }
    return null;
  });
  k["set"](OP_RUN_SUB, (t, u) => {
    if (!Array["isArray"](u)) return;
    const v = k["get"](REG_PC) || [];
    k["set"](REG_PC, [...u, ...v]);
  });
  k["set"](OP_IF_DEF, (t, u, ...v) => {
    if (k["get"](t) !== undefined) {
      const w = k["get"](u);
      if (typeof w === "function") return w(...v);
    }
    return null;
  });
  k["set"](OP_BIND, (t, u, v) => {
    const w = k["get"](u);
    const x = k["get"](v);
    try {
      const y = w[x];
      k["set"](t, typeof y === "function" ? y["bind"](w) : y);
    } catch {
      k["set"](t, undefined);
    }
  });
  k["set"](OP_NOOP_25, () => {});
  k["set"](OP_NOOP_26, () => {});
  k["set"](OP_NOOP_28, () => {});
  k["set"](OP_REMOVE, (t, u) => {
    const v = k["get"](t);
    const w = k["get"](u);
    if (Array["isArray"](v)) {
      const x = v["indexOf"](w);
      if (x !== -0x1) v["splice"](x, 0x1);
    } else {
      k["set"](t, v - w);
    }
  });
  k["set"](OP_COMPARE_LT, (t, u, v) => {
    k["set"](t, k["get"](u) < k["get"](v));
  });
  k["set"](OP_DEFINE_FN, (t, u, v, w) => {
    let x, y;
    if (Array["isArray"](v) && Array["isArray"](w)) {
      x = v;
      y = w;
    } else if (Array["isArray"](v)) {
      x = [];
      y = v;
    } else {
      x = [];
      y = [];
    }
    k["set"](t, (...z) => {
      if (n) return;
      for (let B = 0x0; B < x["length"]; B++) {
        k["set"](x[B], z[B]);
      }
      const A = k["get"](REG_PC) || [];
      k["set"](REG_PC, [...y, ...A]);
    });
  });
  k["set"](OP_MULTIPLY, (t, u, v) => {
    k["set"](t, Number(k["get"](u)) * Number(k["get"](v)));
  });
  k["set"](OP_AWAIT, (t, u) => {
    try {
      const v = k["get"](u);
      return Promise["resolve"](v)["then"]((w) => k["set"](t, w));
    } catch {
      return undefined;
    }
  });
  k["set"](OP_DIVIDE, (t, u, v) => {
    const w = Number(k["get"](v));
    k["set"](t, w === 0x0 ? 0x0 : Number(k["get"](u)) / w);
  });
  async function q() {
    const t = 0x7a120;
    let u = 0x0;
    while (!n && u < t) {
      const v = k["get"](REG_PC);
      if (!v || v["length"] === 0x0) {
        let z = ![];
        for (const [A, B] of k) {
          if (
            Array["isArray"](B) &&
            B["length"] > 0x0 &&
            Array["isArray"](B[0x0]) &&
            A !== REG_PC
          ) {
            k["set"](REG_PC, B);
            k["delete"](A);
            z = !![];
            break;
          }
        }
        if (!z) break;
        continue;
      }
      const [w, ...x] = v["shift"]();
      const y = k["get"](w);
      if (typeof y === "function") {
        try {
          const C = y(...x);
          if (C && typeof C["then"] === "function") await C;
        } catch (D) {
          logger["debug"](
            "VM\x20opcode\x20" + w + "\x20error:\x20" + D["message"],
          );
        }
      }
      l++;
      u++;
    }
  }
  k["set"](REG_PC, i);
  const r = 0x7d0;
  try {
    await Promise["race"]([
      q(),
      new Promise((t) =>
        setTimeout(() => {
          if (!n) {
            n = !![];
            m = "" + l;
          }
          t();
        }, r),
      ),
    ]);
  } catch (t) {
    if (!n) {
      n = !![];
      m = btoa(l + ":\x20" + t["message"]);
    }
  }
  if (!m && !n) {
    m = btoa(l + ":\x20completed");
  }
  logger["info"]("VM\x20✓\x20(" + (m ? m["length"] + "ch" : "null") + ")");
  return m;
}
module["exports"] = {
  solveTurnstileDx: solveTurnstileDx,
  createMockWindow: createMockWindow,
  xorDecrypt: xorDecrypt,
};
