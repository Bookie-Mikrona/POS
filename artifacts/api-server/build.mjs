import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, cp, rename, writeFile, readdir, readFile, stat } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
const buildRequire = createRequire(import.meta.url);
globalThis.require = buildRequire;

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeArchiveMagic = Buffer.from("BOOKIE_RUNTIME_PACK_V1\n", "utf8");

async function writeWithBackpressure(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

async function listRuntimeFiles(rootDir, relativeDir = "") {
  const currentDir = path.resolve(rootDir, relativeDir);
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = relativeDir
      ? path.posix.join(relativeDir.split(path.sep).join(path.posix.sep), entry.name)
      : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`Runtime archive ne podpira symlinkov: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listRuntimeFiles(rootDir, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function createRuntimeArchive(sourceDir, archivePath) {
  const files = await listRuntimeFiles(sourceDir);
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(archivePath, { mode: 0o600 });
  const finished = new Promise((resolve, reject) => {
    output.on("finish", resolve);
    output.on("error", reject);
    gzip.on("error", reject);
  });
  gzip.pipe(output);

  await writeWithBackpressure(gzip, runtimeArchiveMagic);
  for (const relativePath of files) {
    const absolutePath = path.resolve(sourceDir, ...relativePath.split("/"));
    const fileInfo = await stat(absolutePath);
    const pathBytes = Buffer.from(relativePath, "utf8");
    const header = Buffer.allocUnsafe(16);
    header.writeUInt32BE(pathBytes.length, 0);
    header.writeUInt32BE(fileInfo.mode & 0o777, 4);
    header.writeBigUInt64BE(BigInt(fileInfo.size), 8);

    await writeWithBackpressure(gzip, header);
    await writeWithBackpressure(gzip, pathBytes);
    for await (const chunk of createReadStream(absolutePath)) {
      await writeWithBackpressure(gzip, chunk);
    }
  }
  await writeWithBackpressure(gzip, Buffer.alloc(4));
  gzip.end();
  await finished;

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archivePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.resolve(artifactDir, "../.."),
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${code}`
          }`,
        ),
      );
    });
  });
}

async function prepareRuntimeDependencies(distDir) {
  // Keep the transient pnpm deployment outside artifacts/. A long production
  // build must not let workspace discovery register this package tree as a
  // separate runnable artifact.
  const deployDir = path.resolve("/tmp", `bookie-api-runtime-deploy-${process.pid}`);
  const runtimeArchivePath = path.resolve(distDir, "runtime-packages.dat");
  let runtimeArchiveHash;
  await rm(deployDir, { recursive: true, force: true });

  try {
    const runtimePackageNames = [
      "@google-cloud/storage",
      "@napi-rs/canvas",
      "nodemailer",
      "pdfkit",
    ];

    await run("pnpm", [
      "--filter",
      "@workspace/api-server",
      "deploy",
      "--prod",
      "--legacy",
      "--config.node-linker=hoisted",
      deployDir,
    ]);

    const nodeModulesDir = path.resolve(deployDir, "node_modules");
    const keptPackages = new Set();
    const visitedPackageDirs = new Set();

    async function findInstalledPackage(fromPackageDir, packageName) {
      let currentDir = fromPackageDir;
      while (currentDir.startsWith(nodeModulesDir)) {
        const candidate = path.resolve(currentDir, "node_modules", ...packageName.split("/"));
        try {
          await readFile(path.resolve(candidate, "package.json"), "utf8");
          return candidate;
        } catch {
          const parentDir = path.dirname(currentDir);
          if (parentDir === currentDir) break;
          currentDir = parentDir;
        }
      }

      const rootCandidate = path.resolve(nodeModulesDir, ...packageName.split("/"));
      try {
        await readFile(path.resolve(rootCandidate, "package.json"), "utf8");
        return rootCandidate;
      } catch {
        return null;
      }
    }

    async function collectReachablePackage(packageDir) {
      if (visitedPackageDirs.has(packageDir)) return;
      const packageJsonPath = path.resolve(packageDir, "package.json");
      let packageJson;
      try {
        packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      } catch {
        return;
      }
      visitedPackageDirs.add(packageDir);

      const relativeParts = path.relative(nodeModulesDir, packageDir).split(path.sep);
      const topLevelPackage = relativeParts[0]?.startsWith("@")
        ? `${relativeParts[0]}/${relativeParts[1]}`
        : relativeParts[0];
      if (topLevelPackage) keptPackages.add(topLevelPackage);

      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.optionalDependencies,
        ...packageJson.peerDependencies,
      };
      for (const dependencyName of Object.keys(dependencies)) {
        const dependencyDir = await findInstalledPackage(packageDir, dependencyName);
        if (dependencyDir) {
          await collectReachablePackage(dependencyDir);
        }
      }
    }

    for (const packageName of runtimePackageNames) {
      const packageDir = await findInstalledPackage(nodeModulesDir, packageName);
      if (packageDir) {
        await collectReachablePackage(packageDir);
      }
    }

    const topLevelEntries = await readdir(nodeModulesDir, { withFileTypes: true });
    for (const entry of topLevelEntries) {
      const entryPath = path.resolve(nodeModulesDir, entry.name);
      if (entry.name.startsWith("@") && entry.isDirectory()) {
        const scopedEntries = await readdir(entryPath, { withFileTypes: true });
        await Promise.all(scopedEntries
          .filter((scopedEntry) => !keptPackages.has(`${entry.name}/${scopedEntry.name}`))
          .map((scopedEntry) => rm(path.resolve(entryPath, scopedEntry.name), { recursive: true, force: true })));
        if ((await readdir(entryPath)).length === 0) {
          await rm(entryPath, { recursive: true, force: true });
        }
      } else if (!keptPackages.has(entry.name)) {
        await rm(entryPath, { recursive: true, force: true });
      }
    }

    // Publish removes package-shaped directory trees after the artifact build.
    // Store the pruned physical tree as one opaque archive and reconstruct it
    // under /tmp only after the production process starts.
    runtimeArchiveHash = await createRuntimeArchive(
      path.resolve(deployDir, "node_modules"),
      runtimeArchivePath,
    );
  } finally {
    await rm(deployDir, { recursive: true, force: true });
  }

  if (!runtimeArchiveHash) {
    throw new Error("Arhiv produkcijskih runtime paketov ni bil ustvarjen");
  }

  await cp(
    path.resolve(artifactDir, "runtime-bootstrap.mjs"),
    path.resolve(distDir, "runtime-bootstrap.mjs"),
  );
  await writeFile(
    path.resolve(distDir, "index.mjs"),
    `import { ensureRuntimePackages } from "./runtime-bootstrap.mjs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rawPort = process.env.PORT;
const port = Number(rawPort);
if (!rawPort || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(\`Invalid PORT value: "\${rawPort ?? ""}"\`);
}

const bootstrapServer = createServer((req, res) => {
  const isStartupHealthCheck =
    req.method === "GET" &&
    (req.url === "/api/healthz" || req.url?.startsWith("/api/healthz?"));
  res.statusCode = isStartupHealthCheck ? 200 : 503;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Retry-After", "2");
  res.end('{"status":"starting"}');
});
await new Promise((resolve, reject) => {
  bootstrapServer.once("error", reject);
  bootstrapServer.listen(port, "0.0.0.0", resolve);
});
console.info(JSON.stringify({ phase: "runtime-bootstrap", status: "port-open", port }));

try {
  const startedAt = Date.now();
  const runtimeModules = await ensureRuntimePackages({
    archivePath: fileURLToPath(new URL("./runtime-packages.dat", import.meta.url)),
    cacheKey: "${runtimeArchiveHash}",
  });
  console.info(JSON.stringify({
    phase: "runtime-bootstrap",
    status: "packages-ready",
    durationMs: Date.now() - startedAt,
  }));
  process.env.BOOKIE_RUNTIME_MODULES_DIR = runtimeModules;
  const runtimeRequire = createRequire(import.meta.url);
  const nodeModule = runtimeRequire("node:module");
  process.env.NODE_PATH = [runtimeModules, process.env.NODE_PATH]
    .filter(Boolean)
    .join(path.delimiter);
  nodeModule.Module._initPaths();

  await new Promise((resolve, reject) => {
    bootstrapServer.close((error) => error ? reject(error) : resolve());
  });
  console.info(JSON.stringify({ phase: "runtime-bootstrap", status: "loading-app" }));
  await import("./app.mjs");
} catch (error) {
  console.error(JSON.stringify({
    phase: "runtime-bootstrap",
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
  }));
  if (bootstrapServer.listening) {
    await new Promise((resolve) => bootstrapServer.close(() => resolve()));
  }
  throw error;
}
`,
  );
}

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  // Kopiraj statične vire (fonti, slike…) v dist/
  const srcAssets = path.resolve(artifactDir, "src/assets");
  const dstAssets = path.resolve(distDir, "assets");
  await cp(srcAssets, dstAssets, { recursive: true }).catch(() => {
    // src/assets morda ne obstaja — ni napake
  });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    alias: {
      "pdfkit": path.resolve(artifactDir, "src/runtime-shims/pdfkit.ts"),
      "nodemailer": path.resolve(artifactDir, "src/runtime-shims/nodemailer.ts"),
      "@google-cloud/storage": path.resolve(artifactDir, "src/runtime-shims/google-cloud-storage.ts"),
      "@napi-rs/canvas": path.resolve(artifactDir, "src/runtime-shims/napi-canvas.ts"),
    },
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "@napi-rs/canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "pdfkit",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
      "pdfkit",
      "fontkit",
      "linebreak",
      "unicode-properties",
      "unicode-trie",
      "brotli",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await rename(
    path.resolve(distDir, "index.mjs"),
    path.resolve(distDir, "app.mjs"),
  );
  await prepareRuntimeDependencies(distDir);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
