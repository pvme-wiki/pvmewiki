import fs from "node:fs";
import path from "node:path";
// Include full installed-package notices, including build dependencies. No source assets are relicensed.
export function thirdPartyNotices(root) {
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json")),
  );
  const sections = [
    "PvME interface dependencies\n\nThese notices cover installed open-source packages. Some packages are used only on the server or during builds. PvME guide content and game assets retain their separate source rights.\n",
  ];
  for (const [directory, record] of Object.entries(lock.packages)) {
    if (!directory.startsWith("node_modules/")) continue;
    const folder = path.join(root, directory);
    if (!fs.existsSync(folder)) continue;
    const notices = fs
      .readdirSync(folder)
      .filter((name) => /^(licen[cs]e|copying|notice)([-_.]|$)/i.test(name));
    for (const name of notices) {
      const file = path.join(folder, name);
      if (fs.statSync(file).isFile())
        sections.push(
          `\n${"=".repeat(72)}\n${directory.slice(13)} ${record.version} (${record.license || "see notice"}) — ${name}\n\n${fs.readFileSync(file, "utf8")}\n`,
        );
    }
  }
  return sections.join("\n");
}
