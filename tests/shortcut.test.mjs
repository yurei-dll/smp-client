import assert from "node:assert/strict";
import test from "node:test";

import {
  fileUrlPath,
  textShortcutTarget,
  windowsShortcutTarget,
} from "../src/shortcut.js";

test("reads a file URL from a desktop shortcut", () => {
  assert.equal(
    textShortcutTarget("[Desktop Entry]\nType=Link\nURL=file:///home/alice/Prism/Pack%20One\n"),
    "/home/alice/Prism/Pack One",
  );
});

test("reads a Windows file URL", () => {
  assert.equal(
    textShortcutTarget("[InternetShortcut]\nURL=file:///C:/Games/Prism/Pack\n"),
    "C:\\Games\\Prism\\Pack",
  );
});

test("reads a network file URL", () => {
  assert.equal(fileUrlPath("file://server/Prism/Pack"), "\\\\server\\Prism\\Pack");
});

test("reads a local path from Windows LinkInfo", () => {
  const target = "C:\\Games\\Prism\\Pack";
  const encoded = new TextEncoder().encode(`${target}\0`);
  const linkInfoSize = 0x1c + encoded.length + 1;
  const buffer = new ArrayBuffer(0x4c + linkInfoSize);
  const view = new DataView(buffer);
  view.setUint32(0, 0x4c, true);
  view.setUint32(0x14, 0x2, true);
  const linkInfo = 0x4c;
  view.setUint32(linkInfo, linkInfoSize, true);
  view.setUint32(linkInfo + 4, 0x1c, true);
  view.setUint32(linkInfo + 8, 0x1, true);
  view.setUint32(linkInfo + 0x10, 0x1c, true);
  view.setUint32(linkInfo + 0x18, 0x1c + encoded.length, true);
  new Uint8Array(buffer, linkInfo + 0x1c, encoded.length).set(encoded);

  assert.equal(windowsShortcutTarget(buffer), target);
});
