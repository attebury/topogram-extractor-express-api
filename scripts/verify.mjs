import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workRoot = path.join(root, ".tmp", "package-smoke");
const npmCache = path.join(workRoot, "npm-cache");
const cliPackageSpec = process.env.TOPOGRAM_CLI_PACKAGE_SPEC || defaultCliPackageSpec();

fs.rmSync(workRoot, { recursive: true, force: true });
fs.mkdirSync(npmCache, { recursive: true });

const tarball = packPackage();
assertNoRestrictedFiles(tarball);

const consumerRoot = path.join(workRoot, "consumer");
fs.mkdirSync(consumerRoot, { recursive: true });
fs.writeFileSync(path.join(consumerRoot, "package.json"), JSON.stringify({ name: "extractor-express-smoke", private: true }, null, 2));
run("npm", ["install", "--prefix", consumerRoot, "--silent", "--no-audit", "--ignore-scripts", "--package-lock=false", cliPackageSpec, tarball]);

const topogramBin = path.join(consumerRoot, "node_modules", ".bin", process.platform === "win32" ? "topogram.cmd" : "topogram");
run(topogramBin, ["extractor", "check", "@topogram/extractor-express-api"], { cwd: consumerRoot });

const outputRoot = path.join(workRoot, "extracted");
const result = run(topogramBin, [
  "extract",
  path.join(root, "fixtures", "express"),
  "--out",
  outputRoot,
  "--from",
  "api",
  "--extractor",
  "@topogram/extractor-express-api",
  "--json"
], { cwd: consumerRoot });

const json = JSON.parse(result.stdout);
if (json.candidateCounts?.apiRoutes < 4) throw new Error(`Expected at least four API routes, got ${json.candidateCounts?.apiRoutes ?? 0}.`);

const candidatesPath = path.join(outputRoot, "topo", "candidates", "app", "api", "candidates.json");
const candidates = JSON.parse(fs.readFileSync(candidatesPath, "utf8"));
assert(candidates.stacks.some((entry) => entry.framework === "express"), "Expected Express stack candidate.");
assert(candidates.routes.some((entry) => entry.method === "GET" && entry.path === "/tasks"), "Expected GET /tasks route.");
assert(candidates.routes.some((entry) => entry.method === "GET" && entry.path === "/tasks/{taskId}"), "Expected GET /tasks/{taskId} route.");
assert(candidates.routes.some((entry) => entry.method === "POST" && entry.path === "/tasks"), "Expected POST /tasks route.");
assert(candidates.routes.some((entry) => entry.method === "PATCH" && entry.path === "/tasks/{taskId}"), "Expected PATCH /tasks/{taskId} route.");
assert(candidates.capabilities.some((entry) => entry.id_hint === "cap_list_tasks"), "Expected list tasks capability.");
assert(candidates.capabilities.some((entry) => entry.id_hint === "cap_get_task"), "Expected get task capability.");
assert(candidates.capabilities.some((entry) => entry.id_hint === "cap_create_tasks"), "Expected create tasks capability.");
const packageListRoute = candidates.routes.find((entry) => entry.source === "package:@topogram/extractor-express-api" && entry.method === "GET" && entry.path === "/tasks");
assert(packageListRoute?.auth?.required === true, "Expected route auth hint.");
assert(packageListRoute?.query?.includes("status"), "Expected query param inference.");

const receiptPath = path.join(outputRoot, ".topogram-extract.json");
const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
const extractorProvenance = JSON.stringify(receipt.extractors || receipt.provenance || receipt);
assert(extractorProvenance.includes("@topogram/extractor-express-api"), "Expected extractor provenance to mention package.");
assert(extractorProvenance.includes("api.express-package"), "Expected extractor provenance to mention extractor id.");

console.log("Express extractor package smoke passed.");

function packPackage() {
  const result = run("npm", ["pack", "--silent", "--pack-destination", workRoot], { cwd: root });
  const tarballName = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!tarballName) throw new Error("npm pack did not print a tarball name.");
  return path.join(workRoot, tarballName);
}

function assertNoRestrictedFiles(tarballPath) {
  const result = run("tar", ["-tf", tarballPath], { cwd: workRoot });
  const entries = result.stdout.split(/\r?\n/).filter(Boolean);
  const restricted = entries.filter((entry) => {
    const base = path.posix.basename(entry);
    return /^\.env($|\.)/.test(base)
      || base === ".npmrc"
      || /\.(pem|key|p8|p12)$/i.test(base)
      || /^id_(rsa|ed25519|ecdsa|dsa)$/i.test(base)
      || /^secrets?(\.|$)/i.test(base)
      || /^credentials?(\.|$)/i.test(base);
  });
  if (restricted.length > 0) throw new Error(`Package contains restricted files:\n${restricted.join("\n")}`);
}

function run(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    cwd: options.cwd || workRoot,
    encoding: "utf8",
    env: childEnv()
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function childEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_package_") || key.startsWith("npm_lifecycle_")) delete env[key];
  }
  delete env.INIT_CWD;
  delete env.npm_config_local_prefix;
  delete env.npm_config_prefix;
  env.npm_config_cache = npmCache;
  return env;
}

function defaultCliPackageSpec() {
  const version = fs.readFileSync(path.join(root, "topogram-cli.version"), "utf8").trim();
  if (!version) throw new Error("topogram-cli.version must contain the Topogram CLI version used by extractor verification.");
  return `@topogram/cli@${version}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
