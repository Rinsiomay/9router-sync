const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { updateOpenCode, get9RouterApiKey, fetch9RouterModels } = require("../src/sync");
const { updateHermesYaml } = require("../src/utils/yaml-updater");
const paths = require("../src/utils/paths");

console.log("[Test Suite] Running 9Router-Sync tests...");

// Test 1: Graceful skip when OpenCode file does not exist
{
  const missingPath = path.join(os.tmpdir(), "non-existent-opencode-" + Date.now() + ".json");
  const res = updateOpenCode(missingPath, [{ id: "test-model" }]);
  assert.strictEqual(res.skipped, true, "Should gracefully skip missing OpenCode config");
  console.log("[PASS] Test 1: Graceful OpenCode skip on missing file");
}

// Test 2: OpenCode JSON update with vision & token limits
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-test-"));
  const tmpJson = path.join(tmpDir, "opencode.json");
  fs.writeFileSync(
    tmpJson,
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      provider: {
        "9router": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: "http://127.0.0.1:20128/v1" },
          models: {},
        },
      },
    }),
    "utf-8"
  );

  const sampleModels = [
    { id: "test/claude-3-5", context_length: 200000, max_output: 64000, vision: true, tools: true },
    { id: "test/deepseek", context_length: 128000, max_output: 64000, vision: false, tools: true },
  ];

  const res = updateOpenCode(tmpJson, sampleModels);
  assert.strictEqual(res.updated, true, "OpenCode config should be updated");

  const updated = JSON.parse(fs.readFileSync(tmpJson, "utf-8"));
  const m1 = updated.provider["9router"].models["test/claude-3-5"];
  assert.deepStrictEqual(m1.modalities.input, ["text", "image"]);
  assert.strictEqual(m1.limit.context, 200000);

  const m2 = updated.provider["9router"].models["test/deepseek"];
  assert.deepStrictEqual(m2.modalities.input, ["text"]);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("[PASS] Test 2: OpenCode JSON update and modalities validation");
}

// Test 3: Hermes YAML comment & structure preservation
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-test-"));
  const tmpYaml = path.join(tmpDir, "config.yaml");
  const initialYaml = `# User Custom Comments
model:
  default: custom-model
# Provider Section
providers:
  9router:
    name: 9router
    base_url: http://127.0.0.1:20128/v1
    models: {}
`;
  fs.writeFileSync(tmpYaml, initialYaml, "utf-8");

  const sampleModels = [
    { id: "zd/claude-sonnet-4-5", context_length: 200000, max_output: 64000, vision: true, tools: true },
  ];

  const updated = updateHermesYaml(tmpYaml, sampleModels);
  assert.strictEqual(updated, true, "Hermes YAML should be updated");

  const content = fs.readFileSync(tmpYaml, "utf-8");
  assert.ok(content.includes("# User Custom Comments"), "Comments must be preserved");
  assert.ok(content.includes("# Provider Section"), "Section comments must be preserved");
  assert.ok(content.includes("zd/claude-sonnet-4-5"), "New model must be inserted");
  assert.ok(content.includes("context_length: 200000"), "Context length must be formatted");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("[PASS] Test 3: Hermes YAML comment preservation");
}

// Test 4: Paths helper fallback
{
  const base = paths.get9RouterBaseUrl("20128");
  assert.strictEqual(base, "http://127.0.0.1:20128/v1");

  const rootDir = paths.get9RouterRootDir();
  assert.ok(rootDir, "Root dir must resolve");
  assert.strictEqual(rootDir, path.dirname(paths.get9RouterDbDir()));
  console.log("[PASS] Test 4: Paths helper fallback validation");
}

// Test 5: Watcher event filter logic
{
  const { isDatabaseEvent, isCatalogEvent } = require("../src/watcher");

  // Database event checks (handling null, WAL, SHM, casing)
  assert.strictEqual(isDatabaseEvent(null), true, "null filename in dbDir must trigger");
  assert.strictEqual(isDatabaseEvent(undefined), true, "undefined filename in dbDir must trigger");
  assert.strictEqual(isDatabaseEvent("data.sqlite"), true, "data.sqlite must trigger");
  assert.strictEqual(isDatabaseEvent("data.sqlite-wal"), true, "data.sqlite-wal must trigger");
  assert.strictEqual(isDatabaseEvent("data.sqlite-shm"), true, "data.sqlite-shm must trigger");
  assert.strictEqual(isDatabaseEvent("DATA.SQLITE-WAL"), true, "case variant must trigger");
  assert.strictEqual(isDatabaseEvent("custom.sqlite"), true, "custom .sqlite file must trigger");
  assert.strictEqual(isDatabaseEvent("random.txt"), false, "non-db file must be ignored");

  // Catalog event checks
  assert.strictEqual(isCatalogEvent("model-catalog.json"), true, "model-catalog.json must trigger");
  assert.strictEqual(isCatalogEvent("model-catalog-raw.json"), true, "model-catalog-raw.json must trigger");
  assert.strictEqual(isCatalogEvent("MODEL-CATALOG.JSON"), true, "cased model-catalog must trigger");
  assert.strictEqual(isCatalogEvent("other.json"), false, "other json file must be ignored");
  assert.strictEqual(isCatalogEvent(null), false, "null catalog event must be ignored");

  console.log("[PASS] Test 5: Watcher event filter and null-safety validation");
}

// Test 6: Linux DB path detection & env override
{
  const original = process.env.NINEROUTER_DB_DIR;
  delete process.env.NINEROUTER_DB_DIR;
  const dbDir = paths.get9RouterDbDir();
  if (process.platform === "linux") {
    assert.ok(
      dbDir.endsWith(path.join(".9router", "db")) ||
        dbDir.endsWith(path.join(".config", "9router", "db")),
      `Linux db dir must use ~/.9router/db or ~/.config/9router/db, got ${dbDir}`
    );
  }

  process.env.NINEROUTER_DB_DIR = "/custom/db/path";
  assert.strictEqual(paths.get9RouterDbDir(), path.resolve("/custom/db/path"));
  if (original === undefined) delete process.env.NINEROUTER_DB_DIR;
  else process.env.NINEROUTER_DB_DIR = original;
  console.log("[PASS] Test 6: Linux DB path detection and env override");
}

// Test 7: API key resolution order (env wins over opencode.json)
(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-test-"));
  const tmpJson = path.join(tmpDir, "opencode.json");
  fs.writeFileSync(
    tmpJson,
    JSON.stringify({ provider: { "9router": { options: { apiKey: "from-file" } } } }),
    "utf-8"
  );

  delete process.env.NINEROUTER_API_KEY;
  assert.strictEqual(get9RouterApiKey(tmpJson), "from-file", "Should read key from opencode.json");

  process.env.NINEROUTER_API_KEY = "from-env";
  assert.strictEqual(get9RouterApiKey(tmpJson), "from-env", "Env var should take precedence");
  delete process.env.NINEROUTER_API_KEY;

  const missing = path.join(tmpDir, "nope.json");
  assert.strictEqual(get9RouterApiKey(missing), "", "Missing config yields empty key");

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("[PASS] Test 7: API key resolution order");

  // Test 8: Authorization header sent only when key present
  const http = require("node:http");
  const received = [];
  const server = http.createServer((req, res) => {
    received.push(req.headers["authorization"] || null);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "m1" }] }));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/v1`;

  await fetch9RouterModels(base, "secret-key");
  await fetch9RouterModels(base, "");
  server.close();

  assert.strictEqual(received[0], "Bearer secret-key", "Key must be sent as Bearer token");
  assert.strictEqual(received[1], null, "No Authorization header when key empty");
  console.log("[PASS] Test 8: Authorization header behavior");

  console.log("\nAll 8 tests passed successfully.\n");
})();