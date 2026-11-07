export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installClientAddressStamp } = await import("./lib/client-address");
  installClientAddressStamp();
}
