/* PRD 8.3 — macOS notarization 钩子。
 * 无 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD 时自动跳过，不阻塞构建。
 * electron-builder 在 afterSign 阶段调用此脚本。 */
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const appName = context.packager.appInfo.productFilename;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log("[notarize] Skipping: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID not set");
    return;
  }

  console.log(`[notarize] Notarizing ${appName}...`);
  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log("[notarize] Done.");
};
