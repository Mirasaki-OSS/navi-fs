import { strict as assert } from "node:assert";
import { configSchema } from "../src/resources/schema";

describe("Configuration validation", () => {
  it("accepts size policies in resource configuration", () => {
    const config = {
      port: 9000,
      "master-api-key": "m".repeat(32),
      resources: [{ slug: "files", target: "/tmp/files" }],
    };
    assert.equal(configSchema.safeParse(config).success, true);

    // Test single policy
    const singlePolicyResult = configSchema.safeParse({
      ...config,
      resources: [{ ...config.resources[0], "size-policy": { unit: "bytes", limit: 1024 } }],
    });
    assert.equal(singlePolicyResult.success, true);

    // Test multiple policies
    const multiplePoliciesResult = configSchema.safeParse({
      ...config,
      resources: [
        {
          ...config.resources[0],
          "size-policy": [
            { unit: "lines", limit: 100 },
            { unit: "bytes", limit: 2048 },
          ],
        },
      ],
    });
    assert.equal(multiplePoliciesResult.success, true);

    // Test null policy
    const nullPolicyResult = configSchema.safeParse({
      ...config,
      resources: [{ ...config.resources[0], "size-policy": null }],
    });
    assert.equal(nullPolicyResult.success, true);

    // Test policy with optional fields
    const optionalFieldsResult = configSchema.safeParse({
      ...config,
      resources: [
        {
          ...config.resources[0],
          "size-policy": {
            unit: "bytes",
            limit: 5120,
            extensions: [".log", ".txt"],
            pattern: ".*\\.log$",
            mode: "truncate",
            cumulative: true,
          },
        },
      ],
    });
    assert.equal(optionalFieldsResult.success, true);
  });
});
