// Waits for the MFEs the shell proxies to before `next dev` starts. stack.ps1 -Apps sets FUSION_DEV_APPS to the ones it
// started; by default all three of ours.
const waitOn = require("wait-on");

const ports = { core: 3002, performance: 3004, platform: 3007 };
const apps = (process.env.FUSION_DEV_APPS || "core,performance,platform").split(",").map((app) => app.trim()).filter((app) => ports[app]);

waitOn({ resources: apps.map((app) => `tcp:${ports[app]}`), timeout: 60000 }).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
