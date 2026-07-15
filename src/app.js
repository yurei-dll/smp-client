const chooseButton = document.querySelector("#choose-directory");
const directoryInput = document.querySelector("#directory-input");
const directoryPicker = document.querySelector("#directory-picker");
const supportMessage = document.querySelector("#support-message");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const resultsHeading = document.querySelector("#results-heading");
const fileCount = document.querySelector("#file-count");
const totalSize = document.querySelector("#total-size");
const fileList = document.querySelector("#file-list");

const supportsDirectoryHandles = "showDirectoryPicker" in window;

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
    const directory = await window.showDirectoryPicker({ mode: "read" });
    beginRead(directory.name);
    const files = await readDirectoryHandle(directory);
    showResults(directory.name, files);
  } catch (error) {
    handlePickerError(error);
  }
});

directoryInput.addEventListener("change", () => {
  const selectedFiles = Array.from(directoryInput.files ?? []);
  if (selectedFiles.length === 0) {
    return;
  }

  const directoryName = rootName(selectedFiles[0].webkitRelativePath);
  beginRead(directoryName);

  const files = selectedFiles.map((file) => ({
    path: stripRoot(file.webkitRelativePath),
    size: file.size,
    lastModified: file.lastModified,
  }));

  showResults(directoryName, files);
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

    const directory = entries[0];
    beginRead(directory.name);
    const files = await readDirectoryEntry(directory);
    showResults(directory.name, files);
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
    });
  }

  return files;
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
    });
  }

  return files;
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
  status.classList.remove("error");
  status.textContent = `Reading ${directoryName}…`;
}

function showResults(directoryName, files) {
  files.sort((left, right) => left.path.localeCompare(right.path));

  resultsHeading.textContent = directoryName;
  fileCount.textContent = files.length.toLocaleString();
  totalSize.textContent = formatBytes(
    files.reduce((sum, file) => sum + file.size, 0),
  );
  renderFiles(files);

  results.hidden = false;
  chooseButton.disabled = false;
  status.textContent = `Finished reading ${files.length.toLocaleString()} files.`;
}

function renderFiles(files) {
  const fragment = document.createDocumentFragment();

  for (const file of files) {
    const row = document.createElement("tr");
    const pathCell = document.createElement("td");
    const sizeCell = document.createElement("td");
    const modifiedCell = document.createElement("td");

    pathCell.textContent = file.path;
    pathCell.className = "file-path";
    sizeCell.textContent = formatBytes(file.size);
    modifiedCell.textContent = file.lastModified
      ? new Date(file.lastModified).toLocaleString()
      : "Unknown";

    row.append(pathCell, sizeCell, modifiedCell);
    fragment.append(row);
  }

  fileList.replaceChildren(fragment);
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

function stripRoot(relativePath) {
  const separator = relativePath.indexOf("/");
  return separator === -1 ? relativePath : relativePath.slice(separator + 1);
}

function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** unitIndex;

  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  })} ${units[unitIndex]}`;
}
