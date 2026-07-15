const SHORTCUT_EXTENSIONS = [".desktop", ".url", ".lnk"];

export async function shortcutTarget(file) {
  const extension = SHORTCUT_EXTENSIONS.find((candidate) =>
    file.name.toLowerCase().endsWith(candidate),
  );

  if (!extension) {
    throw new Error("The dropped file is not a supported folder shortcut.");
  }

  if (extension === ".lnk") {
    return windowsShortcutTarget(await file.arrayBuffer());
  }

  return textShortcutTarget(await file.text());
}

export function textShortcutTarget(text) {
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator !== -1) {
      values.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
  }

  const url = values.get("url");
  if (url?.toLowerCase().startsWith("file:")) {
    return fileUrlPath(url);
  }

  const path = values.get("path");
  if (path) {
    return path;
  }

  throw new Error("The shortcut does not contain a local target path.");
}

export function windowsShortcutTarget(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 0x4c || view.getUint32(0, true) !== 0x4c) {
    throw new Error("The Windows shortcut header is invalid.");
  }

  const linkFlags = view.getUint32(0x14, true);
  let offset = 0x4c;

  if (linkFlags & 0x1) {
    requireBytes(view, offset, 2);
    offset += 2 + view.getUint16(offset, true);
  }

  if (!(linkFlags & 0x2)) {
    throw new Error("The Windows shortcut does not include resolvable link information.");
  }

  requireBytes(view, offset, 0x1c);
  const linkInfoStart = offset;
  const linkInfoSize = view.getUint32(linkInfoStart, true);
  const headerSize = view.getUint32(linkInfoStart + 4, true);
  const linkInfoFlags = view.getUint32(linkInfoStart + 8, true);
  const linkInfoEnd = linkInfoStart + linkInfoSize;

  if (linkInfoSize < headerSize || linkInfoEnd > view.byteLength || !(linkInfoFlags & 0x1)) {
    throw new Error("The Windows shortcut does not contain a local target path.");
  }

  let basePath;
  let suffix;
  if (headerSize >= 0x24) {
    const baseOffset = view.getUint32(linkInfoStart + 0x1c, true);
    const suffixOffset = view.getUint32(linkInfoStart + 0x20, true);
    if (baseOffset) {
      basePath = readNullTerminatedUtf16(view, linkInfoStart + baseOffset, linkInfoEnd);
    }
    if (suffixOffset) {
      suffix = readNullTerminatedUtf16(view, linkInfoStart + suffixOffset, linkInfoEnd);
    }
  }

  if (!basePath) {
    const baseOffset = view.getUint32(linkInfoStart + 0x10, true);
    const suffixOffset = view.getUint32(linkInfoStart + 0x18, true);
    basePath = readNullTerminatedAnsi(view, linkInfoStart + baseOffset, linkInfoEnd);
    suffix = suffixOffset
      ? readNullTerminatedAnsi(view, linkInfoStart + suffixOffset, linkInfoEnd)
      : "";
  }

  if (!basePath) {
    throw new Error("The Windows shortcut target path is empty.");
  }

  return appendWindowsSuffix(basePath, suffix);
}

function appendWindowsSuffix(basePath, suffix) {
  if (!suffix || basePath.toLowerCase().endsWith(suffix.toLowerCase())) {
    return basePath;
  }
  return `${basePath.replace(/[\\/]+$/u, "")}\\${suffix.replace(/^[\\/]+/u, "")}`;
}

export function fileUrlPath(value) {
  const url = new URL(value);
  let path = decodeURIComponent(url.pathname);
  if (/^\/[a-z]:\//iu.test(path)) {
    path = path.slice(1).replaceAll("/", "\\");
  }
  if (url.hostname) {
    return `\\\\${url.hostname}${path.replaceAll("/", "\\")}`;
  }
  return path;
}

function readNullTerminatedAnsi(view, offset, end) {
  if (!offset || offset >= end) {
    return "";
  }
  const bytes = [];
  for (let cursor = offset; cursor < end; cursor += 1) {
    const byte = view.getUint8(cursor);
    if (byte === 0) {
      break;
    }
    bytes.push(byte);
  }
  return new TextDecoder("windows-1252").decode(new Uint8Array(bytes));
}

function readNullTerminatedUtf16(view, offset, end) {
  if (!offset || offset >= end) {
    return "";
  }
  const bytes = [];
  for (let cursor = offset; cursor + 1 < end; cursor += 2) {
    const low = view.getUint8(cursor);
    const high = view.getUint8(cursor + 1);
    if (low === 0 && high === 0) {
      break;
    }
    bytes.push(low, high);
  }
  return new TextDecoder("utf-16le").decode(new Uint8Array(bytes));
}

function requireBytes(view, offset, length) {
  if (offset < 0 || offset + length > view.byteLength) {
    throw new Error("The Windows shortcut is truncated.");
  }
}
