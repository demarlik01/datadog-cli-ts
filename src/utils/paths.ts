import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_DIR_NAME = "dd-cli";

export function getConfigDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  const dir = path.join(base, CONFIG_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}
