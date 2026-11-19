import { builtinModules } from "node:module";
import path from "node:path";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tseslint from "typescript-eslint";

// Boundary rules (ADR-0011, ARCHITECTURE section 8). Dependencies flow one way:
//   model, api-contract: pure (no browser, React or Node)
//   ui: React only; web: React and the packages; gateway: Node and the packages.
const nodeModules = builtinModules.flatMap((m) => [m, `node:${m}`]);

const IMPURE = ["@console/catalog-compiler", "@console/invoker", "@console/ui", "@console/gateway", "@console/web"];
const noReact = { group: ["react", "react-dom", "react/*", "react-dom/*", "@tanstack/*"], message: "This package cannot import React." };
const noNode = [
  { group: ["node:*"], message: "This package cannot import Node APIs." },
  { group: nodeModules, message: "This package cannot import Node APIs." },
];
const noApps = { group: ["@console/gateway", "@console/web", "@console/e2e"], message: "Packages cannot import apps." };

const browserGlobals = ["window", "document", "navigator", "localStorage", "sessionStorage", "fetch"];
const nodeGlobals = ["process", "Buffer", "__dirname", "__filename", "require"];
const restrict = (names, message) => names.map((name) => ({ name, message }));

const webPatterns = [...noNode, { group: ["@console/gateway", "@console/e2e", "@console/catalog-compiler"], message: "The web app cannot import the Gateway, the compiler or e2e." }];

const files = {
  pure: ["packages/model/**/*.ts", "packages/api-contract/**/*.ts"],
  ui: ["packages/ui/**/*.{ts,tsx}"],
  web: ["apps/web/**/*.{ts,tsx}"],
  gateway: ["apps/gateway/**/*.ts"],
};

// A relative import must stay inside its own package or app (apps/<x>, packages/<x>, e2e).
const rootOf = (file) => /(?:^|\/)((?:apps|packages)\/[^/]+|e2e)(?:\/|$)/.exec(file.split("console/").pop() ?? file)?.[1];
const localPlugin = {
  rules: {
    "no-cross-root-relative-import": {
      meta: { type: "problem", schema: [], messages: { cross: "Relative import crosses from {{from}} into {{to}}; import the package by name." } },
      create(context) {
        const file = context.filename.replaceAll("\\", "/");
        const here = rootOf(file);
        return {
          ImportDeclaration(node) {
            const spec = node.source.value;
            if (typeof spec !== "string" || !spec.startsWith(".")) return;
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
            const there = rootOf(target);
            if (here && there && here !== there) context.report({ node, messageId: "cross", data: { from: here, to: there } });
          },
        };
      },
    },
  },
};

export default tseslint.config(
  { plugins: { local: localPlugin }, files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "e2e/**/*.ts"], rules: { "local/no-cross-root-relative-import": "error" } },
  { ignores: ["node_modules/**", "**/node_modules/**", ".refs/**", "dist/**", "**/dist/**", "e2e/test-results/**", "e2e/playwright-report/**"] },
  ...tseslint.configs.recommended,
  {
    files: files.pure,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [noReact, ...noNode, { group: IMPURE, message: "Pure packages cannot import impure workspace packages." }] },
      ],
      "no-restricted-globals": ["error", ...restrict([...browserGlobals, ...nodeGlobals], "Pure packages cannot use browser or Node globals.")],
    },
  },
  {
    files: files.ui,
    rules: {
      "no-restricted-imports": ["error", { patterns: [...noNode, noApps, { group: ["@tanstack/*"], message: "ui is router-agnostic." }] }],
      "no-restricted-globals": ["error", ...restrict(nodeGlobals, "ui runs in the browser only.")],
    },
  },
  {
    files: files.web,
    rules: {
      "no-restricted-imports": ["error", { patterns: webPatterns }],
      "no-restricted-globals": ["error", ...restrict(nodeGlobals, "The web app runs in the browser.")],
    },
  },
  // Features are independent screens: shared code lives in apps/web/src/catalog, preferences.ts or a package, never in a sibling feature.
  ...["explorer", "catalog"].map((feature) => ({
    files: [`apps/web/src/features/${feature}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...webPatterns,
            ...["explorer", "catalog"]
              .filter((other) => other !== feature)
              .map((other) => ({ group: [`**/features/${other}`, `**/features/${other}/**`, `../${other}`, `../${other}/**`], message: `The ${feature} feature cannot import the ${other} feature; move shared code to apps/web/src/catalog.` })),
          ],
        },
      ],
    },
  })),
  {
    files: files.gateway,
    rules: {
      "no-restricted-imports": ["error", { patterns: [noReact, { group: ["@console/web", "@console/ui", "@console/e2e", "@console/catalog-compiler"], message: "The Gateway cannot import the web app, ui or the compiler." }] }],
      "no-restricted-globals": ["error", ...restrict(["window", "document", "localStorage", "sessionStorage"], "The Gateway runs on Node.")],
    },
  },
  {
    files: ["apps/web/**/*.tsx", "packages/ui/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
);
