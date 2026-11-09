// Walkthrough start state: a new company provisioned by the platform admin through the product API, with Performance on,
// and nothing else. Its administrator, Amira Khelifi (fictional), has only the invitation in Mailpit; accepting it is
// the first step of the walkthrough. Prints the company, the address and the invitation link.
// Run: node .local-docs/agents/data/start-walkthrough-company.mjs   (needs the stack and Mailpit)
//      node .local-docs/agents/data/start-walkthrough-company.mjs --link <admin email>   (reprints the invitation link)
import crypto from "node:crypto";
import { as, sleep } from "./demo-presets/client.mjs";
import { PLATFORM_ADMIN } from "./demo-presets/foundation.mjs";

async function invitationLink(email) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`http://localhost:8025/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    const id = list.messages?.[0]?.ID;
    if (id) {
      const mail = await (await fetch(`http://localhost:8025/api/v1/message/${id}`)).json();
      const link = (mail.Text ?? "").match(/https?:\/\/localhost:3000\/[^\s"<>)]+/)?.[0];
      if (link) return link;
    }
    await sleep(1000);
  }
  throw new Error(`No invitation link reached Mailpit for ${email}`);
}

if (process.argv[2] === "--link") {
  console.log(await invitationLink(process.argv[3]));
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, "");
const company = `Carthage Digital · Walkthrough ${stamp}`;
const adminEmail = `amira.khelifi@walkthrough-${stamp}.example.test`;

const provisioned = await as(PLATFORM_ADMIN).post("/api/identity/platform-admin/tenants", {
  name: company, locale: "en-US", timeZone: "Africa/Tunis", industry: "Technology", modules: ["Performance"],
  administratorEmail: adminEmail, administratorFirstName: "Amira", administratorLastName: "Khelifi",
  idempotencyKey: `walkthrough-${crypto.randomUUID()}`,
});
const tenantId = provisioned?.tenantId ?? provisioned?.id;
if (!tenantId) throw new Error(`Provisioning failed: ${JSON.stringify(provisioned)}`);

console.log(JSON.stringify({ company, tenantId, administrator: adminEmail, invitation: await invitationLink(adminEmail) }, null, 2));
