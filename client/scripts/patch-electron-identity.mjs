#!/usr/bin/env node
/**
 * Patches the dev Electron.app so the macOS dock tooltip, dock label,
 * and menu-bar app name show "Marloues Dev" instead of "Electron".
 *
 * The macOS Dock uses the app bundle directory name (without .app) as the
 * dock label for command-line-launched apps. So we must rename:
 *   1. The bundle directory: Electron.app -> "Marloues Dev.app"
 *   2. The executable binary: Electron -> "Marloues Dev"
 *   3. CFBundleExecutable in Info.plist
 *   4. CFBundleName / CFBundleDisplayName in Info.plist
 *   5. electron npm package path.txt
 *
 * Run automatically via npm postinstall; safe to re-run.
 */
import { existsSync, renameSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const electronDist = join(__dirname, "..", "node_modules", "electron", "dist");
const pathTxtPath = join(__dirname, "..", "node_modules", "electron", "path.txt");

const appName = "Marloues Dev";
const execName = "Marloues Dev";
const bundleName = "Marloues Dev.app";
const oldBundleName = "Electron.app";
const oldExecName = "Electron";

if (!existsSync(electronDist)) {
  console.log("[patch-electron-identity] electron/dist not found, skipping.");
  process.exit(0);
}

try {
  // 1. Rename the app bundle directory
  const oldBundlePath = join(electronDist, oldBundleName);
  const newBundlePath = join(electronDist, bundleName);
  if (existsSync(oldBundlePath)) {
    renameSync(oldBundlePath, newBundlePath);
    console.log(
      `[patch-electron-identity] Renamed bundle: ${oldBundleName} -> ${bundleName}`,
    );
  } else if (!existsSync(newBundlePath)) {
    console.warn(
      `[patch-electron-identity] Neither ${oldBundleName} nor ${bundleName} found`,
    );
    process.exit(0);
  }

  // 2. Rename the executable binary
  const macosDir = join(newBundlePath, "Contents", "MacOS");
  const oldExecPath = join(macosDir, oldExecName);
  const newExecPath = join(macosDir, execName);
  if (existsSync(oldExecPath)) {
    renameSync(oldExecPath, newExecPath);
    console.log(
      `[patch-electron-identity] Renamed binary: ${oldExecName} -> ${execName}`,
    );
  } else if (!existsSync(newExecPath)) {
    console.warn(
      `[patch-electron-identity] Neither ${oldExecName} nor ${execName} found in ${macosDir}`,
    );
  }

  // 3. Update Info.plist
  const plistPath = join(newBundlePath, "Contents", "Info.plist");
  if (existsSync(plistPath)) {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :CFBundleExecutable ${execName}`,
      "-c",
      `Set :CFBundleName ${appName}`,
      "-c",
      `Set :CFBundleDisplayName ${appName}`,
      plistPath,
    ]);
    console.log(
      `[patch-electron-identity] Patched Info.plist: CFBundleExecutable=${execName}, CFBundleName/CFBundleDisplayName="${appName}"`,
    );
  }

  // 4. Update electron npm package path.txt
  if (existsSync(pathTxtPath)) {
    const newPath = `${bundleName}/Contents/MacOS/${execName}`;
    const currentPath = readFileSync(pathTxtPath, "utf-8").trim();
    if (currentPath !== newPath) {
      writeFileSync(pathTxtPath, newPath);
      console.log(`[patch-electron-identity] Updated path.txt -> ${newPath}`);
    }
  }
} catch (err) {
  console.warn("[patch-electron-identity] Failed:", err.message);
}
