import { main } from "../src";

void (async () => {
  const app = await main(true);
  if (typeof app !== "function") {
    throw new Error("Expected an Express application");
  }

  const server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string" || !process.send) {
      throw new Error("Unable to report test server address");
    }
    process.send(address.port);
  });
})();
