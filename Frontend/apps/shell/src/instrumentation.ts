export async function register() {
  // Inside the condition, not after an early return: only this form lets the edge bundle drop the
  // Node-only module, which a production build otherwise fails on (`node:http`).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installClientAddressStamp } = await import("./lib/client-address");
    installClientAddressStamp();
  }
}
