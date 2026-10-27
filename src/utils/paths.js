const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

function get9RouterDbDir() {
  if (process.env.NINEROUTER_DB_DIR) {
    return path.resolve(process.env.NINEROUTER_DB_DIR);
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "9router", "db");
  }
  // Linux/macOS: prefer the canonical ~/.9router/db, fall back to the
  // legacy XDG-style ~/.config/9router/db when it exists.
  const homeDb = path.join(os.homedir(), ".9router", "db");
  if (fs.existsSync(homeDb)) {
    return homeDb;
  }
  const xdgDb = path.join(os.homedir(), ".config", "9router", "db");
  if (fs.existsSync(xdgDb)) {
    return xdgDb;
  }
  return homeDb;
}

function get9RouterRootDir() {
  if (process.env.NINEROUTER_DIR) {
    return path.resolve(process.env.NINEROUTER_DIR);
  }
  return path.dirname(get9RouterDbDir());
}

function get9RouterBaseUrl(cliPort = null) {
  if (process.env.NINEROUTER_URL) {
    return process.env.NINEROUTER_URL.replace(/\/+$/, "");
  }
  const port = cliPort || process.env.NINEROUTER_PORT || "20128";
  return `http://127.0.0.1:${port}/v1`;
}

function getOpenCodeConfigPath() {
  if (process.env.OPENCODE_CONFIG) {
    return path.resolve(process.env.OPENCODE_CONFIG);
  }
  return path.join(os.homedir(), ".config", "opencode", "opencode.json");
}

function getOpenCodePluginsDir() {
  return path.join(os.homedir(), ".config", "opencode", "plugins");
}

function getHermesHome() {
  if (process.env.HERMES_HOME) {
    return path.resolve(process.env.HERMES_HOME);
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const winDefault = path.join(localAppData, "hermes");
    if (fs.existsSync(winDefault)) return winDefault;
  }
  return path.join(os.homedir(), ".hermes");
}

function getHermesProfilesRoot() {
  const home = getHermesHome();
  return path.join(home, "profiles");
}

module.exports = {
  get9RouterDbDir,
  get9RouterRootDir,
  get9RouterBaseUrl,
  getOpenCodeConfigPath,
  getOpenCodePluginsDir,
  getHermesHome,
  getHermesProfilesRoot,
};
