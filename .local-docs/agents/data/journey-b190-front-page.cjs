// B-190 read-only authorization and isolation checks through the shell.
const assert = require('node:assert/strict');
const { call, login } = require('../../../.agents/skills/fusion-dev/scripts/api.cjs');
let passed = 0;
function check(label, value) { assert.ok(value, label); passed++; console.log(`PASS ${label}`); }
async function read(token, path) {
  const response = await call('GET', path, null, token);
  assert.equal(response.status, 200, `${path}: ${response.status}`);
  return response.json.data;
}
(async () => {
  const hr = await login('amira.khelifi@example.test');
  const manager = await login('mariam.gharbi@example.test');
  const employee = await login('leila.baccouche@example.test');
  const other = await login(process.env.B190_OTHER ?? 'amira.khelifi@midyear-5.example.test');
  const path = '/api/corehr/reports/front-page';
  check('anonymous read refused', (await call('GET', path)).status === 401);
  check('no Reports read refused', (await call('GET', path, null, employee)).status === 403);
  const front = await read(hr, path);
  const team = await read(manager, path);
  const foreign = await read(other, path);
  check('HR sees company history', !front.teamOnly && front.snapshots.length > 12);
  check('manager history is marked as their team', team.teamOnly);
  const chart = await read(hr, `/api/corehr/org-chart?asOf=${front.today}`);
  const managerKey = chart.people.find(p => p.displayName === 'Mariam Gharbi').employeeKey;
  const branch = new Set(), queue = [managerKey];
  while (queue.length) {
    const key = queue.shift();
    for (const person of chart.people.filter(p => p.managerKey === key)) if (!branch.has(person.employeeKey)) { branch.add(person.employeeKey); queue.push(person.employeeKey); }
  }
  check('every historical and future manager face is in their current branch', team.snapshots.every(s => s.people.every(p => branch.has(p.employeeKey))));
  check('records to complete stay in that branch', team.recordsToComplete.every(p => branch.has(p.employeeKey)));
  const keys = new Set(front.snapshots.flatMap(s => s.people.map(p => p.employeeKey)));
  check('another tenant has no company faces', foreign.snapshots.every(s => s.people.every(p => !keys.has(p.employeeKey))));
  check('another tenant has no company open roles', foreign.openRoles.every(r => !front.openRoles.some(ours => ours.id === r.id)));
  const fields = await read(manager, '/api/corehr/reports/fields');
  check('front-page optional fields follow Reports', team.fields.every(key => fields.some(f => f.key === key)));
  for (const [field, property] of [['job', 'job'], ['place', 'place'], ['first-day', 'firstDay']]) if (!team.fields.includes(field))
    check(`hidden ${field} omitted from every snapshot`, team.snapshots.every(s => s.people.every(p => p[property] == null)));
  const definition = { measure: 'headcount', groupBy: 'division', mode: 'date', from: front.today, to: front.today, interval: 'month', fields: ['name'], filters: [] };
  const report = await call('POST', '/api/corehr/reports/run', definition, hr);
  check('today agrees with the standard Reports engine', report.status === 200 && front.snapshots.find(s => s.date === front.today).people.length === report.json.data.totals[0]);
  console.log(`Front page journey | Passed ${passed} | Failed 0 | Skipped 0`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
