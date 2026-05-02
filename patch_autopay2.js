const fs = require('fs');
let code = fs.readFileSync('C:\\\\Users\\\\Administrator\\\\Documents\\\\bot\\\\newgptbot\\\\src\\\\autopay.js', 'utf8');
code = code.replace(/\r\n/g, '\n');

// 1. Add sgProxyUrl logic
code = code.replace(
  '    }\n    \n    this.proxyUrl = this.generalProxyUrl;\n    this.loginProxyUrl =',
  \    }
    
    let sgProxyRaw = process.env.SGP_PROXY_URL || null;
    if (sgProxyRaw && sgProxyRaw.includes('gw.dataimpulse.com')) {
      sgProxyRaw = sgProxyRaw.replace(/:\\/\\/([^/:]+):([^/@]+)@/, '\\\\://-\s:@');
    } else if (sgProxyRaw && sgProxyRaw.includes('swiftproxy.net')) {
      if (!sgProxyRaw.includes('_session_')) {
        sgProxyRaw = sgProxyRaw.replace(/(https?:\\/\\/)([^:]+):([^@]+)@(.+)/, (m, p1, user, pass, host) => {
            return \\\\\_session_\:\@\System.Management.Automation.Internal.Host.InternalHost\\\;
        });
      }
    }
    this.sgProxyUrl = sgProxyRaw;
    
    this.proxyUrl = this.generalProxyUrl;
    this.loginProxyUrl =\
);

// 2. Create SG Clients
code = code.replace(
  '    const { client: d, jar: e } = createClient(null);\n    this.stripeClient = d;\n    this.stripeJar = e;\n    const { client: f, jar: g } = createClient(null);\n    this.midtransClient = f;\n    this.midtransJar = g;',
  \    const { client: d, jar: e } = createClient(this.generalProxyUrl);
    this.stripeClient = d;
    this.stripeJar = e;
    const { client: dSg, jar: eSg } = createClient(this.sgProxyUrl);
    this.stripeClientSg = dSg;
    this.stripeJarSg = eSg;
    const { client: f, jar: g } = createClient(this.sgProxyUrl);
    this.midtransClient = f;
    this.midtransJar = g;\
);

// 3. Add _rotateSgProxy and _withSgProxyRetry
code = code.replace(
  '    return { status: d.status, data: d.data, headers: d.headers };\n  }\n  async cleanup() {',
  \    return { status: d.status, data: d.data, headers: d.headers };
  }

  _rotateSgProxy() {
    const newSessionToken = require('uuid').v4().replace(/-/g, "").substring(0, 8);
    const rawProxy = process.env.GENERAL_PROXY_URL || null;
    let sgProxyRaw = process.env.SGP_PROXY_URL || null;
    if (!sgProxyRaw && rawProxy && rawProxy.includes('gw.dataimpulse.com')) {
      sgProxyRaw = rawProxy.replace(/(https?:\\/\\/)([^_:]+)(?:__[^:]*)?:([^@]+)@(.+)/, (m, p1, userBase, pass, host) => {
        return \\\\\__cr.sg__session-\:\@\System.Management.Automation.Internal.Host.InternalHost\\\;
      });
    } else if (sgProxyRaw && sgProxyRaw.includes('swiftproxy.net')) {
      if (sgProxyRaw.includes('_session_')) {
        sgProxyRaw = sgProxyRaw.replace(/_session_[^:]+:/, \\\_session_\:\\\);
      } else {
        sgProxyRaw = sgProxyRaw.replace(/(https?:\\/\\/)([^:]+):([^@]+)@(.+)/, (m, p1, user, pass, host) => {
          return \\\\\_session_\:\@\System.Management.Automation.Internal.Host.InternalHost\\\;
        });
      }
    }
    if (sgProxyRaw) this.sgProxyUrl = sgProxyRaw;
    
    const { createClient } = require('./utils/httpClient');
    const { client: dSg, jar: eSg } = createClient(this.sgProxyUrl);
    this.stripeClientSg = dSg;
    this.stripeJarSg = eSg;

    const { client: f, jar: g } = createClient(this.sgProxyUrl);
    this.midtransClient = f;
    this.midtransJar = g;
    logger.debug(this.tag + "SG Proxy rotated: " + newSessionToken);
  }

  async _withSgProxyRetry(operationName, fn) {
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      try {
        return await fn();
      } catch (err) {
        const is502 = (err.response && err.response.status === 502) || (err.message && err.message.includes('502'));
        const isConnRefused = err.code === 'ECONNREFUSED' || (err.message && err.message.includes('ECONNREFUSED'));
        if (is502 || isConnRefused) {
          logger.warn(this.tag + \\\[\] Proxy error (\). Retrying (Attempt \/3)...\\\);
          if (attempt < 3) {
            this._rotateSgProxy();
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
        }
        throw err;
      }
    }
  }

  async cleanup() {\
);

// Replace this.client to this.stripeClientSg in specific functions
const patchFn = (name) => {
  const start = code.indexOf(\sync \(\);
  let end = code.indexOf(\}\\n  async \, start);
  if (end === -1) end = code.indexOf(\}\\n\\n\, start); // Handle different end cases
  if (end === -1) end = code.indexOf(\}\\n}\, start);
  if (start > -1 && end > -1) {
    let sub = code.substring(start, end);
    sub = sub.replace(/this\\.client\\.post/g, 'this.stripeClientSg.post');
    sub = sub.replace(/this\\.client\\.get/g, 'this.stripeClientSg.get');
    code = code.substring(0, start) + sub + code.substring(end);
  }
};
patchFn('createPaymentMethod');
patchFn('confirmCheckout');
patchFn('followStripeRedirect');
patchFn('getMidtransTransaction');

// 7. Update runAutopay sequence
code = code.replace(
  '      const [, b] = await Promise.all([\n        this.initStripeCheckout(),\n        this.initStripeSession(),\n        this.createPaymentMethod(a),\n      ]);\n      logger.info(this.tag + "Konfirmasi pembayaran...");\n      const c = await this.confirmCheckout(b);\n      this._pastStripe = !![];\n      logger.info(this.tag + "Arah midtrans...");\n      const d = await this.followStripeRedirect(c);',
  \      const [, b] = await Promise.all([
        this.initStripeCheckout(),
        this.initStripeSession(),
        this._withSgProxyRetry("createPaymentMethod", async () => await this.createPaymentMethod(a)),
      ]);
      logger.info(this.tag + "Konfirmasi pembayaran...");
      const c = await this._withSgProxyRetry("confirmCheckout", async () => await this.confirmCheckout(b));
      this._pastStripe = !![];
      logger.info(this.tag + "Arah midtrans...");
      const d = await this._withSgProxyRetry("followStripeRedirect", async () => await this.followStripeRedirect(c));\
);

fs.writeFileSync('C:\\\\Users\\\\Administrator\\\\Documents\\\\bot\\\\newgptbot\\\\src\\\\autopay.js', code);
console.log('Patched autopay.js successfully');
