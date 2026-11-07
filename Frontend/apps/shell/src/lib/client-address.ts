import { Server, type IncomingMessage } from "node:http";

// The shell is the first hop a browser reaches, so it alone names the client: by the socket the request
// came in on. Next keeps a client-sent X-Forwarded-For (it only fills the header when it's missing) and
// route handlers never see the socket, so the address is stamped here, before Next reads the request.
// Rate limits behind the Gateway key on it (B-297).
export function stampClientAddress(request: IncomingMessage): void {
  delete request.headers.forwarded;
  delete request.headers["x-real-ip"];
  const address = request.socket?.remoteAddress;
  if (address) request.headers["x-forwarded-for"] = address;
  else delete request.headers["x-forwarded-for"];
}

const installed = Symbol.for("fusion.shell.clientAddressStamp");

export function installClientAddressStamp(): void {
  const prototype = Server.prototype as Server & { [installed]?: true };
  if (prototype[installed]) return;
  prototype[installed] = true;
  const emit = prototype.emit;
  prototype.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") stampClientAddress(args[0] as IncomingMessage);
    return Reflect.apply(emit, this, [event, ...args]) as boolean;
  };
}
