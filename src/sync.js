const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const {
  get9RouterBaseUrl,
  getOpenCodeConfigPath,
  getHermesHome,
  getHermesProfilesRoot,
} = require("./utils/paths");
const { updateHermesYaml } = require("./utils/yaml-updater");

/**
 * Resolve the 9Router API key when the endpoint requires auth.
 * Order: NINEROUTER_API_KEY env -> opencode.json provider.9router.options.apiKey -> "".
 */
function get9RouterApiKey(configPath) {
  if (process.env.NINEROUTER_API_KEY) {
    return process.env.NINEROUTER_API_KEY;
  }
  const cfgPath = configPath || getOpenCodeConfigPath();
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      const key = cfg?.provider?.["9router"]?.options?.apiKey;
      if (key) return key;
    }
  } catch (err) {
    /* fall through to empty key */
  }
  return "";
}

/**
 * Fetch models and capabilities from 9Router endpoint
 */
function fetch9RouterModels(baseUrl, apiKey, timeoutMs = 3000) {
  return new Promise((resolve) => {
    try {
      const cleanBase = baseUrl.replace(/\/+$/, "");
      const targetUrl = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;
      const urlObj = new URL(targetUrl);

      const headers = { "User-Agent": "9Router-Sync/1.0" };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const req = http.get(
        urlObj,
        {
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return resolve(null);
          }
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(raw);
              const items = parsed.data || [];
              const models = [];
              for (const item of items) {
                const mid = item.id;
                if (!mid) continue;
                const caps = item.capabilities || {};
                const ctx = item.context_length || caps.contextWindow || 200000;
                const maxOut = item.max_completion_tokens || caps.maxOutput || 64000;
                const vision = Boolean(caps.vision);
                const tools = Boolean(caps.tools !== false);
                models.push({
                  id: mid,
                  context_length: parseInt(ctx, 10),
                  max_output: parseInt(maxOut, 10),
                  vision,
                  tools,
                });
              }
              resolve(models);
            } catch (err) {
              resolve(null);
            }
          });
        }
      );

      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

/**
 * Update OpenCode configuration (Auto-detected, gracefully skips if absent)
 */
function updateOpenCode(configPath, models) {
  if (!fs.existsSync(configPath)) {
    return { skipped: true, reason: "File not found" };
  }

  let content;
  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    return { skipped: true, error: err.message };
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return { skipped: true, error: "Invalid JSON" };
  }

  const providers = data.provider || (data.provider = {});
  const r9 = providers["9router"] || (providers["9router"] = {});
  const existingModels = r9.models || (r9.models = {});

  let changed = false;
  const newModelMap = {};

  for (const m of models) {
    const mid = m.id;
    const target = {
      name: mid,
      modalities: {
        input: m.vision ? ["text", "image"] : ["text"],
        output: ["text"],
      },
      limit: {
        context: m.context_length,
        output: m.max_output,
      },
    };
    newModelMap[mid] = target;
    if (JSON.stringify(existingModels[mid]) !== JSON.stringify(target)) {
      changed = true;
    }
  }

  if (changed || Object.keys(newModelMap).length !== Object.keys(existingModels).length) {
    r9.models = newModelMap;
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
    return { updated: true };
  }

  return { updated: false, unchanged: true };
}

/**
 * Update Hermes default profile & all sub-profiles (Auto-detected, gracefully skips if absent)
 */
function updateHermes(models) {
  const hermesHome = getHermesHome();
  if (!fs.existsSync(hermesHome)) {
    return { skipped: true, reason: "Hermes home directory not found" };
  }

  const updatedProfiles = [];

  // 1. Default profile
  const defaultCfg = path.join(hermesHome, "config.yaml");
  if (updateHermesYaml(defaultCfg, models)) {
    updatedProfiles.push(defaultCfg);
  }

  // Clear default cache
  const defaultCache = path.join(hermesHome, "provider_models_cache.json");
  if (fs.existsSync(defaultCache)) {
    try { fs.unlinkSync(defaultCache); } catch (e) {}
  }

  // 2. Named profiles
  const profilesRoot = getHermesProfilesRoot();
  if (fs.existsSync(profilesRoot)) {
    const entries = fs.readdirSync(profilesRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && !ent.name.startsWith(".")) {
        const pCfg = path.join(profilesRoot, ent.name, "config.yaml");
        if (updateHermesYaml(pCfg, models)) {
          updatedProfiles.push(pCfg);
        }
        const pCache = path.join(profilesRoot, ent.name, "provider_models_cache.json");
        if (fs.existsSync(pCache)) {
          try { fs.unlinkSync(pCache); } catch (e) {}
        }
      }
    }
  }

  return { updatedCount: updatedProfiles.length, files: updatedProfiles };
}

/**
 * Execute complete synchronization run
 */
async function runSync(options = {}) {
  const baseUrl = get9RouterBaseUrl(options.port);
  const models = await fetch9RouterModels(baseUrl, get9RouterApiKey());

  if (!models || !models.length) {
    return {
      success: false,
      error: `Could not reach 9Router endpoint at ${baseUrl}. Ensure 9Router is running.`,
    };
  }

  const result = {
    success: true,
    modelCount: models.length,
    opencode: null,
    hermes: null,
  };

  // Sync to OpenCode (unless --hermes-only is specified)
  if (!options.hermesOnly) {
    const opencodePath = getOpenCodeConfigPath();
    result.opencode = updateOpenCode(opencodePath, models);
  } else {
    result.opencode = { skipped: true, reason: "Disabled by --hermes-only flag" };
  }

  // Sync to Hermes (unless --opencode-only is specified)
  if (!options.opencodeOnly) {
    result.hermes = updateHermes(models);
  } else {
    result.hermes = { skipped: true, reason: "Disabled by --opencode-only flag" };
  }

  return result;
}

module.exports = {
  fetch9RouterModels,
  get9RouterApiKey,
  updateOpenCode,
  updateHermes,
  runSync,
};
