import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";

// Pure packages run in the browser, the Gateway and the compiler. They import nothing from
// the browser, React or Node (ADR-0011, ARCHITECTURE section 8).
const PURE_PACKAGES = ["packages/model/**/*.ts"];

const nodeModules = builtinModules.flatMap((m) => [m, `node:${m}`]);

const forbiddenImports = [
  { group: ["react", "react-dom", "react/*", "react-dom/*"], message: "Pure packages cannot import React." },
  {
    group: ["@console/catalog-compiler", "@console/invoker", "@console/ui", "@console/gateway", "@console/web"],
    message: "Pure packages cannot import impure workspace packages.",
  },
  { group: ["node:*"], message: "Pure packages cannot import Node APIs." },
  { group: nodeModules, message: "Pure packages cannot import Node APIs." },
];

const forbiddenGlobals = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "fetch",
  "process",
  "Buffer",
  "__dirname",
  "__filename",
  "require",
].map((name) => ({ name, message: "Pure packages cannot use browser or Node globals." }));

export default tseslint.config(
  { ignores: ["node_modules/**", ".refs/**", "dist/**"] },
  ...tseslint.configs.recommended,
  {
    files: PURE_PACKAGES,
    rules: {
      "no-restricted-imports": ["error", { patterns: forbiddenImports }],
      "no-restricted-globals": ["error", ...forbiddenGlobals],
    },
  },
);
