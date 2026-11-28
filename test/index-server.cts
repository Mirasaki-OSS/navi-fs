import { strict as assert } from "node:assert";
import { main } from "../src";
import { shortBurstRateLimiter } from "../src/modules/rate-limiter";

if (process.argv[2] === "serve" || process.argv[2] === "serve-limited") {
  if (process.argv[2] === "serve-limited") {
    shortBurstRateLimiter.points = 1;
    shortBurstRateLimiter.duration = 60;
  }
  void (async () => {
    const app = await main(true);
    assert.ok(typeof app === "function");
    assert.equal(typeof app.use, "function");

    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string" || !process.send) {
        throw new Error("Unable to report test server address");
      }
      process.send(address.port);
    });
  })();
}
