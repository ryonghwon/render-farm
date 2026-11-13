const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

if (process.platform !== "darwin") throw new Error("Mac package verification requires macOS.");
const archives = process.argv.slice(2);
if (!archives.length) throw new Error("Usage: node verify-mac.cjs <archive.zip> [archive.zip ...]");
for (const archive of archives) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mac-package-check-"));
  try {
    execFileSync("/usr/bin/unzip", ["-tq", path.resolve(archive)], { stdio: "pipe" });
    execFileSync("/usr/bin/ditto", ["-x", "-k", path.resolve(archive), directory], { stdio: "pipe" });
    const apps = fs.readdirSync(directory).filter((entry) => entry.endsWith(".app"));
    if (apps.length !== 1) throw new Error("Expected one app bundle at the archive root.");
    const bundle = path.join(directory, apps[0]);
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "pipe" });
    const plist = path.join(bundle, "Contents", "Info.plist");
    const executable = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", plist], { encoding: "utf8" }).trim();
    fs.accessSync(path.join(bundle, "Contents", "MacOS", executable), fs.constants.X_OK);
    console.log(`Verified archive and code signature: ${path.basename(archive)}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
