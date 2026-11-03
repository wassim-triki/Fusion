// B-190: two new views, dark 1440×900 through the shell. Changes no application data.
const { chromium } = require('C:/Code/EY/Fusion/Frontend/node_modules/playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const OUT = path.resolve(__dirname, '../plans/B-190-screens');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await context.addInitScript(() => localStorage.setItem('theme', 'dark'));
    const page = await context.newPage();
    const errors = [];
    const missing = new Set();
    page.on("response", response => { if (response.status() === 404) missing.add(new URL(response.url()).pathname); });
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
    await page.goto('http://localhost:3000/auth/signin', { waitUntil: 'domcontentloaded', timeout: 180000 });
    const submit = page.locator('button[type="submit"]');
    await submit.waitFor({ state: 'visible', timeout: 120000 });
    for (let i = 0; i < 5; i++) {
      await page.fill('#email', 'amira.khelifi@example.test');
      await page.fill('#password', process.env.FUSION_LOCAL_PASSWORD);
      await page.waitForTimeout(500);
      if (await page.inputValue('#email') === 'amira.khelifi@example.test') break;
    }
    await submit.click();
    await page.waitForURL(url => !url.pathname.startsWith('/auth'), { timeout: 180000 });
    await page.goto('http://localhost:3000/core', { waitUntil: 'domcontentloaded', timeout: 240000 });
    await page.getByTestId('front-count').waitFor({ timeout: 240000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const initial = await page.getByTestId('front-count').textContent();
    await page.mouse.move(15, 45);
    if (!process.argv.includes('--check')) await page.screenshot({ path: path.join(OUT, '01-growth.png') });
    await page.getByRole('group', { name: /Headcount by department/ }).hover({ position: { x: 250, y: 120 } });
    await page.waitForFunction(expected => document.querySelector('[data-testid="front-count"]')?.textContent !== expected, initial);
    assert.notEqual(await page.getByTestId('front-count').textContent(), initial, 'hover selects a historical month');
    assert.equal(await page.getByText(/joined this month|No joiners this month/).isVisible(), true, 'hover exposes joiners');
    await page.mouse.move(15, 45);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('radio', { name: 'People', exact: true }).click();
    await page.waitForTimeout(700);
    await page.getByRole('radio', { name: 'Place', exact: true }).waitFor();
    assert.deepEqual(errors, [], 'People renders without errors');
    if (!process.argv.includes('--check')) await page.screenshot({ path: path.join(OUT, '02-people.png') });
    // Exercise regrouping and exact date changes without making more review screens.
    await page.getByRole('radio', { name: 'Place', exact: true }).click();
    await page.getByRole('radio', { name: 'Time here', exact: true }).click();
    const slider = page.getByRole('slider');
    await slider.fill('0');
    assert.notEqual(await page.getByTestId('front-count').textContent(), initial, 'past population changes');
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    assert.equal(await page.getByTestId('front-count').textContent(), initial, 'Today restores population');
    await page.getByRole('button', { name: 'Replay', exact: true }).click();
    await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Replay', exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await page.getByTestId('front-count').textContent(), initial, 'Replay finishes today');
    await page.getByRole('heading', { name: 'Next 30 days', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('heading', { name: 'Records to complete', exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole('heading', { name: 'Next 30 days', exact: true }).evaluate(heading => heading.closest('section').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(500);
    if (!process.argv.includes('--check')) await page.screenshot({ path: path.join(OUT, '03-coming-up-and-records.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal page overflow');
    assert.deepEqual(errors, [], 'no page errors');
    if (missing.size) console.log('404 paths:', [...missing].join(', '));
    console.log('Browser interaction checks | Passed 8 | Failed 0 | Skipped 0');
    console.log(OUT);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
