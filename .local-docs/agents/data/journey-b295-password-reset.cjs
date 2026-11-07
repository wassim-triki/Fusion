// B-295: password reset by an emailed one-time link, through shell :3000 and Mailpit, as Leila Baccouche (employee).
// The new password is the local password again, so her sign-in doesn't change; her open sessions do end.
// Then one screen (dark, 1440×900) of the reset form from a fresh link, left unused (it lapses in 30 minutes),
// into plans/B-295-screens/. Needs: stack.ps1 -Apps core. Run: node journey-b295-password-reset.cjs
const path = require("path");
const fs = require("fs");
const { BASE, MAILPIT, PASSWORD, call } = require("../../../.agents/skills/fusion-dev/scripts/api.cjs");

const EMAIL = "leila.baccouche@example.test";
let passed = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "pass" : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};

async function mails(subject) {
  const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${EMAIL} subject:"${subject}"`)}`)).json();
  return list.messages ?? [];
}

/** Waits for a new reset mail and answers its token and company. */
async function newLink(before) {
  for (let i = 0; i < 20; i++) {
    const found = await mails("Choose a new password");
    if (found.length > before) {
      const full = await (await fetch(`${MAILPIT}/api/v1/message/${found[0].ID}`)).json();
      const m = full.Text.match(/\/auth\/reset-password\?token=([A-Za-z0-9_-]+)(?:&company=([a-z0-9-]+))?/);
      return { token: m[1], company: m[2] ?? null };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("no reset mail");
}

(async () => {
  if (!PASSWORD) throw new Error("Set FUSION_LOCAL_PASSWORD.");
  const session = (await call("POST", "/api/identity/auth/login", { email: EMAIL, password: PASSWORD })).json.data;

  const before = (await mails("Choose a new password")).length;
  const unknown = await call("POST", "/api/identity/auth/password-reset", { email: `nobody.${Date.now()}@example.test` });
  const asked = await call("POST", "/api/identity/auth/password-reset", { email: EMAIL });
  check("unknown and real addresses get the same 202", unknown.status === 202 && asked.status === 202, `${unknown.status}/${asked.status}`);

  const link = await newLink(before);
  check("the mail links to the reset page with Carthage's brand", Boolean(link.token && link.company), JSON.stringify(link));

  const again = await call("POST", "/api/identity/auth/password-reset", { email: EMAIL });
  await new Promise((r) => setTimeout(r, 2000));
  check("asking again within a minute sends nothing", again.status === 202 && (await mails("Choose a new password")).length === before + 1);

  const inspect = await call("POST", "/api/identity/auth/password-reset/inspect", { token: link.token });
  check("the link opens for Leila", inspect.json?.data?.state === "ready" && inspect.json.data.email === EMAIL, JSON.stringify(inspect.json));

  const weak = await call("POST", "/api/identity/auth/password-reset/complete", { token: link.token, newPassword: "short" });
  check("a weak password is refused", weak.status === 400 && weak.json?.details?.code === "invalid-password", `${weak.status}`);

  const done = await call("POST", "/api/identity/auth/password-reset/complete", { token: link.token, newPassword: PASSWORD });
  check("the link sets the password", done.status === 200, `${done.status} ${JSON.stringify(done.json)}`);

  const refresh = await call("POST", "/api/identity/auth/refresh", { refreshToken: session.refreshToken });
  check("her earlier session ended", refresh.status === 401, `${refresh.status}`);

  const reused = await call("POST", "/api/identity/auth/password-reset/complete", { token: link.token, newPassword: PASSWORD });
  check("the link works only once", reused.status === 409 && reused.json?.details?.code === "used", `${reused.status}`);

  const signIn = await call("POST", "/api/identity/auth/login", { email: EMAIL, password: PASSWORD });
  check("she signs in with the password", signIn.status === 200, `${signIn.status}`);
  check("a 'password changed' mail went out", (await mails("Your password was changed")).length > 0);

  // One screen: the reset form, from a fresh link.
  const { chromium } = require("../../../Frontend/node_modules/playwright");
  const count = (await mails("Choose a new password")).length;
  await call("POST", "/api/identity/auth/password-reset", { email: EMAIL });
  const fresh = await newLink(count);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })).newPage();
  await page.goto(`${BASE}/auth/reset-password?token=${fresh.token}&company=${fresh.company}`, { waitUntil: "networkidle", timeout: 180000 });
  await page.locator("#new-password").waitFor({ timeout: 60000 });
  check("the page takes the token out of the address", !page.url().includes("token="), page.url());
  await page.locator("#new-password").fill("Carthage-2026");
  await page.locator("#confirm-password").fill("Carthage-2026");
  await page.waitForTimeout(800);
  const dir = path.join(__dirname, "..", "plans", "B-295-screens");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, "reset-password.png") });
  await browser.close();

  console.log(`\n${passed}/${failed}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
