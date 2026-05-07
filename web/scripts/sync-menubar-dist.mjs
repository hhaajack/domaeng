import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, "..");
const sourceDist = path.join(webRoot, "dist");
const appPath = process.env.REMODEX_MENUBAR_APP_PATH || "/Applications/RemodexMenuBar.app";
const targetDist = path.join(appPath, "Contents", "Resources", "dist");
const restart = process.argv.includes("--restart");

await assertDirectory(sourceDist, "Build output is missing. Run `npm run build` first.");
await assertDirectory(path.dirname(targetDist), `RemodexMenuBar resources directory was not found: ${path.dirname(targetDist)}`);

await rm(targetDist, { recursive: true, force: true });
await mkdir(targetDist, { recursive: true });
await cp(sourceDist, targetDist, { recursive: true, force: true });

console.log(`Synced ${sourceDist} -> ${targetDist}`);

if (restart) {
  if (process.platform !== "darwin") {
    throw new Error("--restart is only supported on macOS.");
  }
  spawnChecked("pkill", ["-f", appPath], { allowFailure: true });
  spawnChecked("/usr/bin/open", ["-a", appPath]);
  console.log("Restarted RemodexMenuBar.app");
}

async function assertDirectory(directory, message) {
  try {
    const stats = await stat(directory);
    if (stats.isDirectory()) {
      return;
    }
  } catch {
    // Fall through to the shared error.
  }
  throw new Error(message);
}

function spawnChecked(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}`);
  }
}
