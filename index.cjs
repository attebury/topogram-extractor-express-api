const manifest = require("./topogram-extractor.json");
const fs = require("node:fs");
const path = require("node:path");

const expressExtractor = {
  id: "api.express-package",
  track: "api",
  detect(context = {}) {
    const files = findPrimaryFiles(context, isJavaScriptLike);
    const packageJson = readJson(path.join(rootDir(context), "package.json"));
    const hasExpressDependency = Boolean(packageJson?.dependencies?.express || packageJson?.devDependencies?.express);
    const routeFiles = files.filter((filePath) => {
      const text = readText(filePath) || "";
      return /\b(app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(/.test(text);
    });
    if (!hasExpressDependency && routeFiles.length === 0) return { score: 0, reasons: [] };
    return {
      score: routeFiles.length > 0 ? 95 : 50,
      reasons: [
        hasExpressDependency ? "Found express dependency." : "",
        routeFiles.length > 0 ? `Found ${routeFiles.length} Express route file(s).` : ""
      ].filter(Boolean)
    };
  },
  extract(context = {}) {
    const files = findPrimaryFiles(context, isJavaScriptLike);
    const routeConstantMap = new Map();
    const permissionMetadata = new Map();
    for (const filePath of files) {
      const text = readText(filePath) || "";
      for (const [key, value] of parseApiRoutesMap(text)) routeConstantMap.set(key, value);
      for (const [key, value] of parsePermissionsMetadata(text, routeConstantMap)) permissionMetadata.set(key, value);
    }

    const routes = [];
    const capabilities = [];
    for (const filePath of files) {
      const text = readText(filePath) || "";
      for (const route of parseExpressRoutes(context, filePath, text, routeConstantMap, permissionMetadata)) {
        routes.push(route);
        capabilities.push(buildCapability(route));
      }
    }

    return {
      findings: [],
      candidates: {
        capabilities: dedupe(capabilities, (entry) => entry.id_hint),
        routes: dedupe(routes, (entry) => `${entry.method}:${entry.path}`),
        stacks: routes.length > 0
          ? [candidateRecord({
              id_hint: "stack_express_api",
              name: "Express API",
              framework: "express",
              runtime: "node",
              evidence: routes.slice(0, 3).flatMap((route) => route.evidence || []),
              confidence: 0.85
            })]
          : []
      },
      diagnostics: []
    };
  }
};

module.exports = {
  manifest,
  extractors: [expressExtractor]
};

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "app",
  "dist",
  "build",
  "coverage",
  ".tmp",
  ".topogram"
]);

function rootDir(context) {
  return path.resolve(context?.paths?.inputRoot || context?.paths?.workspaceRoot || process.cwd());
}

function repoRoot(context) {
  return path.resolve(context?.paths?.repoRoot || rootDir(context));
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readJson(filePath) {
  const text = readText(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function listFilesRecursive(dirPath, predicate, result = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) listFilesRecursive(absolutePath, predicate, result);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!predicate || predicate(absolutePath)) result.push(absolutePath);
  }
  return result;
}

function findPrimaryFiles(context, predicate) {
  return listFilesRecursive(rootDir(context), (filePath) => {
    if (!isPrimarySource(context, filePath)) return false;
    return predicate(filePath);
  }).sort();
}

function isPrimarySource(context, filePath) {
  const relativePath = normalizeRelative(rootDir(context), filePath);
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.some((segment) => IGNORED_DIRS.has(segment))) return false;
  if (segments.includes("__fixtures__") || segments.includes("__tests__") || segments.includes("fixtures") || segments.includes("tests")) return false;
  if (segments[0] === "docs" || segments[0] === "examples") return false;
  if (segments.some((segment) => /^(fixtures?|test-fixtures|snapshots?|generated)$/i.test(segment))) return false;
  return true;
}

function isJavaScriptLike(filePath) {
  return /\.(cjs|mjs|js|jsx|ts|tsx)$/.test(filePath);
}

function parseApiRoutesMap(text) {
  const entries = [];
  const objectMatch = text.match(/\bAPI_ROUTES\s*=\s*\{([\s\S]*?)\}\s*;?/);
  if (!objectMatch) return entries;
  for (const entryMatch of objectMatch[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*["'`]([^"'`]+)["'`]/g)) {
    entries.push([`API_ROUTES.${entryMatch[1]}`, entryMatch[2]]);
  }
  return entries;
}

function parsePermissionsMetadata(text, routeConstantMap) {
  const entries = [];
  for (const match of text.matchAll(/permissions\.set\(\s*([^,]+?)\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
    const keyExpr = match[1].trim();
    const valueText = match[2];
    const routePath = resolveRouteExpression(keyExpr, routeConstantMap);
    if (!routePath) continue;
    entries.push([routePath, {
      authenticated: /\bauthenticated\s*:\s*true\b/.test(valueText),
      super: /\bsuper\s*:\s*true\b/.test(valueText),
      source: keyExpr
    }]);
  }
  return entries;
}

function parseExpressRoutes(context, filePath, text, routeConstantMap, permissionMetadata) {
  const routes = [];
  const routeRegex = /\b(?:app|router)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*([^,\n]+)\s*,([\s\S]*?)\)\s*;?/g;
  for (const match of text.matchAll(routeRegex)) {
    const method = match[1].toUpperCase();
    const routePath = resolveRouteExpression(match[2].trim(), routeConstantMap);
    if (!routePath) continue;
    const normalizedPath = normalizeOpenApiPath(routePath);
    const handlerContext = match[3] || "";
    const auth = inferRouteAuth(handlerContext, permissionMetadata.get(routePath));
    const queryParams = inferQueryParams(text);
    const params = inferPathParams(normalizedPath);
    const capability = inferRouteCapabilityId(method, normalizedPath);
    routes.push(candidateRecord({
      id_hint: `route_${method.toLowerCase()}_${idHintify(normalizedPath.replace(/[{}]/g, ""))}`,
      method,
      path: normalizedPath,
      sourcePath: normalizeRelative(rootDir(context), filePath),
      capability,
      entity: inferEntityIdFromPath(normalizedPath),
      params,
      query: queryParams,
      auth,
      evidence: [candidateEvidence(context, filePath, `${method} ${normalizedPath}`)],
      confidence: 0.82
    }));
  }
  return routes;
}

function resolveRouteExpression(value, routeConstantMap) {
  const trimmed = String(value || "").trim();
  const literal = trimmed.match(/^["'`]([^"'`]+)["'`]$/);
  if (literal) return literal[1];
  if (routeConstantMap.has(trimmed)) return routeConstantMap.get(trimmed);
  return "";
}

function normalizeOpenApiPath(routePath) {
  return String(routePath || "").replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function inferPathParams(routePath) {
  return [...String(routePath || "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function inferQueryParams(text) {
  const params = new Set();
  for (const match of text.matchAll(/\breq\.query\.([A-Za-z0-9_]+)/g)) params.add(match[1]);
  for (const match of text.matchAll(/\breq\.query\[['"`]([^'"`]+)['"`]\]/g)) params.add(match[1]);
  return [...params].sort();
}

function inferRouteAuth(handlerContext, permission) {
  const middlewareAuth = /\b(requireAuth|requireUser|authenticate|authorize|ensureAuthenticated|isAuthenticated)\b/.test(handlerContext);
  return {
    required: Boolean(permission?.authenticated || middlewareAuth),
    elevated: Boolean(permission?.super),
    source: permission?.source || (middlewareAuth ? "middleware" : "none")
  };
}

function buildCapability(route) {
  return candidateRecord({
    id_hint: route.capability,
    name: titleCase(route.capability.replace(/^cap_/, "").replace(/_/g, " ")),
    method: route.method,
    path: route.path,
    entity: route.entity,
    inputs: [
      ...route.params.map((name) => ({ name, source: "path", required: true })),
      ...route.query.map((name) => ({ name, source: "query", required: false }))
    ],
    auth: route.auth,
    evidence: route.evidence,
    confidence: route.confidence
  });
}

function inferRouteCapabilityId(method, routePath) {
  const segments = routePath.split("/").filter(Boolean).filter((segment) => !segment.startsWith("{"));
  const collection = idHintify(segments[0] || "resource");
  const singular = singularize(collection);
  const hasParam = routePath.includes("{");
  if (method === "GET" && !hasParam) return `cap_list_${collection}`;
  if (method === "GET") return `cap_get_${singular}`;
  if (method === "POST") return `cap_create_${collection}`;
  if (method === "PATCH" || method === "PUT") return `cap_update_${singular}`;
  if (method === "DELETE") return `cap_delete_${singular}`;
  return `cap_${method.toLowerCase()}_${collection}`;
}

function inferEntityIdFromPath(routePath) {
  const firstSegment = routePath.split("/").filter(Boolean).find((segment) => !segment.startsWith("{")) || "resource";
  return `entity_${singularize(idHintify(firstSegment))}`;
}

function singularize(value) {
  if (value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.endsWith("ses")) return value.slice(0, -2);
  if (value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function normalizeRelative(basePath, filePath) {
  return path.relative(basePath, filePath).split(path.sep).join("/");
}

function candidateEvidence(context, filePath, note) {
  return {
    file: normalizeRelative(repoRoot(context), filePath),
    appPath: normalizeRelative(rootDir(context), filePath),
    note
  };
}

function candidateRecord(fields) {
  return {
    source: "package:@topogram/extractor-express-api",
    ...fields
  };
}

function idHintify(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (char) => char.toUpperCase());
}

function dedupe(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
