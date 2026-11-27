// Browser + login handling.
//
// How signing in works on this site:
//   1. The student signs in to BinusMaya (Microsoft SSO, password + MFA).
//   2. BinusMaya opens the certification app in a new tab with a one-time ?Token=...
//   3. The certification app turns that token into a session cookie.
// We can't create the token ourselves, so the first sign-in (and any re-entry after the
// certification session expires) happens in a visible browser window that the student
// drives. Everything after that runs on the saved cookies.
//
// What gets saved, all under --auth-dir (git-ignored):
//   browser-profile-<browser>/  a persistent browser profile, so BinusMaya / Microsoft
//                               usually remember you and re-entry is one click
//   session.json                cookies including the certification session cookie, which
//                               a browser profile alone would drop on close
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PATHS, isAuthedUrl, asNetworkError, LoginAbortedError } from './site.mjs';
import { redactUrl } from './text.mjs';
import { trackNetworkFailures } from './archive.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BLOCKED_TYPES = new Set(['image', 'media', 'font']);

export class Session {
  constructor(opts) {
    this.origin = new URL(opts.origin).origin;
    this.loginUrl = opts.loginUrl;
    this.authDir = path.resolve(opts.authDir);
    this.statePath = path.join(this.authDir, 'session.json');
    this.browser = opts.browser ?? 'chrome';
    this.headed = Boolean(opts.headed);
    this.loginHeadless = Boolean(opts.loginHeadless); // tests only: the mock login needs no human
    this.loginTimeoutMs = opts.loginTimeoutMs ?? 10 * 60_000;
    this.log = opts.log ?? ((m) => console.log(m));
    this.context = null;
    this.page = null;
    this.visible = false;
    this.signingIn = false;
    this.logins = 0;
  }

  profileDir() {
    // One profile per browser: Chrome and Playwright's Chromium are different versions and
    // a profile written by a newer browser can refuse to open in an older one.
    return path.join(this.authDir, `browser-profile-${this.browser}`);
  }

  async open({ visible = this.headed } = {}) {
    await this.close();
    fs.mkdirSync(this.authDir, { recursive: true });
    this.context = await this.launch(visible);
    this.visible = visible;
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    trackNetworkFailures(this.page);
    await this.page.route('**/*', (route) => {
      const req = route.request();
      // Skip thumbnails and fonts while scraping. They are most of the bytes and the
      // thumbnail links are signed URLs that expire within the hour anyway.
      if (!this.signingIn && BLOCKED_TYPES.has(req.resourceType())) return route.abort();
      return route.continue();
    });
    return this.page;
  }

  async launch(visible) {
    const base = {
      headless: !visible,
      viewport: visible ? null : { width: 1280, height: 900 },
      args: visible ? ['--start-maximized'] : [],
    };
    const tryLaunch = () => chromium.launchPersistentContext(this.profileDir(), {
      ...base,
      ...(this.browser === 'chromium' ? {} : { channel: this.browser }),
    });
    let context;
    try {
      fs.mkdirSync(this.profileDir(), { recursive: true });
      context = await tryLaunch();
    } catch (err) {
      const msg = String(err.message);
      if (/already in use|ProcessSingleton|SingletonLock|lock file/i.test(msg)) {
        throw new Error(`The browser profile in ${this.profileDir()} is already open. Close the other scraper run or its browser window, then try again.`);
      }
      if (this.browser !== 'chromium' && /executable|not found|distribution|install/i.test(msg)) {
        this.log(`! ${this.browser} was not found, falling back to Playwright's Chromium.`);
        this.browser = 'chromium';
        fs.mkdirSync(this.profileDir(), { recursive: true });
        context = await tryLaunch();
      } else {
        throw err;
      }
    }
    await this.restoreCookies(context);
    const dismissDialogs = (p) => p.on('dialog', (d) => d.dismiss().catch(() => {}));
    context.pages().forEach(dismissDialogs);
    context.on('page', dismissDialogs);
    return context;
  }

  async restoreCookies(context) {
    if (!fs.existsSync(this.statePath)) return;
    try {
      const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
      const now = Date.now() / 1000;
      const cookies = (state.cookies ?? []).filter((c) => !(c.expires > 0 && c.expires < now));
      if (cookies.length) await context.addCookies(cookies);
    } catch (err) {
      this.log(`! Could not read the saved session (${err.message}). You may need to sign in again.`);
    }
  }

  async saveState() {
    if (!this.context) return;
    try {
      await this.context.storageState({ path: this.statePath });
    } catch {
      // The context may be closing; the next checkpoint will save again.
    }
  }

  /**
   * Reports whether we are signed in: the dashboard answers 200 when the session is alive and
   * redirects to /UnAuthorize when it is gone. This is a plain HTTP request with the browser's
   * cookies, not a page load, on purpose: a rendered dashboard immediately fires its list
   * postback, which can take ~30 s and holds the server's session lock, stalling the next page.
   */
  async checkSignedIn() {
    if (!this.context) await this.open();
    let res;
    try {
      res = await this.context.request.get(this.origin + PATHS.dashboard, { timeout: 60_000, failOnStatusCode: false });
    } catch (err) {
      const net = asNetworkError(err, 'session check');
      if (net) throw net;
      throw err;
    }
    return res.ok() && isAuthedUrl(res.url(), this.origin);
  }

  async ensureSignedIn() {
    if (await this.checkSignedIn()) {
      await this.saveState();
      return 'reused';
    }
    await this.login('no saved session, or it has expired');
    return 'signed-in';
  }

  /** Called when a scrape step finds itself signed out. */
  async recover() {
    if (await this.checkSignedIn()) return 'still-signed-in';
    await this.login('the certification session expired');
    return 'signed-in';
  }

  async login(reason) {
    const needsWindow = !this.visible && !this.loginHeadless;
    if (needsWindow) await this.open({ visible: true });
    this.signingIn = true;
    try {
      const ctx = this.context;
      this.log('');
      this.log(`\x07>>> Sign-in needed (${reason}).`);
      if (!this.loginHeadless) {
        this.log('    In the browser window that just opened:');
        this.log('      1. Sign in to BinusMaya if it asks (Microsoft account, password, MFA).');
        this.log('      2. Open the Certification app from BinusMaya, the same way you normally do.');
        this.log(`    The scraper continues by itself once the certification dashboard loads. Waiting up to ${Math.round(this.loginTimeoutMs / 60000)} minutes.`);
      }
      await this.page.goto(this.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      const hit = await this.waitForAuthedPage(ctx);
      this.log(`    Certification app opened (${redactUrl(hit.url())}).`);
      // Let the token -> cookie handoff finish before we navigate anywhere.
      await hit.waitForLoadState('load', { timeout: 30_000 }).catch(() => {});

      if (!(await this.checkSignedIn())) {
        throw new LoginAbortedError('BinusMaya opened the certification app, but it still answers "UnAuthorize". Try opening it again from BinusMaya.');
      }
      for (const p of ctx.pages()) if (p !== this.page) await p.close().catch(() => {});
      await this.saveState();
      this.logins += 1;
    } finally {
      this.signingIn = false;
    }

    if (needsWindow) {
      // Go back to a hidden browser for the long scrape. The saved cookies carry the session over.
      await this.open({ visible: false });
      if (!(await this.checkSignedIn())) {
        throw new LoginAbortedError('Signed in, but the session did not carry over to the background browser. Run again with --headed.');
      }
    }
    this.log(`>>> Signed in. Session saved to ${path.relative(process.cwd(), this.statePath) || this.statePath}.`);
    this.log('');
  }

  async waitForAuthedPage(ctx) {
    const deadline = Date.now() + this.loginTimeoutMs;
    let closed = false;
    ctx.once('close', () => { closed = true; });
    let nextReminder = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (closed) throw new LoginAbortedError('The browser was closed before sign-in finished.');
      const pages = ctx.pages();
      if (pages.length === 0) throw new LoginAbortedError('All browser tabs were closed before sign-in finished.');
      const hit = pages.find((p) => isAuthedUrl(p.url(), this.origin));
      if (hit) return hit;
      if (Date.now() > nextReminder) {
        const left = Math.max(0, Math.round((deadline - Date.now()) / 60000));
        this.log(`    ...still waiting for the certification dashboard (${left} min left).`);
        nextReminder = Date.now() + 60_000;
      }
      await sleep(500);
    }
    throw new LoginAbortedError(`Gave up waiting for sign-in after ${Math.round(this.loginTimeoutMs / 60000)} minutes.`);
  }

  async close() {
    if (!this.context) return;
    const ctx = this.context;
    this.context = null;
    this.page = null;
    await ctx.close().catch(() => {});
  }
}
