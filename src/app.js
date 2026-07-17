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
const actionsNote = document.querySelector("#actions-note");
const selectAllLabel = document.querySelector("#select-all-label");
const selectAllActions = document.querySelector("#select-all-actions");
const openGuideButton = document.querySelector("#open-guide");
const applyActionsButton = document.querySelector("#apply-actions");
const deleteDisabledButton = document.querySelector("#delete-disabled");
const applyGuide = document.querySelector("#apply-guide");
const closeGuideButton = document.querySelector("#close-guide");
const guideTabs = document.querySelector("#guide-tabs");
const guideContent = document.querySelector("#guide-content");
const downloadScriptButton = document.querySelector("#download-script");
const applyConfirm = document.querySelector("#apply-confirm");
const applyEyebrow = document.querySelector("#apply-eyebrow");
const applyHeading = document.querySelector("#apply-heading");
const applyContent = document.querySelector("#apply-content");
const closeApplyButton = document.querySelector("#close-apply");
const cancelApplyButton = document.querySelector("#cancel-apply");
const confirmApplyButton = document.querySelector("#confirm-apply");
const cleanupConfirm = document.querySelector("#cleanup-confirm");
const cleanupContent = document.querySelector("#cleanup-content");
const closeCleanupButton = document.querySelector("#close-cleanup");
const cancelCleanupButton = document.querySelector("#cancel-cleanup");
const confirmCleanupButton = document.querySelector("#confirm-cleanup");

const supportsDirectoryHandles = "showDirectoryPicker" in window;
const supportsFileHashing = typeof globalThis.crypto?.subtle?.digest === "function";
let manifestPromise;
let displayedFiles = [];
let displayedActions = [];
let collapsedGroups = new Set();
let initializedGroups = new Set();
let guideOperatingSystem = detectOperatingSystem();
let guideActions = [];
let currentModsDirectoryHandle = null;
let directActions = [];
let applyingChanges = false;
let cleanupInProgress = false;

supportMessage.textContent = !supportsFileHashing
  ? "SHA-512 verification requires HTTPS or localhost in this browser."
  : supportsDirectoryHandles
    ? "This browser can apply reviewed changes after you grant folder access."
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
    currentModsDirectoryHandle = modsDirectory;
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
    currentModsDirectoryHandle = null;
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
actionList.addEventListener("input", updateApplyActionsButton);
selectAllActions.addEventListener("input", toggleAllActions);
applyActionsButton.addEventListener("click", openDirectApplyReview);
deleteDisabledButton.addEventListener("click", openDisabledModsCleanup);
openGuideButton.addEventListener("click", openApplyGuide);
closeGuideButton.addEventListener("click", () => applyGuide.close());
applyGuide.addEventListener("click", (event) => {
  if (event.target === applyGuide) {
    applyGuide.close();
  }
});
downloadScriptButton.addEventListener("click", downloadGuideScript);
closeApplyButton.addEventListener("click", closeDirectApply);
cancelApplyButton.addEventListener("click", closeDirectApply);
confirmApplyButton.addEventListener("click", applyDirectChanges);
applyConfirm.addEventListener("cancel", (event) => {
  if (applyingChanges) {
    event.preventDefault();
  }
});
applyConfirm.addEventListener("click", (event) => {
  if (event.target === applyConfirm && !applyingChanges) {
    applyConfirm.close();
  }
});
closeCleanupButton.addEventListener("click", () => cleanupConfirm.close());
cancelCleanupButton.addEventListener("click", () => cleanupConfirm.close());
confirmCleanupButton.addEventListener("click", deleteDisabledMods);
cleanupConfirm.addEventListener("click", (event) => {
  if (event.target === cleanupConfirm && !cleanupInProgress) {
    cleanupConfirm.close();
  }
});
cleanupConfirm.addEventListener("cancel", (event) => {
  if (cleanupInProgress) {
    event.preventDefault();
  }
});

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
    // Chromium can terminate the renderer while redeeming filesystem handles
    // created by a native drag. Use the legacy read-only Entry API for drops
    // in every browser; direct write access is granted only by Choose folder.
    const entries = items
      .map((item) => item.getAsEntry?.() ?? item.webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length === 1 && entries[0].isDirectory) {
      currentModsDirectoryHandle = null;
      const modsDirectory = await findModsDirectoryEntry(entries[0]);
      beginRead("mods");
      const files = await readDirectoryEntry(modsDirectory);
      await compareAndShow("mods", files);
      return;
    }

    if (
      entries.length === 1 && entries[0].isFile
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
    requireFileHashing();
    status.textContent = `Loading the ${profileFor(packProfile.value).name} catalog for ${directoryName}…`;
    const manifest = await loadManifest();
    const modFiles = files.filter((file) => isModJar(directoryName, file.path));
    const disabledModFiles = files.filter((file) => isDisabledModJar(directoryName, file.path));

    const filesToCheck = [...modFiles, ...disabledModFiles];
    for (const [index, file] of filesToCheck.entries()) {
      status.textContent = `Checking mod ${index + 1} of ${filesToCheck.length}…`;
      if (isDisabledModJar(directoryName, file.path)) {
        await compareDisabledFile(file, manifest);
        continue;
      }
      await compareFile(file, manifest);
    }

    for (const file of files) {
      file.manifestStatus ??= "not-a-mod";
    }

    const actions = buildProposedActions(modFiles, disabledModFiles, manifest);
    showResults(directoryName, files, true, actions);
  } catch (error) {
    manifestPromise = undefined;
    console.error(error);
    for (const file of files) {
      file.manifestStatus = isDisabledModJar(directoryName, file.path)
        ? "disabled"
        : isModJar(directoryName, file.path)
          ? "unavailable"
          : "not-a-mod";
    }
    showResults(directoryName, files, false, []);
    status.classList.add("error");
    status.textContent = `Read the directory, but could not complete the comparison: ${error.message ?? "unknown error"}`;
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
        downloadUrl: item.download_url,
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

async function compareDisabledFile(file, manifest) {
  const activeFilename = file.path.slice(0, -".disabled".length);
  const expectedFile = manifest.get(activeFilename.toLowerCase());
  file.sha512 = await sha512(file.file);
  file.disabledMatchesManifest = Boolean(expectedFile && file.sha512 === expectedFile.sha512);
  file.manifestStatus = "disabled";
}

function buildProposedActions(modFiles, disabledModFiles, manifest) {
  const actions = [];
  const installedFilenames = new Set(
    modFiles.map((file) => file.path.split("/").at(-1).toLowerCase()),
  );
  const disabledByActiveFilename = new Map(
    disabledModFiles.map((file) => [
      file.path.slice(0, -".disabled".length).toLowerCase(),
      file,
    ]),
  );

  for (const expectedFile of manifest.values()) {
    const normalizedFilename = expectedFile.filename.toLowerCase();
    if (!installedFilenames.has(normalizedFilename)) {
      const disabledFile = disabledByActiveFilename.get(normalizedFilename);
      if (disabledFile?.disabledMatchesManifest) {
        actions.push({
          kind: "enable",
          path: expectedFile.filename,
          title: `Enable ${expectedFile.filename}`,
          detail: `Restore ${disabledFile.path}; its SHA-512 matches the selected pack.`,
          expectedSha512: disabledFile.sha512,
          sha512: expectedFile.sha512,
        });
        continue;
      }
      actions.push({
        kind: "install",
        path: expectedFile.filename,
        title: `Install ${expectedFile.filename}`,
        detail: "This JAR is missing from the selected pack.",
        sha512: expectedFile.sha512,
        source: expectedFile.source,
        versionId: expectedFile.versionId,
        downloadUrl: expectedFile.downloadUrl,
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
        downloadUrl: expectedFile.downloadUrl,
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

  const kindOrder = { enable: 0, install: 1, replace: 2, disable: 3 };
  return actions.sort(
    (left, right) =>
      kindOrder[left.kind] - kindOrder[right.kind] || left.path.localeCompare(right.path),
  );
}

async function sha512(file) {
  requireFileHashing();
  const digest = await globalThis.crypto.subtle.digest("SHA-512", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function requireFileHashing() {
  if (!supportsFileHashing) {
    throw new Error(
      "secure SHA-512 hashing is unavailable. Open this site over HTTPS or from http://localhost instead of a LAN IP or hostname.",
    );
  }
}

function isModJar(directoryName, path) {
  if (!path.toLowerCase().endsWith(".jar")) {
    return false;
  }

  const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
  return directoryName.toLowerCase() === "mods" && !normalizedPath.includes("/");
}

function isDisabledModJar(directoryName, path) {
  const normalizedPath = path.replaceAll("\\", "/").toLowerCase();
  return directoryName.toLowerCase() === "mods" &&
    normalizedPath.endsWith(".jar.disabled") &&
    !normalizedPath.includes("/");
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
  const selectedCount = selectedActions().length;
  const hasSelectedAction = selectedCount > 0;
  const canApplyDirectly = supportsDirectoryHandles && currentModsDirectoryHandle;
  actionCount.textContent = `${selectedCount.toLocaleString()}/${displayedActions.length.toLocaleString()} selected`;
  selectAllLabel.hidden = displayedActions.length === 0;
  selectAllActions.disabled = displayedActions.length === 0;
  selectAllActions.checked = displayedActions.length > 0 && selectedCount === displayedActions.length;
  selectAllActions.indeterminate = selectedCount > 0 && selectedCount < displayedActions.length;
  applyActionsButton.disabled = !canApplyDirectly || !hasSelectedAction;
  openGuideButton.disabled = !hasSelectedAction;
  openGuideButton.title = hasSelectedAction ? "" : "Select at least one proposed action.";
  applyActionsButton.title = !supportsDirectoryHandles
    ? "Applying changes directly is only supported by Chromium-based browsers."
    : !currentModsDirectoryHandle
      ? "Choose the folder with the browser folder picker to grant direct access."
      : hasSelectedAction
        ? ""
        : "Select at least one proposed action.";

  const disabledMods = disabledModFiles();
  const canDeleteDisabled = supportsDirectoryHandles && currentModsDirectoryHandle;
  deleteDisabledButton.hidden = displayedActions.length > 0 || disabledMods.length === 0;
  deleteDisabledButton.disabled = !canDeleteDisabled;
  deleteDisabledButton.textContent = `Delete ${disabledMods.length.toLocaleString()} disabled mod${disabledMods.length === 1 ? "" : "s"}`;
  deleteDisabledButton.title = canDeleteDisabled
    ? ""
    : "Reopen this folder with Choose folder to grant direct cleanup access.";

  if (displayedActions.length === 0 && disabledMods.length > 0) {
    actionsNote.textContent = canDeleteDisabled
      ? "No corrective actions remain. Disabled mods can be permanently removed after you verify the pack launches successfully."
      : "No corrective actions remain. Reopen this folder with Choose folder to remove disabled mods after a successful launch.";
  } else if (displayedActions.length === 0) {
    actionsNote.textContent = "No corrective actions remain.";
  } else if (!hasSelectedAction) {
    actionsNote.textContent = "Select one or more actions to enable the apply options.";
  } else if (!supportsDirectoryHandles) {
    actionsNote.textContent =
      "The guide is ready. Direct changes require Chrome or another Chromium-based browser over HTTPS or localhost.";
  } else if (!currentModsDirectoryHandle) {
    actionsNote.textContent =
      "The guide is ready. To apply directly, reopen this folder with Choose folder; drag-and-drop and upload access are read-only.";
  } else {
    actionsNote.textContent =
      "The guide and direct update are ready. Nothing changes until you review and confirm.";
  }
}

function toggleAllActions() {
  for (const checkbox of actionList.querySelectorAll('input[name="proposed-action"]')) {
    checkbox.checked = selectAllActions.checked;
  }
  updateApplyActionsButton();
}

function disabledModFiles() {
  return displayedFiles.filter((file) => {
    const normalized = file.path.replaceAll("\\", "/").toLowerCase();
    return normalized.endsWith(".jar.disabled") && !normalized.includes("/");
  });
}

function openDisabledModsCleanup() {
  const disabledMods = disabledModFiles();
  if (displayedActions.length > 0 || disabledMods.length === 0 || !currentModsDirectoryHandle) {
    updateApplyActionsButton();
    return;
  }

  const warning = document.createElement("p");
  warning.className = "apply-warning cleanup-warning";
  warning.textContent =
    "Only use this cleanup after Minecraft has launched successfully with the updated pack. Deletion is permanent and removes the rollback copies created by disabling these mods.";
  const list = document.createElement("ul");
  list.className = "cleanup-file-list";
  for (const file of disabledMods) {
    const item = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = file.path;
    item.append(code);
    list.append(item);
  }
  const acknowledgement = document.createElement("label");
  acknowledgement.className = "cleanup-acknowledgement";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  const text = document.createElement("span");
  text.textContent = "I successfully launched Minecraft and no longer need these disabled mods.";
  checkbox.addEventListener("input", () => {
    confirmCleanupButton.disabled = !checkbox.checked;
  });
  acknowledgement.append(checkbox, text);
  cleanupContent.replaceChildren(warning, list, acknowledgement);
  cleanupInProgress = false;
  closeCleanupButton.hidden = false;
  cancelCleanupButton.hidden = false;
  confirmCleanupButton.hidden = false;
  confirmCleanupButton.disabled = true;
  confirmCleanupButton.textContent = "Permanently delete";
  confirmCleanupButton.onclick = null;
  cleanupConfirm.showModal();
}

async function deleteDisabledMods() {
  const disabledMods = disabledModFiles();
  if (
    cleanupInProgress ||
    displayedActions.length > 0 ||
    disabledMods.length === 0 ||
    !currentModsDirectoryHandle
  ) {
    return;
  }

  cleanupInProgress = true;
  closeCleanupButton.hidden = true;
  cancelCleanupButton.hidden = true;
  confirmCleanupButton.hidden = true;
  const progress = createApplyProgress(disabledMods.length);
  cleanupContent.replaceChildren(progress.container);

  try {
    progress.update("Requesting write permission…", 0);
    const permission = await requestWritePermission(currentModsDirectoryHandle);
    if (permission !== "granted") {
      throw new Error("Write permission was not granted.");
    }
    for (const [index, file] of disabledMods.entries()) {
      progress.update(`Deleting ${file.path}…`, index);
      await currentModsDirectoryHandle.getFileHandle(file.path);
      await currentModsDirectoryHandle.removeEntry(file.path);
      progress.update(`Deleted ${file.path}`, index + 1);
    }

    const refreshedFiles = await readDirectoryHandle(currentModsDirectoryHandle);
    await compareAndShow("mods", refreshedFiles);
    cleanupContent.replaceChildren(
      createApplyMessage(
        `${disabledMods.length} disabled mod${disabledMods.length === 1 ? " was" : "s were"} permanently deleted.`,
      ),
    );
    cleanupInProgress = false;
    confirmCleanupButton.hidden = false;
    confirmCleanupButton.disabled = false;
    confirmCleanupButton.textContent = "Done";
    confirmCleanupButton.onclick = () => {
      confirmCleanupButton.onclick = null;
      cleanupConfirm.close();
    };
  } catch (error) {
    console.error(error);
    cleanupInProgress = false;
    closeCleanupButton.hidden = false;
    cancelCleanupButton.hidden = false;
    cleanupContent.replaceChildren(
      createApplyMessage(`Could not finish cleanup: ${error.message ?? "unknown error"}`, true),
    );
  }
}

function selectedActions() {
  return Array.from(
    actionList.querySelectorAll('input[name="proposed-action"]:checked'),
    (checkbox) => displayedActions[Number(checkbox.dataset.actionIndex)],
  ).filter(Boolean);
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
  checkbox.addEventListener("input", updateApplyActionsButton);

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

async function openDirectApplyReview() {
  const actions = selectedActions();
  if (!currentModsDirectoryHandle || actions.length === 0) {
    updateApplyActionsButton();
    return;
  }

  directActions = [];
  confirmApplyButton.onclick = null;
  confirmApplyButton.textContent = "Confirm and apply";
  applyEyebrow.textContent = "Direct update";
  applyHeading.textContent = "Review browser actions";
  const resolutionMessage = createApplyMessage("Reading catalog download links…");
  applyContent.replaceChildren(resolutionMessage);
  setApplyControls({ confirmDisabled: true });
  applyConfirm.showModal();

  try {
    directActions = await resolveActionDownloads(actions, (message) => {
      resolutionMessage.textContent = message;
    });
    renderDirectApplyReview();
    setApplyControls({ confirmDisabled: false });
  } catch (error) {
    console.error(error);
    applyContent.replaceChildren(
      createApplyMessage(`Could not prepare changes: ${error.message ?? "unknown error"}`, true),
    );
  }
}

function renderDirectApplyReview() {
  const intro = document.createElement("p");
  intro.className = "apply-intro";
  intro.textContent =
    "The browser will run these operations in the selected mods folder. Downloads are staged and SHA-512 verified before any mod is changed.";
  const list = document.createElement("ol");
  list.className = "apply-operation-list";

  for (const action of directActions) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    const operation = document.createElement("code");
    title.textContent = action.title;
    operation.textContent = directOperationSummary(action);
    item.append(title, operation);
    list.append(item);
  }

  const warning = document.createElement("p");
  warning.className = "apply-warning";
  warning.textContent =
    `${directActions.length} selected action${directActions.length === 1 ? "" : "s"} will modify this folder after one final browser permission prompt. ` +
    "Chrome may scan downloaded JARs and block filesystem writes. Do not disable Safe Browsing. If Chrome blocks the update, no mod changes will begin and you can continue with the generated local apply script.";
  applyContent.replaceChildren(intro, list, warning);
}

function directOperationSummary(action) {
  if (action.kind === "enable") {
    return `recheck(${action.path}.disabled) → ensure(missing) → copy(${action.path}) → verify(copy) → remove(disabled)`;
  }
  if (action.kind === "disable") {
    return `recheck(${action.path}) → copy(${action.path}.disabled) → verify(copy) → remove(original)`;
  }
  if (action.kind === "replace") {
    return `download(${action.path}) → verify(SHA-512) → recheck(existing) → backup(existing) → replace(${action.path})`;
  }
  return `download(${action.path}) → verify(SHA-512) → ensure(missing) → write(${action.path})`;
}

function createApplyMessage(message, isError = false) {
  const paragraph = document.createElement("p");
  paragraph.className = isError ? "apply-message apply-error" : "apply-message";
  paragraph.textContent = message;
  return paragraph;
}

function setApplyControls({ busy = false, confirmDisabled = false } = {}) {
  applyingChanges = busy;
  closeApplyButton.hidden = busy;
  cancelApplyButton.hidden = busy;
  confirmApplyButton.hidden = busy;
  confirmApplyButton.disabled = confirmDisabled;
}

function closeDirectApply() {
  if (!applyingChanges) {
    applyConfirm.close();
  }
}

async function applyDirectChanges() {
  if (!currentModsDirectoryHandle || directActions.length === 0 || applyingChanges) {
    return;
  }

  setApplyControls({ busy: true });
  applyEyebrow.textContent = "Applying changes";
  applyHeading.textContent = "Preparing safe update";
  const progress = createApplyProgress(directActions.length);
  applyContent.replaceChildren(progress.container);

  try {
    progress.update("Requesting write permission…", 0);
    const permission = await requestWritePermission(currentModsDirectoryHandle);
    if (permission !== "granted") {
      throw new Error("Write permission was not granted.");
    }

    await runDirectTransaction(currentModsDirectoryHandle, directActions, progress.update);
    progress.update("Changes applied. Refreshing the comparison…", directActions.length);
    const refreshedFiles = await readDirectoryHandle(currentModsDirectoryHandle);
    await compareAndShow("mods", refreshedFiles);

    applyEyebrow.textContent = "Update complete";
    applyHeading.textContent = "Changes applied";
    applyContent.replaceChildren(
      createApplyMessage(
        `${directActions.length} action${directActions.length === 1 ? " was" : "s were"} applied and the folder was rescanned.`,
      ),
    );
    directActions = [];
    setApplyControls();
    cancelApplyButton.hidden = true;
    confirmApplyButton.hidden = false;
    confirmApplyButton.disabled = false;
    confirmApplyButton.textContent = "Done";
    confirmApplyButton.onclick = () => {
      confirmApplyButton.onclick = null;
      confirmApplyButton.textContent = "Confirm and apply";
      applyConfirm.close();
    };
  } catch (error) {
    console.error(error);
    applyEyebrow.textContent = "Update stopped";
    if (isSafeBrowsingBlock(error)) {
      applyHeading.textContent = "Chrome blocked filesystem writes";
      applyContent.replaceChildren(
        createApplyMessage(
          "The completed downloads passed their network and SHA-512 checks, but Chrome Safe Browsing or an organization DLP policy blocked the browser from staging a file. No mod changes were started. The website cannot override this browser decision; use the generated local apply script for the same selected actions.",
          true,
        ),
      );
      directActions = [];
      setApplyControls();
      confirmApplyButton.textContent = "Open apply guide";
      confirmApplyButton.onclick = () => {
        confirmApplyButton.onclick = null;
        confirmApplyButton.textContent = "Confirm and apply";
        applyConfirm.close();
        openApplyGuide();
      };
    } else {
      applyHeading.textContent = "No further changes will run";
      applyContent.replaceChildren(
        createApplyMessage(`Could not finish applying changes: ${error.message ?? "unknown error"}`, true),
      );
      setApplyControls();
    }
  }
}

function isSafeBrowsingBlock(error) {
  return (
    error?.name === "AbortError" &&
    typeof error?.message === "string" &&
    error.message.toLowerCase().includes("safe browsing")
  );
}

async function requestWritePermission(handle) {
  if ((await handle.queryPermission?.({ mode: "readwrite" })) === "granted") {
    return "granted";
  }
  return (await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied";
}

function createApplyProgress(total) {
  const container = document.createElement("div");
  container.className = "apply-loading";
  const spinner = document.createElement("div");
  spinner.className = "apply-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const label = document.createElement("p");
  label.className = "apply-progress-label";
  const meter = document.createElement("progress");
  meter.max = total;
  meter.value = 0;
  container.append(spinner, label, meter);
  return {
    container,
    update(message, value) {
      label.textContent = message;
      meter.value = value;
    },
  };
}

async function runDirectTransaction(modsDirectory, actions, updateProgress) {
  const stateDirectory = await modsDirectory.getDirectoryHandle(".smp-client", { create: true });
  const stageRoot = await stateDirectory.getDirectoryHandle("browser-stage", { create: true });
  const operationId = `${Date.now()}-${crypto.randomUUID()}`;
  const stageDirectory = await stageRoot.getDirectoryHandle(operationId, { create: true });
  const backupRoot = await stateDirectory.getDirectoryHandle("backup", { create: true });
  const backupDirectory = await backupRoot.getDirectoryHandle(operationId, { create: true });
  const stagedFiles = new Map();

  try {
    for (const [index, action] of actions.entries()) {
      assertSafeModFilename(action.path);
      if (action.kind === "disable" || action.kind === "enable") {
        continue;
      }
      updateProgress(`Downloading and verifying ${action.path}…`, index);
      const response = await fetch(action.downloadUrl);
      if (!response.ok) {
        throw new Error(`Download returned HTTP ${response.status} for ${action.path}.`);
      }
      const bytes = await response.arrayBuffer();
      await assertHash(bytes, action.sha512, action.path);
      const stageName = `${index}.jar`;
      await writeBytes(stageDirectory, stageName, bytes);
      await assertHash(await readBytes(stageDirectory, stageName), action.sha512, action.path);
      stagedFiles.set(action, stageName);
    }

    updateProgress("Rechecking the selected folder…", 0);
    for (const action of actions) {
      if (action.kind === "install" || action.kind === "enable") {
        if (await fileExists(modsDirectory, action.path)) {
          throw new Error(`${action.path} now exists; scan again before applying.`);
        }
        if (action.kind === "enable") {
          const disabledPath = `${action.path}.disabled`;
          const disabled = await readBytes(modsDirectory, disabledPath);
          await assertHash(disabled, action.expectedSha512, `${disabledPath} changed since the scan`);
        }
      } else {
        const existing = await readBytes(modsDirectory, action.path);
        await assertHash(existing, action.expectedSha512, `${action.path} changed since the scan`);
        if (action.kind === "disable" && (await fileExists(modsDirectory, `${action.path}.disabled`))) {
          throw new Error(`${action.path}.disabled already exists.`);
        }
      }
    }

    for (const [index, action] of actions.entries()) {
      updateProgress(`Applying ${action.path}…`, index);
      if (action.kind === "enable") {
        const disabledPath = `${action.path}.disabled`;
        const disabled = await readBytes(modsDirectory, disabledPath);
        await writeBytes(modsDirectory, action.path, disabled);
        await assertHash(await readBytes(modsDirectory, action.path), action.sha512, action.path);
        await modsDirectory.removeEntry(disabledPath);
      } else if (action.kind === "disable") {
        const existing = await readBytes(modsDirectory, action.path);
        await writeBytes(modsDirectory, `${action.path}.disabled`, existing);
        await assertHash(
          await readBytes(modsDirectory, `${action.path}.disabled`),
          action.expectedSha512,
          `${action.path}.disabled`,
        );
        await modsDirectory.removeEntry(action.path);
      } else {
        if (action.kind === "replace") {
          const existing = await readBytes(modsDirectory, action.path);
          await writeBytes(backupDirectory, action.path, existing);
          await assertHash(
            await readBytes(backupDirectory, action.path),
            action.expectedSha512,
            `backup of ${action.path}`,
          );
        }
        const staged = await readBytes(stageDirectory, stagedFiles.get(action));
        await writeBytes(modsDirectory, action.path, staged);
        await assertHash(await readBytes(modsDirectory, action.path), action.sha512, action.path);
      }
      updateProgress(`Applied ${action.path}`, index + 1);
    }
  } finally {
    await stageRoot.removeEntry(operationId, { recursive: true }).catch(() => {});
  }
}

function assertSafeModFilename(path) {
  if (!path || path === "." || path === ".." || path.includes("/") || path.includes("\\")) {
    throw new Error(`Unsafe mod filename: ${path}`);
  }
}

async function fileExists(directory, name) {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

async function readBytes(directory, name) {
  const handle = await directory.getFileHandle(name);
  return (await handle.getFile()).arrayBuffer();
}

async function writeBytes(directory, name, bytes) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

async function assertHash(bytes, expectedHash, label) {
  requireFileHashing();
  const digest = await globalThis.crypto.subtle.digest("SHA-512", bytes);
  const actualHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actualHash !== expectedHash.toLowerCase()) {
    throw new Error(`SHA-512 verification failed for ${label}.`);
  }
}

async function openApplyGuide() {
  const actions = selectedActions();
  if (actions.length === 0) {
    return;
  }

  guideActions = [];
  renderGuideTabs();
  const resolutionMessage = createGuideMessage("Reading catalog download links…");
  guideContent.replaceChildren(resolutionMessage);
  downloadScriptButton.disabled = true;
  applyGuide.showModal();

  try {
    guideActions = await resolveActionDownloads(actions, (message) => {
      resolutionMessage.textContent = message;
    });
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
  if (action.kind === "disable" || action.kind === "enable") {
    return action;
  }
  if (action.downloadUrl) {
    assertTrustedDownloadUrl(action.downloadUrl, action.path);
    return action;
  }
  if (action.source !== "modrinth" || !action.versionId) {
    throw new Error(`No supported download source is available for ${action.path}.`);
  }

  const endpoints = [
    `https://api.modrinth.com/v2/version_file/${encodeURIComponent(action.sha512)}?algorithm=sha512`,
    `https://api.modrinth.com/v2/version/${encodeURIComponent(action.versionId)}`,
  ];
  const failures = [];
  let version;

  for (const endpoint of endpoints) {
    try {
      version = await fetchModrinthJson(endpoint, {}, 1);
      break;
    } catch (error) {
      failures.push(error.message ?? "unknown error");
    }
  }

  if (!version) {
    throw new Error(
      `Modrinth could not resolve ${action.path} by SHA-512 or version ID (${failures.join("; ")}).`,
    );
  }
  const file = version.files?.find(
    (candidate) =>
      candidate.filename === action.path &&
      candidate.hashes?.sha512?.toLowerCase() === action.sha512,
  );
  if (!file?.url) {
    throw new Error(`Modrinth did not return the catalog-matched file for ${action.path}.`);
  }
  assertTrustedDownloadUrl(file.url, action.path);
  return { ...action, downloadUrl: file.url };
}

async function resolveActionDownloads(actions, onProgress = () => {}) {
  const resolved = new Map();
  onProgress(`Checking ${actions.length} selected action${actions.length === 1 ? "" : "s"}…`);

  for (const [index, action] of actions.entries()) {
    if (action.kind === "disable" || action.kind === "enable") {
      resolved.set(action, action);
    } else if (action.downloadUrl) {
      assertTrustedDownloadUrl(action.downloadUrl, action.path);
      resolved.set(action, action);
    }
    onProgress(`Prepared ${index + 1}/${actions.length}: ${action.path}`);
  }

  const downloadable = actions.filter(
    (action) => action.kind !== "disable" && action.kind !== "enable" && !resolved.has(action),
  );

  if (downloadable.length > 0) {
    onProgress(`Resolving ${downloadable.length} legacy catalog entr${downloadable.length === 1 ? "y" : "ies"}…`);
    try {
      const versionsByHash = await fetchModrinthJson(
        "https://api.modrinth.com/v2/version_files",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hashes: downloadable.map((action) => action.sha512),
            algorithm: "sha512",
          }),
        },
      );
      for (const action of downloadable) {
        const version = versionsByHash[action.sha512] ?? versionsByHash[action.sha512.toLowerCase()];
        const file = matchingModrinthFile(version, action);
        if (file) {
          assertTrustedDownloadUrl(file.url, action.path);
          resolved.set(action, { ...action, downloadUrl: file.url });
        }
      }
    } catch (error) {
      console.warn(`Modrinth batch lookup failed; falling back sequentially: ${error.message}`);
    }
  }

  // Avoid a retry storm if the batch route is degraded or omits an entry.
  for (const action of actions) {
    if (action.kind === "disable" || action.kind === "enable") {
      resolved.set(action, action);
    } else if (!resolved.has(action)) {
      onProgress(`Resolving fallback metadata for ${action.path}…`);
      resolved.set(action, await resolveActionDownload(action));
      await wait(120);
    }
  }

  return actions.map((action) => resolved.get(action));
}

function assertTrustedDownloadUrl(downloadUrl, path) {
  let parsed;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    throw new Error(`The catalog download URL is invalid for ${path}.`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "cdn.modrinth.com") {
    throw new Error(`The catalog download URL is not a trusted Modrinth CDN URL for ${path}.`);
  }
}

function matchingModrinthFile(version, action) {
  return version?.files?.find(
    (candidate) =>
      candidate.filename === action.path &&
      candidate.hashes?.sha512?.toLowerCase() === action.sha512,
  );
}

async function fetchModrinthJson(url, options = {}, maxAttempts = 3) {
  const retryDelays = [0, 350, 900].slice(0, maxAttempts);
  let lastStatus;

  for (const [attempt, delay] of retryDelays.entries()) {
    if (delay > 0) {
      await wait(delay);
    }
    const response = await fetch(url, options);
    if (response.ok) {
      return response.json();
    }

    lastStatus = response.status;
    const remaining = Number(response.headers.get("X-Ratelimit-Remaining"));
    if (Number.isFinite(remaining) && remaining <= 2) {
      throw new Error(`HTTP ${response.status}; Modrinth rate-limit quota is exhausted`);
    }
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === retryDelays.length - 1) {
      break;
    }
  }

  throw new Error(`HTTP ${lastStatus}`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
    if (action.kind === "enable") {
      return `if (Test-Path -LiteralPath ${path}) { throw 'Destination now exists' }; if ((Get-FileHash -Algorithm SHA512 -LiteralPath ${disabled}).Hash.ToLower() -ne '${action.expectedSha512}') { throw 'Disabled file changed since scan' }; Move-Item -LiteralPath ${disabled} -Destination ${path}`;
    }
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
  if (action.kind === "enable") {
    return `test ! -e ${path} && test "$(sha512sum -- ${disabled} | cut -d' ' -f1)" = '${action.expectedSha512}' && mv -- ${disabled} ${path}`;
  }
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
    if (action.kind === "enable") {
      const disabledPath = quoteShell(`${action.path}.disabled`);
      lines.push(
        `test ! -e ${path} || { echo "Destination now exists: ${escapeDoubleQuotedShell(action.path)}" >&2; exit 1; }`,
        `verify_hash ${disabledPath} '${action.expectedSha512}'`,
        `mv -- ${disabledPath} ${path}`,
      );
      continue;
    }
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
    if (action.kind === "enable") {
      const disabled = quotePowerShell(`${action.path}.disabled`);
      lines.push(
        `  if (Test-Path -LiteralPath ${path}) { throw 'Destination now exists: ${escapePowerShell(action.path)}' }`,
        `  if ((Get-FileHash -Algorithm SHA512 -LiteralPath ${disabled}).Hash.ToLower() -ne '${action.expectedSha512}') { throw 'Changed since scan: ${escapePowerShell(action.path)}.disabled' }`,
        `  Move-Item -LiteralPath ${disabled} -Destination ${path}`,
      );
      continue;
    }
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
    "disabled": "Disabled",
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
