import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startConsole, startEmulator, stopConsole, stopEmulator } from "../stack.ts";

const API = "/__console/api/v1";
const pill = (page: Page) => page.getByTestId("health-pill");

test("the shell shows the Local Connection and a reachable health pill with latency", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/__console\/$/);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByText("Local emulator")).toBeVisible();
  for (const name of ["Home", "All services", "Request inspector", "Connections"]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await expect(pill(page)).toHaveText(/Emulator healthy · \d+ ms/);
  // The live region announces the words only; the latency sits in a silent sibling.
  await expect(page.getByRole("status")).toHaveText("Emulator healthy");
});

test("the shell has no axe violations while healthy", async ({ page }) => {
  await page.goto("/__console/");
  await expect(pill(page)).toHaveText(/Emulator healthy/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
});

test("an unknown client route shows a not-found page inside the shell", async ({ page }) => {
  await page.goto("/__console/nope");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

test("every response carries the security headers", async ({ request }) => {
  for (const url of ["/__console/", `${API}/meta`]) {
    const headers = (await request.get(url)).headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
  }
});

test("at phone width the sidebar stacks above the content and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto("/__console/");
  await expect(pill(page)).toHaveText(/Emulator healthy/);
  const sidebar = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
  const main = await page.getByRole("main").boundingBox();
  expect(sidebar!.y + sidebar!.height).toBeLessThanOrEqual(main!.y + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the pill turns unreachable within seconds of stopping the Emulator and recovers on restart", async ({ page }) => {
  await page.goto("/__console/");
  await expect(pill(page)).toHaveText(/Emulator healthy/);
  try {
    stopEmulator();
    await expect(pill(page)).toHaveText(/Emulator unreachable/, { timeout: 10_000 });
  } finally {
    startEmulator();
  }
  await expect(pill(page)).toHaveText(/Emulator healthy · \d+ ms/, { timeout: 45_000 });
});

test("the pill says the Gateway is unreachable while the console container is stopped", async ({ page }) => {
  await page.goto("/__console/");
  await expect(pill(page)).toHaveText(/Emulator healthy/);
  try {
    stopConsole();
    await expect(pill(page)).toHaveText(/Gateway unreachable/, { timeout: 20_000 });
  } finally {
    startConsole();
  }
  await expect(pill(page)).toHaveText(/Emulator healthy · \d+ ms/, { timeout: 45_000 });
});

test("the Gateway refuses cross-site and foreign-origin requests with 403", async ({ request }) => {
  const same = await request.get(`${API}/meta`);
  expect(same.status()).toBe(200);

  const crossSite = await request.get(`${API}/meta`, { headers: { "Sec-Fetch-Site": "cross-site" } });
  expect(crossSite.status()).toBe(403);
  const foreignOrigin = await request.get(`${API}/connections`, { headers: { Origin: "http://evil.example" } });
  expect(foreignOrigin.status()).toBe(403);
  const admin = await request.get("/__admin/health", { headers: { "Sec-Fetch-Site": "same-site" } });
  expect(admin.status()).toBe(403);
  const rebinding = await request.get(`${API}/meta`, { headers: { Host: "evil.example:19300" } });
  expect(rebinding.status()).toBe(403);
});

test("the API never exposes credentials", async ({ request }) => {
  const res = await request.get(`${API}/connections`);
  expect(await res.text()).not.toMatch(/secret|EMULATOR[0-9A-F]{6,}/i);
});

test("a malformed URL answers 404, not 500", async ({ request }) => {
  expect((await request.get("/__console/%zz")).status()).toBe(404);
  expect((await request.get(API)).status()).toBe(404);
});
