const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

module.exports = function withTransientMainActivity(config) {
  const withManifest = withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const mainActivity = activities.find((activity) =>
      (activity["intent-filter"] ?? []).some((filter) =>
        (filter.action ?? []).some((action) => action.$?.["android:name"] === "android.intent.action.MAIN"),
      ),
    );

    if (mainActivity) {
      mainActivity.$["android:excludeFromRecents"] = "true";
      delete mainActivity.$["android:noHistory"];
    }

    if (application && !activities.some((activity) => activity.$?.["android:name"] === ".CallbackActivity")) {
      activities.push({
        $: {
          "android:name": ".CallbackActivity",
          "android:excludeFromRecents": "true",
          "android:exported": "true",
          "android:launchMode": "singleTask",
        },
        "intent-filter": [{
          action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
          category: [
            { $: { "android:name": "android.intent.category.DEFAULT" } },
            { $: { "android:name": "android.intent.category.BROWSABLE" } },
          ],
          data: [{ $: {
            "android:scheme": "bookie-viva-bridge",
            "android:host": "result",
          } }],
        }],
      });
    }

    return modConfig;
  });

  return withDangerousMod(withManifest, [
    "android",
    async (modConfig) => {
      const sourceDir = path.join(modConfig.modRequest.projectRoot, "plugins", "native");
      const targetDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "bookievivabridge",
      );
      fs.mkdirSync(targetDir, { recursive: true });
      for (const filename of ["MainActivity.kt", "MainApplication.kt", "CallbackActivity.kt"]) {
        fs.copyFileSync(path.join(sourceDir, filename), path.join(targetDir, filename));
      }
      return modConfig;
    },
  ]);
};