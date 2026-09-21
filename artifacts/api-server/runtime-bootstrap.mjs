import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";

const archiveMagic = Buffer.from("BOOKIE_RUNTIME_PACK_V1\n", "utf8");
const maxPathBytes = 16 * 1024;
const ioChunkSize = 64 * 1024;

class ArchiveReader {
  constructor(stream) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.ended = false;
  }

  async readExactly(length) {
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new Error(`Neveljavna dolžina zapisa v runtime arhivu: ${length}`);
    }
    const result = Buffer.allocUnsafe(length);
    let offset = 0;

    while (offset < length) {
      if (this.buffer.length === 0) {
        const next = await this.iterator.next();
        if (next.done) {
          this.ended = true;
          throw new Error("Runtime arhiv se je nepričakovano končal");
        }
        this.buffer = Buffer.from(next.value);
      }

      const consumed = Math.min(length - offset, this.buffer.length);
      this.buffer.copy(result, offset, 0, consumed);
      this.buffer = this.buffer.subarray(consumed);
      offset += consumed;
    }

    return result;
  }

  async expectEnd() {
    if (this.buffer.length > 0) {
      throw new Error("Runtime arhiv vsebuje podatke za zaključnim zapisom");
    }
    const next = await this.iterator.next();
    if (!next.done) {
      throw new Error("Runtime arhiv vsebuje podatke za zaključnim zapisom");
    }
    this.ended = true;
  }
}

function resolveArchivePath(targetDir, relativePath) {
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(`Nevarna pot v runtime arhivu: ${relativePath}`);
  }

  const resolved = path.resolve(targetDir, ...relativePath.split("/"));
  if (!resolved.startsWith(`${targetDir}${path.sep}`)) {
    throw new Error(`Pot zapisa zapusti runtime mapo: ${relativePath}`);
  }
  return resolved;
}

async function writeArchiveFile(reader, targetPath, size, mode) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const file = await open(targetPath, "wx", mode & 0o777);

  try {
    let remaining = size;
    while (remaining > 0) {
      const length = Math.min(remaining, ioChunkSize);
      const chunk = await reader.readExactly(length);
      let offset = 0;
      while (offset < chunk.length) {
        const result = await file.write(chunk, offset, chunk.length - offset);
        offset += result.bytesWritten;
      }
      remaining -= length;
    }
  } finally {
    await file.close();
  }

  await chmod(targetPath, mode & 0o777);
}

async function extractRuntimeArchive(archivePath, targetDir) {
  const gunzip = createReadStream(archivePath).pipe(createGunzip());
  const reader = new ArchiveReader(gunzip);
  const magic = await reader.readExactly(archiveMagic.length);
  if (!magic.equals(archiveMagic)) {
    throw new Error("Neveljaven format runtime arhiva");
  }

  while (true) {
    const pathLength = (await reader.readExactly(4)).readUInt32BE(0);
    if (pathLength === 0) break;
    if (pathLength > maxPathBytes) {
      throw new Error(`Predolga pot v runtime arhivu: ${pathLength} B`);
    }

    const metadata = await reader.readExactly(12);
    const mode = metadata.readUInt32BE(0);
    const sizeBigInt = metadata.readBigUInt64BE(4);
    if (sizeBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("Datoteka v runtime arhivu je prevelika");
    }

    const relativePath = (await reader.readExactly(pathLength)).toString("utf8");
    const targetPath = resolveArchivePath(targetDir, relativePath);
    await writeArchiveFile(reader, targetPath, Number(sizeBigInt), mode);
  }

  await reader.expectEnd();
}

async function hasCompleteMarker(targetDir, cacheKey) {
  try {
    return (await readFile(path.resolve(targetDir, ".complete"), "utf8")) === cacheKey;
  } catch {
    return false;
  }
}

async function calculateArchiveHash(archivePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function ensureRuntimePackages({ archivePath, cacheKey }) {
  if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
    throw new Error("Neveljaven ključ runtime arhiva");
  }
  const actualHash = await calculateArchiveHash(archivePath);
  if (actualHash !== cacheKey) {
    throw new Error("Kontrolna vsota runtime arhiva se ne ujema");
  }

  const targetDir = path.resolve("/tmp", `bookie-api-runtime-${cacheKey.slice(0, 20)}`);
  if (await hasCompleteMarker(targetDir, cacheKey)) {
    return targetDir;
  }

  const temporaryDir = `${targetDir}.tmp-${process.pid}-${randomUUID()}`;
  await rm(temporaryDir, { recursive: true, force: true });
  await mkdir(temporaryDir, { recursive: true });

  try {
    await extractRuntimeArchive(archivePath, temporaryDir);
    await writeFile(path.resolve(temporaryDir, ".complete"), cacheKey, {
      encoding: "utf8",
      mode: 0o600,
    });

    try {
      await rename(temporaryDir, targetDir);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "ENOTEMPTY") {
        throw error;
      }
      await rm(temporaryDir, { recursive: true, force: true });
      if (!await hasCompleteMarker(targetDir, cacheKey)) {
        throw new Error("Sočasno ustvarjena runtime mapa ni popolna");
      }
    }
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true });
    throw error;
  }

  return targetDir;
}