// Live Settings-only verification/capture through :3000; restores the starting work week.
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Code/EY/Fusion/Frontend/node_modules/playwright');
const { BASE, PASSWORD, call } = require(path.join(__dirname, '../../../.agents/skills/fusion-dev/scripts/api.cjs'));
const out = path.join(__dirname, '../plans/B-278-screens');
const settingsPath = '/api/corehr/settings/organization';
const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
let passed = 0;
const check = (label, result) => { if (!result) throw new Error(label); passed++; console.log(`PASS ${label}`); };
(async () => {
  const signedIn = await call('POST', '/api/identity/auth/login', { email: 'amira.khelifi@example.test', password: PASSWORD });
  if (signedIn.status !== 200) throw new Error(`Login: ${signedIn.status}`);
  const d = signedIn.json.data;
  const originalResponse = await call('GET', settingsPath, undefined, d.accessToken);
  if (originalResponse.status !== 200) throw new Error(`Settings: ${originalResponse.status}`);
  const original = originalResponse.json.data.workingDays;
  const auth = { accessToken: d.accessToken, refreshToken: d.refreshToken, accessTokenExpiration: d.accessTokenExpiration,
    user: { userId: d.userId, tenantId: d.tenantId ?? null, tenantMembershipId: d.tenantMembershipId ?? null,
      moduleEntitlements: d.moduleEntitlements ?? [], email: d.email, fullName: d.fullName, roles: d.roles,
      employeeId: d.employeeId ?? null, accessProfiles: d.accessProfiles ?? [], effectivePermissions: d.effectivePermissions ?? [],
      language: d.language, notificationPopups: d.notificationPopups, notificationSound: d.notificationSound } };
  const browser = await chromium.launch();
  let persisted = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await context.addCookies([{ name: 'ey_hr_authenticated', value: 'true', url: BASE }, { name: 'NEXT_LOCALE', value: 'en', url: BASE }]);
    await context.addInitScript(({ auth }) => { localStorage.setItem('theme', 'dark'); localStorage.setItem('ey_hr_auth', JSON.stringify(auth)); }, { auth });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let patches = 0;
    page.on('request', request => { if (request.method() === 'PATCH' && request.url().endsWith(settingsPath)) patches++; });
    const open = async () => {
      await page.goto(`${BASE}/core/settings/details`, { waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.getByRole('button', { name: 'Monday', exact: true }).waitFor({ timeout: 180000 });
    };
    const selected = async () => {
      const days = [];
      for (let index = 0; index < names.length; index++) if (await page.getByRole('button', { name: names[index], exact: true }).getAttribute('aria-pressed') === 'true') days.push(index + 1);
      return days;
    };
    const save = async () => {
      const response = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith(settingsPath), { timeout: 60000 });
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      const result = await response;
      if (result.status() !== 200) throw new Error(`Save: ${result.status()}`);
      await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor({ state: 'hidden', timeout: 30000 });
      await page.locator('[role="combobox"][aria-label="Common work weeks"]:enabled').waitFor({ timeout: 30000 });
    };
    await open();
    if (!process.argv.includes('--capture-only')) {
    check('Loaded authoritative working days', (await selected()).join() === original.join());
    const saturday = page.getByRole('button', { name: 'Saturday', exact: true });
    await saturday.click();
    check('Individual choice stays staged', patches === 0);
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    check('Discard restores the saved week', (await selected()).join() === original.join());
    const target = original.join() === '1,2,3,4,7' ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 7];
    await page.getByRole('combobox', { name: 'Common work weeks' }).click();
    await page.getByRole('option', { name: target.includes(7) ? 'Sunday–Thursday' : 'Monday–Friday', exact: true }).click();
    check('Preset stages the exact sorted days', patches === 0 && (await selected()).join() === target.join());
    await save(); persisted = true;
    await open();
    check('Real save survives a reload', (await selected()).join() === target.join());
    // Add days before removing others so the nonempty rule remains true during restoration.
    for (let day = 1; day <= 7; day++) if (original.includes(day) && !(await selected()).includes(day)) await page.getByRole('button', { name: names[day - 1], exact: true }).click();
    for (let day = 1; day <= 7; day++) if (!original.includes(day) && (await selected()).includes(day)) await page.getByRole('button', { name: names[day - 1], exact: true }).click();
    await save(); persisted = false;
    const restored = await call('GET', settingsPath, undefined, d.accessToken);
    check('Starting company work week restored', restored.status === 200 && restored.json.data.workingDays.join() === original.join());
    }
    await page.locator('[role="combobox"][aria-label="Common work weeks"]:enabled').waitFor({ timeout: 30000 });
    check('Selector is settled and editable', await page.getByRole('button', { name: 'Saturday', exact: true }).isEnabled());
    check('Large choice sizing matches approved selector', await page.getByRole('button', { name: 'Saturday', exact: true }).evaluate(node => node.getBoundingClientRect().height >= 46));
    check('No browser exceptions', errors.length === 0);
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(out, { recursive: true });
    const destination = path.join(out, 'settings-working-days-live.png');
    if (fs.existsSync(destination)) throw new Error('Live capture already exists; no retake was requested.');
    await page.screenshot({ path: destination });
  } finally {
    await browser.close();
    if (persisted) {
      // Product API recovery only, with the current section version, if browser verification failed after saving.
      const current = await call('GET', settingsPath, undefined, d.accessToken);
      const response = await fetch(`${BASE}${settingsPath}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${d.accessToken}`, 'If-Match': `"${current.json.data.version}"` }, body: JSON.stringify({ workingDays: original }) });
      if (!response.ok) throw new Error(`Restore failed: ${response.status}`);
    }
  }
  console.log(`Passed ${passed} | Failed 0 | Skipped 0`);
})().catch(error => { console.error(error.message); console.log(`Passed ${passed} | Failed 1 | Skipped 0`); process.exitCode = 1; });
