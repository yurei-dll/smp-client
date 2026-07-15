import { catalogUrlsFor, profileFor } from "./profiles.js";

const chooseButton = document.querySelector("#choose-directory");
const packProfile = document.querySelector("#pack-profile");
const directoryInput = document.querySelector("#directory-input");
const directoryPicker = document.querySelector("#directory-picker");
const supportMessage = document.querySelector("#support-message");
const status = document.querySelector("#status");
const manifestNote = document.querySelector("#manifest-note");
const manifestProfileName = document.querySelector("#manifest-profile-name");
const manifestProfileGroups = document.querySelector("#manifest-profile-groups");
const results = document.querySelector("#results");
const resultsHeading = document.querySelector("#results-heading");
const fileCount = document.querySelector("#file-count");
const fileList = document.querySelector("#file-list");
const proposedActions = document.querySelector("#proposed-actions");
const actionCount = document.querySelector("#action-count");
const actionList = document.querySelector("#action-list");
const openGuideButton = document.querySelector("#open-guide");
const applyActionsButton = document.querySelector("#apply-actions");
const applyGuide = document.querySelector("#apply-guide");
const closeGuideButton = document.querySelector("#close-guide");
const guideTabs = document.querySelector("#guide-tabs");
const guideContent = document.querySelector("#guide-content");
const downloadScriptButton = document.querySelector("#download-script");

const supportsDirectoryHandles = "showDirectoryPicker" in window;
let manifestPromise;
let displayedFiles = [];
let displayedActions = [];
let collapsedGroups = new Set();
let initializedGroups = new Set();
let guideOperatingSystem = detectOperatingSystem();
let guideActions = [];

supportMessage.textContent = supportsDirectoryHandles
  ? "This browser can read a directory directly after you grant access."
  : "This browser will use a directory upload picker. Files stay on this device.";

chooseButton.addEventListener("click", async () => {
  if (!supportsDirectoryHandles) {
    directoryInput.value = "";
    directoryInput.click();
    return;
  }

  try {
    const selectedDirectory = await window.showDirectoryPicker({ mode: "read" });
    const modsDirectory = await findModsDirectoryHandle(selectedDirectory);
    beginRead("mods");
    const files = await readDirectoryHandle(modsDirectory);
    await compareAndShow("mods", files);
  } catch (error) {
    handlePickerError(error);
  }
});

packProfile.addEventListener("change", async () => {
  manifestPromise = undefined;
  updateManifestProfileNote();
  if (displayedFiles.length === 0 || results.hidden) {
    return;
  }

  beginRead("mods");
  await compareAndShow("mods", displayedFiles);
});

directoryInput.addEventListener("change", async () => {
  const selectedFiles = Array.from(directoryInput.files ?? []);
  if (selectedFiles.length === 0) {
    return;
  }

  try {
    const selectedDirectoryName = rootName(selectedFiles[0].webkitRelativePath);
    const modsFiles = selectModsFiles(selectedFiles, selectedDirectoryName);
    beginRead("mods");

    const files = modsFiles.map(({ file, path }) => ({
      path,
      size: file.size,
      lastModified: file.lastModified,
      file,
    }));

    await compareAndShow("mods", files);
  } catch (error) {
    handlePickerError(error);
  }
});

directoryPicker.addEventListener("dragenter", handleDragEnter);
directoryPicker.addEventListener("dragover", handleDragOver);
directoryPicker.addEventListener("dragleave", handleDragLeave);
directoryPicker.addEventListener("drop", handleDrop);
actionList.addEventListener("change", updateApplyActionsButton);
openGuideButton.addEventListener("click", openApplyGuide);
closeGuideButton.addEventListener("click", () => applyGuide.close());
applyGuide.addEventListener("click", (event) => {
  if (event.target === applyGuide) {
    applyGuide.close();
  }
});
downloadScriptButton.addEventListener("click", downloadGuideScript);

let dragDepth = 0;

function handleDragEnter(event) {
  event.preventDefault();
  dragDepth += 1;
  directoryPicker.classList.add("dragging");
}

function handleDragOver(event) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handleDragLeave(event) {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    directoryPicker.classList.remove("dragging");
  }
}

async function handleDrop(event) {
  event.preventDefault();
  dragDepth = 0;
  directoryPicker.classList.remove("dragging");

  try {
    const items = Array.from(event.dataTransfer?.items ?? []);
    const entries = items
      .map((item) => item.getAsEntry?.() ?? item.webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length === 1 && entries[0].isDirectory) {
      const modsDirectory = await findModsDirectoryEntry(entries[0]);
      beginRead("mods");
      const files = await readDirectoryEntry(modsDirectory);
      await compareAndShow("mods", files);
      return;
    }

    // This method must be called during the synchronous portion of the drop
    // event. It is only a fallback when the widely supported Entry API did not
    // expose a directory.
    const handlePromises = items
      .filter((item) => item.kind === "file" && item.getAsFileSystemHandle)
      .map((item) => item.getAsFileSystemHandle());
    const handles = (await Promise.all(handlePromises)).filter(Boolean);
    if (handles.length === 1 && handles[0].kind === "directory") {
      const modsDirectory = await findModsDirectoryHandle(handles[0]);
      beginRead("mods");
      const files = await readDirectoryHandle(modsDirectory);
      await compareAndShow("mods", files);
      return;
    }

    if (
      (entries.length === 1 && entries[0].isFile) ||
      (handles.length === 1 && handles[0].kind === "file")
    ) {
      throw new Error(
        "The browser exposed this item as a file, so it cannot read through it as a Unix directory symlink. Drop or choose the target folder instead.",
      );
    }

    throw new Error("Drop exactly one folder or directory symlink.");
  } catch (error) {
    handlePickerError(error);
  }
}

async function readDirectoryHandle(directory, parentPath = "") {
  const files = [];

  for await (const [name, entry] of directory.entries()) {
    const path = parentPath ? `${parentPath}/${name}` : name;

    if (entry.kind === "directory") {
      files.push(...(await readDirectoryHandle(entry, path)));
      continue;
    }

    const file = await entry.getFile();
    files.push({
      path,
      size: file.size,
      lastModified: file.lastModified,
      file,
    });
  }

  return files;
}

async function findModsDirectoryHandle(selectedDirectory) {
  if (selectedDirectory.name.toLowerCase() === "mods") {
    return selectedDirectory;
  }

  const directMods = await optionalDirectoryHandle(selectedDirectory, "mods");
  if (directMods) {
    return directMods;
  }

  for (const minecraftName of ["minecraft", ".minecraft"]) {
    const minecraft = await optionalDirectoryHandle(selectedDirectory, minecraftName);
    if (!minecraft) {
      continue;
    }
    const nestedMods = await optionalDirectoryHandle(minecraft, "mods");
    if (nestedMods) {
      return nestedMods;
    }
  }

  throw new Error(
    "No mods folder found. Choose mods, .minecraft, or the parent instance folder.",
  );
}

async function optionalDirectoryHandle(parent, name) {
  try {
    return await parent.getDirectoryHandle(name);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return null;
    }
    throw error;
  }
}

async function readDirectoryEntry(directory, parentPath = "") {
  const files = [];
  const entries = await readAllEntries(directory.createReader());

  for (const entry of entries) {
    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      files.push(...(await readDirectoryEntry(entry, path)));
      continue;
    }

    const file = await entryFile(entry);
    files.push({
      path,
      size: file.size,
      lastModified: file.lastModified,
      file,
    });
  }

  return files;
}

async function findModsDirectoryEntry(selectedDirectory) {
  if (selectedDirectory.name.toLowerCase() === "mods") {
    return selectedDirectory;
  }

  const selectedChildren = await readAllEntries(selectedDirectory.createReader());
  const directMods = findChildDirectory(selectedChildren, "mods");
  if (directMods) {
    return directMods;
  }

  for (const minecraftName of ["minecraft", ".minecraft"]) {
    const minecraft = findChildDirectory(selectedChildren, minecraftName);
    if (!minecraft) {
      continue;
    }
    const minecraftChildren = await readAllEntries(minecraft.createReader());
    const nestedMods = findChildDirectory(minecraftChildren, "mods");
    if (nestedMods) {
      return nestedMods;
    }
  }

  throw new Error(
    "No mods folder found. Drop mods, .minecraft, or the parent instance folder.",
  );
}

function findChildDirectory(entries, name) {
  return entries.find(
    (entry) => entry.isDirectory && entry.name.toLowerCase() === name.toLowerCase(),
  );
}

async function readAllEntries(reader) {
  const entries = [];

  while (true) {
    const batch = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (batch.length === 0) {
      return entries;
    }
    entries.push(...batch);
  }
}

function entryFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function beginRead(directoryName) {
  chooseButton.disabled = true;
  packProfile.disabled = true;
  results.hidden = true;
  manifestNote.hidden = true;
  proposedActions.hidden = true;
  displayedActions = [];
  openGuideButton.disabled = true;
  applyActionsButton.disabled = true;
  collapsedGroups = new Set();
  initializedGroups = new Set();
  status.classList.remove("error");
  status.textContent = `Reading ${directoryName}…`;
}

async function compareAndShow(directoryName, files) {
  try {
    status.textContent = `Loading the ${profileFor(packProfile.value).name} catalog for ${directoryName}…`;
    const manifest = await loadManifest();
    const modFiles = files.filter((file) => isModJar(directoryName, file.path));

    for (const [index, file] of modFiles.entries()) {
      status.textContent = `Checking mod ${index + 1} of ${modFiles.length}…`;
      await compareFile(file, manifest);
    }

    for (const file of files) {
      file.manifestStatus ??= "not-a-mod";
    }

    const actions = buildProposedActions(modFiles, manifest);
    showResults(directoryName, files, true, actions);
  } catch (error) {
    manifestPromise = undefined;
    console.error(error);
    for (const file of files) {
      file.manifestStatus = isModJar(directoryName, file.path)
        ? "unavailable"
        : "not-a-mod";
    }
    showResults(directoryName, files, false, []);
    status.classList.add("error");
    status.textContent = `Read the directory, but could not load the manifest: ${error.message ?? "unknown error"}`;
  }
}

async function loadManifest() {
  manifestPromise ??= Promise.all(
    catalogUrlsFor(packProfile.value).map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`catalog request failed with HTTP ${response.status}`);
      }
      const catalog = await response.json();
      if (!Array.isArray(catalog)) {
        throw new Error("catalog response is not an array");
      }
      return catalog;
    }),
  ).then((catalogs) => {
    const manifest = new Map();
    for (const item of catalogs.flat()) {
      const hash = item?.classification?.sha512;
      if (typeof item?.filename !== "string" || typeof hash !== "string") {
        throw new Error("catalog entry is missing a filename or SHA-512 hash");
      }
      manifest.set(item.filename.toLowerCase(), {
        filename: item.filename,
        sha512: hash.toLowerCase(),
        source: item.source,
        versionId: item.platform_version_id,
      });
    }
    return manifest;
  });

  return manifestPromise;
}

async function compareFile(file, manifest) {
  const filename = file.path.split("/").at(-1).toLowerCase();
  const expectedFile = manifest.get(filename);
  const actualHash = await sha512(file.file);
  file.sha512 = actualHash;

  if (!expectedFile) {
    file.manifestStatus = "not-in-manifest";
    return;
  }

  file.manifestStatus =
    actualHash === expectedFile.sha512 ? "current" : "hash-mismatch";
}

function buildProposedActions(modFiles, manifest) {
  const actions = [];
  const installedFilenames = new Set(
    modFiles.map((file) => file.path.split("/").at(-1).toLowerCase()),
  );

  for (const expectedFile of manifest.values()) {
    if (!installedFilenames.has(expectedFile.filename.toLowerCase())) {
      actions.push({
        kind: "install",
        path: expectedFile.filename,
        title: `Install ${expectedFile.filename}`,
        detail: "This JAR is missing from the selected pack.",
        sha512: expectedFile.sha512,
        source: expectedFile.source,
        versionId: expectedFile.versionId,
      });
    }
  }

  for (const file of modFiles) {
    if (file.manifestStatus === "hash-mismatch") {
      const expectedFile = manifest.get(file.path.split("/").at(-1).toLowerCase());
      actions.push({
        kind: "replace",
        path: file.path,
        title: `Replace ${file.path}`,
        detail: "The filename matches the manifest, but its SHA-512 does not.",
        expectedSha512: file.sha512,
        sha512: expectedFile.sha512,
        source: expectedFile.source,
        versionId: expectedFile.versionId,
      });
    } else if (file.manifestStatus === "not-in-manifest") {
      actions.push({
        kind: "disable",
        path: file.path,
        title: `Disable ${file.path}`,
        detail: `Rename to ${file.path}.disabled so the mod loader ignores it.`,
        expectedSha512: file.sha512,
      });
    }
  }

  const kindOrder = { install: 0, replace: 1, disable: 2 };
  return actions.sort(
    (left, right) =>
      kindOrder[left.kind] - kindOrder[right.kind] || left.path.localeCompare(right.path),
  );
}

async function sha512(file) {
  const digest = await crypto.subtle.digest("SHA-512", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function isModJar(directoryName, path) {
  if (!path.toLowerCase().endsWith(".jar")) {
    return false;
  }

  const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
  return directoryName.toLowerCase() === "mods" && !normalizedPath.includes("/");
}

function showResults(directoryName, files, manifestLoaded, actions) {
  files.sort((left, right) => left.path.localeCompare(right.path));

  resultsHeading.textContent = directoryName;
  fileCount.textContent = files.length.toLocaleString();
  renderFiles(files);

  results.hidden = false;
  manifestNote.hidden = !manifestLoaded;
  if (manifestLoaded) {
    renderActions(actions);
  } else {
    proposedActions.hidden = true;
  }
  chooseButton.disabled = false;
  packProfile.disabled = false;
  status.textContent = `Finished reading and comparing ${files.length.toLocaleString()} files.`;
}

function updateManifestProfileNote() {
  const profile = profileFor(packProfile.value);
  manifestProfileName.textContent = profile.name;
  const groups = profile.groups.map((group) => {
    const code = document.createElement("code");
    code.textContent = group;
    return code;
  });
  const contents = [];
  for (const [index, group] of groups.entries()) {
    if (index > 0) {
      contents.push(document.createTextNode(" + "));
    }
    contents.push(group);
  }
  manifestProfileGroups.replaceChildren(...contents);
}

function renderActions(actions) {
  displayedActions = actions;
  actionList.replaceChildren();
  actionCount.textContent = `${actions.length.toLocaleString()} action${actions.length === 1 ? "" : "s"}`;

  if (actions.length === 0) {
    const item = document.createElement("li");
    item.className = "no-actions";
    item.textContent = "No corrective actions proposed.";
    actionList.append(item);
  } else {
    const fragment = document.createDocumentFragment();
    for (const [index, action] of actions.entries()) {
      fragment.append(createActionItem(action, index));
    }
    actionList.append(fragment);
  }

  proposedActions.hidden = false;
  updateApplyActionsButton();
}

function updateApplyActionsButton() {
  const hasSelectedAction = actionList.querySelector(
    'input[name="proposed-action"]:checked',
  );
  applyActionsButton.disabled = !supportsDirectoryHandles || !hasSelectedAction;
  openGuideButton.disabled = !hasSelectedAction;
  openGuideButton.title = hasSelectedAction ? "" : "Select at least one proposed action.";
  applyActionsButton.title = supportsDirectoryHandles
    ? hasSelectedAction
      ? ""
      : "Select at least one proposed action."
    : "Applying changes directly is not supported by this browser.";
}

function createActionItem(action, index) {
  const item = document.createElement("li");
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  const body = document.createElement("span");
  const heading = document.createElement("span");
  const detail = document.createElement("span");
  const kind = document.createElement("span");

  item.className = `action action-${action.kind}`;
  checkbox.type = "checkbox";
  checkbox.name = "proposed-action";
  checkbox.value = `${action.kind}:${action.path}`;
  checkbox.id = `proposed-action-${index}`;
  checkbox.dataset.actionIndex = index;
  checkbox.checked = false;

  body.className = "action-body";
  heading.className = "action-title";
  heading.textContent = action.title;
  detail.className = "action-detail";
  detail.textContent = action.detail;
  kind.className = "action-kind";
  kind.textContent = action.kind;

  body.append(heading, detail);
  label.append(checkbox, body, kind);
  item.append(label);
  return item;
}

function detectOperatingSystem() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
  return /win/i.test(platform) ? "windows" : "linux";
}

async function openApplyGuide() {
  const selectedIndexes = Array.from(
    actionList.querySelectorAll('input[name="proposed-action"]:checked'),
    (checkbox) => Number(checkbox.dataset.actionIndex),
  );
  const selectedActions = selectedIndexes.map((index) => displayedActions[index]);
  if (selectedActions.length === 0) {
    return;
  }

  guideActions = [];
  renderGuideTabs();
  guideContent.replaceChildren(createGuideMessage("Resolving download information…"));
  downloadScriptButton.disabled = true;
  applyGuide.showModal();

  try {
    guideActions = await Promise.all(selectedActions.map(resolveActionDownload));
    renderGuide();
    downloadScriptButton.disabled = false;
  } catch (error) {
    console.error(error);
    guideContent.replaceChildren(
      createGuideMessage(`Could not prepare the guide: ${error.message ?? "unknown error"}`, true),
    );
  }
}

async function resolveActionDownload(action) {
  if (action.kind === "disable") {
    return action;
  }
  if (action.source !== "modrinth" || !action.versionId) {
    throw new Error(`No supported download source is available for ${action.path}.`);
  }

  const response = await fetch(
    `https://api.modrinth.com/v2/version/${encodeURIComponent(action.versionId)}`,
  );
  if (!response.ok) {
    throw new Error(`Modrinth returned HTTP ${response.status} for ${action.path}.`);
  }
  const version = await response.json();
  const file = version.files?.find(
    (candidate) =>
      candidate.filename === action.path &&
      candidate.hashes?.sha512?.toLowerCase() === action.sha512,
  );
  if (!file?.url) {
    throw new Error(`Modrinth did not return the catalog-matched file for ${action.path}.`);
  }
  return { ...action, downloadUrl: file.url };
}

function renderGuideTabs() {
  const operatingSystems = [
    guideOperatingSystem,
    guideOperatingSystem === "windows" ? "linux" : "windows",
  ];
  const fragment = document.createDocumentFragment();
  for (const operatingSystem of operatingSystems) {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.className = "guide-tab";
    button.textContent = operatingSystem === "windows" ? "Windows" : "Linux";
    button.setAttribute("aria-selected", String(operatingSystem === guideOperatingSystem));
    button.addEventListener("click", () => {
      guideOperatingSystem = operatingSystem;
      renderGuideTabs();
      if (guideActions.length > 0) {
        renderGuide();
      }
    });
    fragment.append(button);
  }
  guideTabs.replaceChildren(fragment);
}

function renderGuide() {
  const intro = document.createElement("p");
  intro.className = "guide-intro";
  intro.textContent =
    guideOperatingSystem === "windows"
      ? "Open PowerShell in your mods folder, then run each selected command."
      : "Open a terminal in your mods folder, then run each selected command.";

  const list = document.createElement("ol");
  list.className = "guide-command-list";
  for (const action of guideActions) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const command = document.createElement("code");
    title.textContent = action.title;
    command.textContent = manualCommand(action, guideOperatingSystem);
    item.append(title, command);
    list.append(item);
  }
  guideContent.replaceChildren(intro, list);
  downloadScriptButton.textContent = `Download generated ${
    guideOperatingSystem === "windows" ? "PowerShell" : "shell"
  } script`;
}

function createGuideMessage(message, isError = false) {
  const paragraph = document.createElement("p");
  paragraph.className = isError ? "guide-message guide-error" : "guide-message";
  paragraph.textContent = message;
  return paragraph;
}

function manualCommand(action, operatingSystem) {
  if (operatingSystem === "windows") {
    const path = quotePowerShell(action.path);
    const backup = quotePowerShell(`.smp-client\\backup\\manual\\${action.path}`);
    const disabled = quotePowerShell(`${action.path}.disabled`);
    const verifyExisting = action.expectedSha512
      ? `if ((Get-FileHash -Algorithm SHA512 -LiteralPath ${path}).Hash.ToLower() -ne '${action.expectedSha512}') { throw 'File changed since scan' }; `
      : `if (Test-Path -LiteralPath ${path}) { throw 'Destination now exists' }; `;
    if (action.kind === "disable") {
      return `${verifyExisting}if (Test-Path -LiteralPath ${disabled}) { throw 'Disabled destination already exists' }; Move-Item -LiteralPath ${path} -Destination ${disabled}`;
    }
    const url = quotePowerShell(action.downloadUrl);
    const staged = quotePowerShell(`${action.path}.download`);
    const verify = `if ((Get-FileHash -Algorithm SHA512 -LiteralPath ${staged}).Hash.ToLower() -ne '${action.sha512}') { Remove-Item -LiteralPath ${staged}; throw 'SHA-512 mismatch' }`;
    const backupExisting =
      action.kind === "replace"
        ? `New-Item -ItemType Directory -Force (Split-Path ${backup}) | Out-Null; Move-Item -LiteralPath ${path} -Destination ${backup}; `
        : "";
    return `${verifyExisting}Invoke-WebRequest -Uri ${url} -OutFile ${staged}; ${verify}; ${backupExisting}Move-Item -LiteralPath ${staged} -Destination ${path}`;
  }

  const path = quoteShell(action.path);
  const backup = quoteShell(`.smp-client/backup/manual/${action.path}`);
  const disabled = quoteShell(`${action.path}.disabled`);
  const verifyExisting = action.expectedSha512
    ? `test "$(sha512sum -- ${path} | cut -d' ' -f1)" = '${action.expectedSha512}' && `
    : `test ! -e ${path} && `;
  if (action.kind === "disable") {
    return `${verifyExisting}test ! -e ${disabled} && mv -- ${path} ${disabled}`;
  }
  const staged = quoteShell(`${action.path}.download`);
  const backupExisting =
    action.kind === "replace"
      ? `mkdir -p "$(dirname ${backup})" && mv -- ${path} ${backup} && `
      : "";
  return `${verifyExisting}curl -fL ${quoteShell(action.downloadUrl)} -o ${staged} && test "$(sha512sum -- ${staged} | cut -d' ' -f1)" = '${action.sha512}' && ${backupExisting}mv -- ${staged} ${path}`;
}

function downloadGuideScript() {
  const windows = guideOperatingSystem === "windows";
  const contents = windows ? createPowerShellScript(guideActions) : createShellScript(guideActions);
  const blobUrl = URL.createObjectURL(
    new Blob([contents], { type: windows ? "text/plain" : "text/x-shellscript" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = windows ? "apply-smp-changes.ps1" : "apply-smp-changes.sh";
  link.hidden = true;
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(blobUrl);
  }, 0);
}

function createShellScript(actions) {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "MODS_DIR=${1:-}",
    'if [[ -z "$MODS_DIR" ]]; then read -r -p "Path to mods folder: " MODS_DIR; fi',
    'cd -- "$MODS_DIR"',
    'BACKUP=".smp-client/backup/$(date +%Y%m%d-%H%M%S)"',
    'STAGE=".smp-client/stage-$$"',
    'mkdir -p "$BACKUP" "$STAGE"',
    "cleanup() { rm -rf -- \"$STAGE\"; }",
    "trap cleanup EXIT",
    'verify_hash() { local path=$1 expected=$2 actual; actual=$(sha512sum -- "$path" | cut -d\' \' -f1); [[ "$actual" == "$expected" ]] || { echo "SHA-512 mismatch: $path" >&2; exit 1; }; }',
  ];
  for (const [index, action] of actions.entries()) {
    const path = quoteShell(action.path);
    const backupPath = `\"$BACKUP/${escapeDoubleQuotedShell(action.path)}\"`;
    if (action.kind === "disable") {
      const disabledPath = quoteShell(`${action.path}.disabled`);
      lines.push(
        `test -f ${path} || { echo "Missing ${escapeDoubleQuotedShell(action.path)}" >&2; exit 1; }`,
        `verify_hash ${path} '${action.expectedSha512}'`,
        `test ! -e ${disabledPath} || { echo "Disabled destination already exists: ${escapeDoubleQuotedShell(action.path)}.disabled" >&2; exit 1; }`,
        `mv -- ${path} ${disabledPath}`,
      );
      continue;
    }
    const staged = `\"$STAGE/${index}.jar\"`;
    if (action.kind === "install") {
      lines.push(`test ! -e ${path} || { echo "Destination now exists: ${escapeDoubleQuotedShell(action.path)}" >&2; exit 1; }`);
    }
    lines.push(
      `curl -fL ${quoteShell(action.downloadUrl)} -o ${staged}`,
      `verify_hash ${staged} '${action.sha512}'`,
    );
    if (action.kind === "replace") {
      lines.push(
        `verify_hash ${path} '${action.expectedSha512}'`,
        `mkdir -p \"$(dirname ${backupPath})\"`,
        `mv -- ${path} ${backupPath}`,
      );
    }
    lines.push(`mv -- ${staged} ${path}`);
  }
  lines.push('echo "Selected SMP changes applied. Backup: $BACKUP"', "");
  return lines.join("\n");
}

function createPowerShellScript(actions) {
  const lines = [
    "param([Parameter(Position=0)][string]$ModsDir)",
    "$ErrorActionPreference = 'Stop'",
    "if (-not $ModsDir) { $ModsDir = Read-Host 'Path to mods folder' }",
    "Set-Location -LiteralPath $ModsDir",
    "$Backup = Join-Path '.smp-client\\backup' (Get-Date -Format 'yyyyMMdd-HHmmss')",
    "$Stage = Join-Path '.smp-client' ('stage-' + $PID)",
    "New-Item -ItemType Directory -Force $Backup, $Stage | Out-Null",
    "try {",
  ];
  for (const [index, action] of actions.entries()) {
    const path = quotePowerShell(action.path);
    const backup = `$Backup + ${quotePowerShell(`\\${action.path}`)}`;
    if (action.kind === "disable") {
      const disabled = quotePowerShell(`${action.path}.disabled`);
      lines.push(
        `  if ((Get-FileHash -Algorithm SHA512 -LiteralPath ${path}).Hash.ToLower() -ne '${action.expectedSha512}') { throw 'Changed since scan: ${escapePowerShell(action.path)}' }`,
        `  if (Test-Path -LiteralPath ${disabled}) { throw 'Disabled destination already exists: ${escapePowerShell(action.path)}.disabled' }`,
        `  Move-Item -LiteralPath ${path} -Destination ${disabled}`,
      );
      continue;
    }
    const staged = `$Stage + '\\${index}.jar'`;
    if (action.kind === "install") {
      lines.push(`  if (Test-Path -LiteralPath ${path}) { throw 'Destination now exists: ${escapePowerShell(action.path)}' }`);
    }
    lines.push(
      `  Invoke-WebRequest -Uri ${quotePowerShell(action.downloadUrl)} -OutFile (${staged})`,
      `  if ((Get-FileHash -Algorithm SHA512 -LiteralPath (${staged})).Hash.ToLower() -ne '${action.sha512}') { throw 'SHA-512 mismatch: ${escapePowerShell(action.path)}' }`,
    );
    if (action.kind === "replace") {
      lines.push(
        `  if ((Get-FileHash -Algorithm SHA512 -LiteralPath ${path}).Hash.ToLower() -ne '${action.expectedSha512}') { throw 'Changed since scan: ${escapePowerShell(action.path)}' }`,
        `  New-Item -ItemType Directory -Force (Split-Path (${backup})) | Out-Null`,
        `  Move-Item -LiteralPath ${path} -Destination (${backup})`,
      );
    }
    lines.push(`  Move-Item -LiteralPath (${staged}) -Destination ${path}`);
  }
  lines.push(
    "  Write-Host \"Selected SMP changes applied. Backup: $Backup\"",
    "} finally {",
    "  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Stage",
    "}",
    "",
  );
  return lines.join("\r\n");
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

function escapeDoubleQuotedShell(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$");
}

function quotePowerShell(value) {
  return `'${escapePowerShell(value)}'`;
}

function escapePowerShell(value) {
  return String(value).replaceAll("'", "''");
}

function renderFiles(files) {
  displayedFiles = files;
  const tree = buildFileTree(files);
  const fragment = document.createDocumentFragment();
  appendDirectoryContents(fragment, tree, "", 0);

  fileList.replaceChildren(fragment);
}

function buildFileTree(files) {
  const root = createDirectoryNode("");

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let directory = root;

    for (const part of parts.slice(0, -1)) {
      if (!directory.directories.has(part)) {
        directory.directories.set(part, createDirectoryNode(part));
      }
      directory = directory.directories.get(part);
    }

    directory.files.push(file);
  }

  return root;
}

function createDirectoryNode(name) {
  return { name, directories: new Map(), files: [] };
}

function appendDirectoryContents(fragment, directory, parentPath, depth) {
  const directories = Array.from(directory.directories.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const child of directories) {
    const path = parentPath ? `${parentPath}/${child.name}` : child.name;
    initializeGroup(path, child.name.startsWith("."));
    fragment.append(createGroupRow(child.name, path, depth, "folder"));
    if (!collapsedGroups.has(path)) {
      appendDirectoryContents(fragment, child, path, depth + 1);
    }
  }

  const regularFiles = directory.files
    .filter((file) => !file.path.toLowerCase().endsWith(".toml"))
    .sort(compareFilePaths);
  const tomlFiles = directory.files
    .filter((file) => file.path.toLowerCase().endsWith(".toml"))
    .sort(compareFilePaths);

  for (const file of regularFiles) {
    fragment.append(createFileRow(file, depth));
  }

  if (tomlFiles.length > 0) {
    const groupPath = `${parentPath}/::toml`;
    initializeGroup(groupPath, true);
    fragment.append(
      createGroupRow(`TOML files (${tomlFiles.length})`, groupPath, depth, "toml"),
    );
    if (!collapsedGroups.has(groupPath)) {
      for (const file of tomlFiles) {
        fragment.append(createFileRow(file, depth + 1));
      }
    }
  }
}

function initializeGroup(path, collapsedByDefault) {
  if (initializedGroups.has(path)) {
    return;
  }
  initializedGroups.add(path);
  if (collapsedByDefault) {
    collapsedGroups.add(path);
  }
}

function createGroupRow(label, path, depth, kind) {
  const row = document.createElement("tr");
  row.className = `group-row group-${kind}`;
  const pathCell = document.createElement("td");
  const button = document.createElement("button");
  const collapsed = collapsedGroups.has(path);

  button.type = "button";
  button.className = "tree-toggle";
  button.style.setProperty("--depth", depth);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.textContent = `${collapsed ? "▸" : "▾"} ${label}`;
  button.addEventListener("click", () => {
    if (collapsedGroups.has(path)) {
      collapsedGroups.delete(path);
    } else {
      collapsedGroups.add(path);
    }
    renderFiles(displayedFiles);
  });

  pathCell.append(button);
  row.append(pathCell, emptyCell());
  return row;
}

function createFileRow(file, depth) {
  const row = document.createElement("tr");
  const pathCell = document.createElement("td");
  const manifestCell = document.createElement("td");

  pathCell.textContent = file.path.split("/").at(-1);
  pathCell.className = "file-path tree-file";
  pathCell.style.setProperty("--depth", depth);
  pathCell.title = file.path;
  manifestCell.append(createStatusBadge(file.manifestStatus));

  row.append(pathCell, manifestCell);
  return row;
}

function emptyCell() {
  return document.createElement("td");
}

function compareFilePaths(left, right) {
  return left.path.localeCompare(right.path);
}

function createStatusBadge(manifestStatus) {
  const labels = {
    "current": "Current",
    "hash-mismatch": "Hash mismatch",
    "not-in-manifest": "Not in manifest",
    "not-a-mod": "Not a mod",
    "unavailable": "Unavailable",
  };
  const badge = document.createElement("span");
  badge.className = `badge badge-${manifestStatus}`;
  badge.textContent = labels[manifestStatus] ?? "Unknown";
  return badge;
}

function handlePickerError(error) {
  chooseButton.disabled = false;

  if (error instanceof DOMException && error.name === "AbortError") {
    status.textContent = "Directory selection canceled.";
    return;
  }

  console.error(error);
  status.classList.add("error");
  status.textContent = `Could not read the directory: ${error.message ?? "unknown error"}`;
}

function rootName(relativePath) {
  return relativePath.split("/", 1)[0] || "Selected directory";
}

function selectModsFiles(files, selectedDirectoryName) {
  const root = `${selectedDirectoryName}/`;
  const candidates =
    selectedDirectoryName.toLowerCase() === "mods"
      ? [root]
      : [`${root}mods/`, `${root}minecraft/mods/`, `${root}.minecraft/mods/`];
  const prefix = candidates.find((candidate) =>
    files.some((file) =>
      file.webkitRelativePath.toLowerCase().startsWith(candidate.toLowerCase()),
    ),
  );

  if (!prefix) {
    throw new Error(
      "No mods folder found. Choose mods, .minecraft, or the parent instance folder.",
    );
  }

  return files
    .filter((file) =>
      file.webkitRelativePath.toLowerCase().startsWith(prefix.toLowerCase()),
    )
    .map((file) => ({ file, path: file.webkitRelativePath.slice(prefix.length) }));
}
