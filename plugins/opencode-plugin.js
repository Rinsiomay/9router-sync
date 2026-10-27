/**
 * OpenCode Plugin: 9Router Dynamic Model Synchronizer
 * Automatically queries 9Router on OpenCode boot to populate all models
 * directly into the provider config with exact modalities and token limits.
 */

import http from "node:http";

function fetchModelsFromBaseUrl(baseUrl, apiKey) {
  return new Promise((resolve) => {
    try {
      const cleanBase = baseUrl.replace(/\/+$/, "");
      const targetUrl = cleanBase.endsWith("/models") ? cleanBase : `${cleanBase}/models`;
      const urlObj = new URL(targetUrl);

      const headers = {};
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const req = http.get(urlObj, { headers, timeout: 1500 }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(raw);
            resolve(json.data || []);
          } catch {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

export default async function nineRouterSyncPlugin() {
  return {
    async config(cfg) {
      if (!cfg.provider || !cfg.provider["9router"]) {
        return;
      }
      const pConfig = cfg.provider["9router"];
      const baseUrl = pConfig.options?.baseURL || process.env.NINEROUTER_URL || "http://127.0.0.1:20128/v1";
      const apiKey = pConfig.options?.apiKey || process.env.NINEROUTER_API_KEY || "";

      const remoteModels = await fetchModelsFromBaseUrl(baseUrl, apiKey);
      if (!remoteModels || !remoteModels.length) {
        return;
      }

      const currentModels = pConfig.models || {};
      for (const m of remoteModels) {
        const mid = m.id;
        if (!mid) continue;
        const caps = m.capabilities || {};
        const hasVision = Boolean(caps.vision);
        currentModels[mid] = {
          name: mid,
          modalities: {
            input: hasVision ? ["text", "image"] : ["text"],
            output: ["text"],
          },
          limit: {
            context: m.context_length || caps.contextWindow || 200000,
            output: m.max_completion_tokens || caps.maxOutput || 64000,
          },
        };
      }
      pConfig.models = currentModels;
    },
  };
}
