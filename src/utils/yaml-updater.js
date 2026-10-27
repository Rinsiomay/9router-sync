const fs = require("node:fs");
const YAML = require("yaml");

/**
 * Updates Hermes config.yaml providers.9router.models map while preserving comments and formatting.
 * @param {string} yamlPath
 * @param {Array<{id: string, context_length: number}>} models
 * @returns {boolean} whether changes were applied
 */
function updateHermesYaml(yamlPath, models) {
  if (!fs.existsSync(yamlPath)) {
    return false;
  }

  let content;
  try {
    content = fs.readFileSync(yamlPath, "utf-8");
  } catch (err) {
    console.error(`[9Router-Sync] Failed to read ${yamlPath}:`, err.message);
    return false;
  }

  let doc;
  try {
    doc = YAML.parseDocument(content);
  } catch (err) {
    console.error(`[9Router-Sync] YAML parse error in ${yamlPath}:`, err.message);
    return false;
  }

  if (!doc || typeof doc.toJS() !== "object") {
    return false;
  }

  // Ensure 'providers' exists
  if (!doc.has("providers")) {
    doc.set("providers", {});
  }

  // Ensure 'providers.9router' exists.
  // Use step-by-step doc.set (not setIn with a plain object): setIn would
  // insert the object as a scalar value, breaking the nested setIn calls below.
  const providersNode = doc.get("providers");
  if (!providersNode.has || !providersNode.has("9router")) {
    providersNode.set("9router", doc.createNode({ name: "9router", base_url: "http://127.0.0.1:20128/v1", models: {} }));
  }

  // Build the model map
  const newModelMap = {};
  for (const m of models) {
    const entry = {};
    if (m.context_length) {
      entry.context_length = m.context_length;
    }
    newModelMap[m.id] = entry;
  }

  doc.setIn(["providers", "9router", "discover_models"], true);
  doc.setIn(["providers", "9router", "models"], newModelMap);

  try {
    const updatedYaml = doc.toString();
    if (updatedYaml !== content) {
      fs.writeFileSync(yamlPath, updatedYaml, "utf-8");
      return true;
    }
  } catch (err) {
    console.error(`[9Router-Sync] Failed to write ${yamlPath}:`, err.message);
    return false;
  }

  return false;
}

module.exports = {
  updateHermesYaml,
};
