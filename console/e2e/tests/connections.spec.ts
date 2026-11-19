import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { startConsole, startEmulator, stopConsole, stopEmulator } from "../stack.ts";

const API = "/__console/api/v1";
const HEADERS = { "X-Console": "1" };
const IDS = ["reachable", "tls", "credentials", "s3-path-style", "same-origin"];

// These specs fetch the Emulator Credentials to prove they never appear on the page, so a Playwright trace would
// store them. The trace is off here; the keys are also throwaway (the e2e Emulator home is removed with the stack).
test.use({ trace: "off" });

const check = (page: Page, id: string) => page.getByTestId(`check-${id}`);

async function secretKey(page: Page): Promise<string> {
  const res = await page.request.get(`${API}/connections/local/credentials`, { headers: HEADERS });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { secretAccessKey: string }).secretAccessKey;
}

test("every check passes against the e2e Emulator, with detail", async ({ page }) => {
  await page.goto("/__console/connections");
  for (const id of IDS) await expect(check(page, id)).toHaveAttribute("data-ok", "true");
  await expect(check(page, "reachable")).toContainText(/answered in \d+ ms/);
  await expect(check(page, "credentials")).toContainText("account 000000000000");
  await expect(check(page, "s3-path-style")).toContainText(/ListBuckets/);
  await expect(page.getByRole("heading", { name: "Local emulator" })).toBeVisible();
});

test("the checks endpoint needs X-Console and returns no credentials", async ({ page }) => {
  const secret = await secretKey(page);
  expect((await page.request.post(`${API}/connections/local/checks`)).status()).toBe(403);
  const res = await page.request.post(`${API}/connections/local/checks`, { headers: HEADERS });
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text.includes(secret), "the checks response holds the secret key").toBe(false);
  expect((JSON.parse(text) as { checks: { id: string; ok: boolean }[] }).checks.map((c) => c.id)).toEqual(IDS);
});

test("the secret key never appears on the page, in the snippet or in the checks", async ({ page }) => {
  const secret = await secretKey(page);
  await page.goto("/__console/connections");
  for (const id of IDS) await expect(check(page, id)).toHaveAttribute("data-ok", "true");
  expect((await page.content()).includes(secret), "the page HTML holds the secret key").toBe(false);
  expect((await page.locator("body").innerText()).includes(secret), "the page text holds the secret key").toBe(false);
  const snippet = page.getByTestId("client-snippet");
  await expect(snippet).toContainText("https://127.0.0.1:9297");
  await expect(snippet).toContainText("NODE_EXTRA_CA_CERTS=$HOME/.aws/emulator/9297/ca.pem");
  await expect(snippet).toContainText("emulator_credentials");
  const values = await page.locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join(" "));
  expect(values.includes(secret), "an input holds the secret key").toBe(false);
});

test("create, edit and delete of Connections answer 405", async ({ page }) => {
  for (const [method, url] of [
    ["POST", `${API}/connections`],
    ["PUT", `${API}/connections/local`],
    ["DELETE", `${API}/connections/local`],
  ] as const) {
    const res = await page.request.fetch(url, { method, headers: HEADERS, data: {} });
    expect(res.status(), `${method} ${url}`).toBe(405);
  }
});

test("behaviour settings are validated, saved, and persist across a console restart", async ({ page }) => {
  await page.goto("/__console/connections");
  const attempts = page.getByLabel("Max attempts");
  const timeout = page.getByLabel("Request timeout (seconds)");
  await expect(attempts).toHaveValue("1");
  await expect(page.getByText("Retries can resend writes such as SendMessage.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.getByText("Change a value to save.")).toBeVisible();

  await attempts.fill("11");
  await expect(page.getByRole("alert")).toContainText(/Max attempts/);
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await attempts.fill("5");
  await timeout.fill("45");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await expect(page.getByTestId("client-snippet")).toContainText("maxAttempts: 5");
  await expect(page.getByTestId("client-snippet")).toContainText("requestTimeout: 45000");

  // The Gateway refuses what the form would not send.
  const bad = await page.request.put(`${API}/connections/local/behaviour`, { headers: HEADERS, data: { maxAttempts: 99, timeoutMs: 1 } });
  expect(bad.status()).toBe(400);

  try {
    stopConsole();
    startConsole();
    await expect(async () => {
      await page.goto("/__console/connections");
      await expect(page.getByLabel("Max attempts")).toHaveValue("5", { timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByLabel("Request timeout (seconds)")).toHaveValue("45");
  } finally {
    // Put the defaults back so the other specs see them.
    await page.request.put(`${API}/connections/local/behaviour`, { headers: HEADERS, data: { maxAttempts: 1, timeoutMs: 30_000 } });
  }
});

test("stopping the Emulator turns the Emulator checks to fail with detail, and starting it recovers", async ({ page }) => {
  await page.goto("/__console/connections");
  for (const id of IDS) await expect(check(page, id)).toHaveAttribute("data-ok", "true");
  try {
    stopEmulator();
    await expect(async () => {
      await page.getByRole("button", { name: "Run again" }).click();
      await expect(check(page, "reachable")).toHaveAttribute("data-ok", "false", { timeout: 4_000 });
    }).toPass({ timeout: 40_000 });
    for (const id of ["reachable", "tls", "credentials", "s3-path-style"]) {
      await expect(check(page, id)).toHaveAttribute("data-ok", "false");
      await expect(check(page, id).locator(".check-detail")).not.toBeEmpty();
    }
    await expect(check(page, "same-origin")).toHaveAttribute("data-ok", "true");
  } finally {
    startEmulator();
  }
  await expect(async () => {
    await page.getByRole("button", { name: "Run again" }).click();
    for (const id of IDS) await expect(check(page, id)).toHaveAttribute("data-ok", "true", { timeout: 4_000 });
  }).toPass({ timeout: 90_000 });
});

test("the Connections page has no axe violations", async ({ page }) => {
  await page.goto("/__console/connections");
  for (const id of IDS) await expect(check(page, id)).toHaveAttribute("data-ok", "true");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
});
