const chooseButton = document.querySelector("#choose-directory");
const directoryInput = document.querySelector("#directory-input");
const directoryPicker = document.querySelector("#directory-picker");
const supportMessage = document.querySelector("#support-message");
const status = document.querySelector("#status");
const manifestNote = document.querySelector("#manifest-note");
const results = document.querySelector("#results");
const resultsHeading = document.querySelector("#results-heading");
const fileCount = document.querySelector("#file-count");
const fileList = document.querySelector("#file-list");
const proposedActions = document.querySelector("#proposed-actions");
const actionCount = document.querySelector("#action-count");
const actionList = document.querySelector("#action-list");

const supportsDirectoryHandles = "showDirectoryPicker" in window;
const catalogUrls = [
  "https://raw.githubusercontent.com/yurei-dll/smp/main/pack/catalog/core.json",
  "https://raw.githubusercontent.com/yurei-dll/smp/main/pack/catalog/client-optional.json",
];

let manifestPromise;
let displayedFiles = [];
let collapsedGroups = new Set();
let initializedGroups = new Set();

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
    const entries = Array.from(event.dataTransfer?.items ?? [])
      .map((item) => item.getAsEntry?.() ?? item.webkitGetAsEntry?.())
      .filter(Boolean);

    if (entries.length !== 1 || !entries[0].isDirectory) {
      throw new Error("Drop exactly one folder, not individual files.");
    }

    const modsDirectory = await findModsDirectoryEntry(entries[0]);
    beginRead("mods");
    const files = await readDirectoryEntry(modsDirectory);
    await compareAndShow("mods", files);
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
  results.hidden = true;
  manifestNote.hidden = true;
  proposedActions.hidden = true;
  collapsedGroups = new Set();
  initializedGroups = new Set();
  status.classList.remove("error");
  status.textContent = `Reading ${directoryName}…`;
}

async function compareAndShow(directoryName, files) {
  try {
    status.textContent = `Loading the full-client catalog for ${directoryName}…`;
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
    catalogUrls.map(async (url) => {
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
      });
    }
    return manifest;
  });

  return manifestPromise;
}

async function compareFile(file, manifest) {
  const filename = file.path.split("/").at(-1).toLowerCase();
  const expectedFile = manifest.get(filename);

  if (!expectedFile) {
    file.manifestStatus = "not-in-manifest";
    return;
  }

  const actualHash = await sha512(file.file);
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
        detail: "This full-client manifest JAR is missing.",
      });
    }
  }

  for (const file of modFiles) {
    if (file.manifestStatus === "hash-mismatch") {
      actions.push({
        kind: "replace",
        path: file.path,
        title: `Replace ${file.path}`,
        detail: "The filename matches the manifest, but its SHA-512 does not.",
      });
    } else if (file.manifestStatus === "not-in-manifest") {
      actions.push({
        kind: "archive",
        path: file.path,
        title: `Archive ${file.path}`,
        detail: "This local JAR is not in the full-client manifest. It may be a user-installed mod.",
      });
    }
  }

  const kindOrder = { install: 0, replace: 1, archive: 2 };
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
  status.textContent = `Finished reading and comparing ${files.length.toLocaleString()} files.`;
}

function renderActions(actions) {
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
