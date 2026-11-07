import { createServer, request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { installClientAddressStamp } from "./client-address";

describe("client address stamp", () => {
  it("names the client by its socket, whatever forwarding headers it sends", async () => {
    installClientAddressStamp();
    let seen: IncomingHttpHeaders = {};
    const server = createServer((incoming, response) => {
      seen = incoming.headers;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    await new Promise<void>((resolve, reject) => {
      request(
        {
          port,
          host: "127.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.4", forwarded: "for=203.0.113.9", "x-real-ip": "203.0.113.9" },
        },
        (response) => response.resume().on("end", resolve),
      )
        .on("error", reject)
        .end();
    });
    await new Promise((resolve) => server.close(resolve));

    expect(seen["x-forwarded-for"]).toBe("127.0.0.1");
    expect(seen.forwarded).toBeUndefined();
    expect(seen["x-real-ip"]).toBeUndefined();
  });
});
