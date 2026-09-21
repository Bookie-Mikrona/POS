import { createRequire } from "node:module";
import path from "node:path";

function getRuntimeModulesDir(): string {
  const configuredDir = process.env.BOOKIE_RUNTIME_MODULES_DIR;
  if (!configuredDir) {
    throw new Error("BOOKIE_RUNTIME_MODULES_DIR ni nastavljen");
  }
  return configuredDir;
}

const runtimeModulesDir = getRuntimeModulesDir();
const runtimeRequire = createRequire(path.resolve(runtimeModulesDir, "__resolver.cjs"));

export function requireRuntimePackage(packagePath: string): unknown {
  return runtimeRequire(path.resolve(runtimeModulesDir, ...packagePath.split("/")));
}