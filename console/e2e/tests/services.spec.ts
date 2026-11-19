import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const count = (page: Page) => page.getByTestId("result-count");
const items = (page: Page) => page.locator('li[data-testid^="service-"]');
const select = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const pinButton = (page: Page, name: string) => page.getByRole("button", { name: `Pin ${name}`, exact: true });
const pinnedGroup = (page: Page) => page.getByRole("group", { name: "Pinned" });

async function open(page: Page, query = "") {
  await page.goto(`/__console/services${query}`);
  await expect(count(page)).toBeVisible();
}

/** "Compute (22)" -> 22, read from the option so the test needs no hard-coded numbers. */
async function optionCount(page: Page, label: string, option: string): Promise<number> {
  const text = await select(page, label).locator("option", { hasText: option }).first().innerText();
  return Number(/\((\d+)\)$/.exec(text)![1]);
}

test("all 436 Services are listed, grouped by Category in the pill view, with Coverage as numbers", async ({ page }) => {
  await open(page);
  await expect(count(page)).toHaveText("436 of 436 services");
  await expect(items(page)).toHaveCount(436);
  await expect(page.locator(".cat-group")).toHaveCount(22);
  await expect(page.getByRole("heading", { name: /^Compute \d+$/ })).toBeVisible();
  await expect(page.getByTestId("service-sqs").getByTestId("coverage")).toHaveText(/\d+\/\d+.*\d+ of \d+ implemented · (Fully|Partly|Not) implemented/);
});

test("Services show the design's short names, and a full title on hover", async ({ page }) => {
  await open(page);
  const s3 = page.getByTestId("service-s3").getByRole("link");
  await expect(s3).toHaveText("S3");
  await expect(s3).toHaveAttribute("title", "Amazon Simple Storage Service");
  await expect(page.getByTestId("service-kinesis").getByRole("link")).toHaveText("Kinesis Data Streams");
  await expect(page.getByTestId("service-ses").getByRole("link")).toHaveText("SES");
});

test("search matches the name, the SDK package, the signing name and the id, best match first", async ({ page }) => {
  await open(page);
  const search = page.getByLabel("Search services");
  await search.fill("s3");
  await expect(items(page).first()).toHaveAttribute("data-testid", "service-s3");
  await search.fill("states");
  await expect(page.getByTestId("service-sfn")).toBeVisible();
  await search.fill("route-53");
  await expect(items(page).first()).toHaveAttribute("data-testid", "service-route-53");
  await search.fill("@aws-sdk/client-sqs");
  await expect(page.getByTestId("service-sqs")).toBeVisible();
  await search.fill("zzz-no-such-service");
  await expect(count(page)).toHaveText("0 of 436 services");
  await expect(page.getByText("No Service matches these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters and search" }).click();
  await expect(count(page)).toHaveText("436 of 436 services");
  await expect(search).toHaveValue("");
});

test("the Category, Custom UI and Coverage filters each narrow the list, and options show their counts", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("option", { name: "Custom UI (10)" })).toBeAttached();
  await select(page, "Custom UI").selectOption("custom");
  await expect(count(page)).toHaveText("10 of 436 services");
  await expect(page.getByTestId("service-dynamodb")).toBeVisible();
  await select(page, "Custom UI").selectOption("");

  const compute = await optionCount(page, "Category", "Compute");
  expect(compute).toBeGreaterThan(0);
  await select(page, "Category").selectOption({ label: `Compute (${compute})` });
  await expect(count(page)).toHaveText(`${compute} of 436 services`);
  await select(page, "Category").selectOption("");

  const full = await optionCount(page, "Coverage", "Fully implemented");
  const partial = await optionCount(page, "Coverage", "Partly implemented");
  await select(page, "Coverage").selectOption("full");
  await expect(count(page)).toHaveText(`${full} of 436 services`);
  await select(page, "Coverage").selectOption("partial");
  await expect(count(page)).toHaveText(`${partial} of 436 services`);
  // No Service is at Coverage None at the pinned Emulator source, but the option stays and says so.
  await expect(page.getByRole("option", { name: "Not implemented (0)" })).toBeAttached();
  await select(page, "Coverage").selectOption("none");
  await expect(count(page)).toHaveText("0 of 436 services");
});

test("the Category rail lists every Category with its count and picks one", async ({ page }) => {
  await open(page);
  const rail = page.getByRole("navigation", { name: "Categories" });
  await expect(rail.getByRole("button")).toHaveCount(23);
  await rail.getByRole("button", { name: /^Compute/ }).click();
  await expect(page).toHaveURL(/category=compute/);
  await expect(page.locator(".cat-group")).toHaveCount(1);
});

test("the query and filters live in the URL, so reload and Back restore them", async ({ page }) => {
  await open(page);
  await page.getByLabel("Search services").fill("dynamo");
  await select(page, "Custom UI").selectOption("custom");
  await expect(page).toHaveURL(/q=dynamo/);
  await expect(page).toHaveURL(/tier=custom/);
  await expect(count(page)).toHaveText(/^\d+ of 436 services$/);
  await expect(count(page)).not.toHaveText("436 of 436 services");
  await expect(count(page)).toHaveText(/^[1-9]\d? of 436/);
  const shown = await count(page).innerText();
  await page.reload();
  await expect(count(page)).toHaveText(shown);
  await expect(page.getByLabel("Search services")).toHaveValue("dynamo");
  await expect(select(page, "Custom UI")).toHaveValue("custom");

  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(count(page)).toHaveText("436 of 436 services");
  await expect(page).not.toHaveURL(/q=|tier=/);
  await page.goto("/__console/services?view=card&level=full");
  await expect(page.getByRole("button", { name: "Card view" })).toHaveAttribute("aria-pressed", "true");
  await expect(select(page, "Coverage")).toHaveValue("full");
});

test("the pill and card views both show every Service; cards carry the tier badge, Open and the Coverage bar", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Card view" }).click();
  await expect(page.getByRole("button", { name: "Card view" })).toHaveAttribute("aria-pressed", "true");
  await expect(items(page)).toHaveCount(436);
  const sqs = page.getByTestId("service-sqs");
  await expect(sqs).toContainText("@aws-sdk/client-sqs");
  await expect(sqs).toContainText("Custom UI");
  await expect(sqs.getByRole("link", { name: "Open SQS" })).toBeVisible();
  await expect(sqs.locator("progress")).toBeAttached();
  await expect(sqs.getByTestId("coverage")).toHaveText(/\d+ of \d+ implemented · (Fully|Partly) implemented/);
  await page.getByRole("button", { name: "Pill view" }).click();
  await expect(page.getByTestId("service-sqs")).not.toContainText("@aws-sdk/client-sqs");
});

test("a pinned Service appears in the sidebar, survives a reload, and can be unpinned", async ({ page }) => {
  await open(page);
  await expect(pinnedGroup(page)).toHaveCount(0);
  const pin = pinButton(page, "SQS");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(pin).toBeFocused();
  await expect(pinnedGroup(page).getByRole("link", { name: "SQS" })).toBeVisible();
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith("console:v1:")));
  expect(stored.map(([, v]) => v).join()).toContain("sqs");

  await page.reload();
  await expect(pinnedGroup(page).getByRole("link", { name: "SQS" })).toBeVisible();
  await pinButton(page, "SQS").click();
  await expect(pinnedGroup(page)).toHaveCount(0);
  await page.reload();
  await expect(count(page)).toHaveText("436 of 436 services");
  await expect(pinnedGroup(page)).toHaveCount(0);
});

test("the sidebar stays in view while the page scrolls, and pin targets are at least 32px", async ({ page }) => {
  await open(page);
  await pinButton(page, "SQS").click();
  await page.mouse.wheel(0, 3000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  await expect(pinnedGroup(page).getByRole("link", { name: "SQS" })).toBeInViewport();
  const box = await pinButton(page, "S3").boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(32);
  expect(box!.height).toBeGreaterThanOrEqual(32);
});

test("on a phone the search box is above the fold and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 700 });
  await open(page);
  const box = await page.getByLabel("Search services").boundingBox();
  expect(box!.y + box!.height).toBeLessThan(700);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("Skip to results moves focus to the results", async ({ page }) => {
  await open(page);
  await page.getByRole("link", { name: "Skip to results" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Results" })).toBeFocused();
});

test("pins still work when localStorage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("blocked");
      },
    });
  });
  await open(page);
  await pinButton(page, "SQS").click();
  await expect(pinnedGroup(page)).toBeVisible();
});

test("a Service opens in the API Explorer on its probe Operation", async ({ page }) => {
  await open(page);
  await page.getByTestId("service-sqs").getByRole("link").click();
  await expect(page).toHaveURL(/\/__console\/explorer\?service=sqs&op=ListQueues/);
  await expect(page.getByLabel("Service", { exact: true })).toHaveValue("sqs");
  await expect(page.getByLabel("Operation", { exact: true })).toHaveValue("ListQueues");
});

test("a Service at Coverage None opens straight into the explorer and says it is not implemented yet", async ({ page }) => {
  // No Service is at Coverage None at the pinned Emulator source, so the Catalog index is rewritten for one.
  await page.route("**/catalog/*/index.json", async (route) => {
    const body = await (await route.fetch()).json();
    const sqs = body.entries.find((e: { serviceId: string }) => e.serviceId === "sqs");
    sqs.coverage = { implemented: 0, scaffolded: sqs.coverage.total, unrouted: 0, total: sqs.coverage.total, level: "full" };
    await route.fulfill({ json: body });
  });
  await open(page, "?view=card&level=none");
  await expect(count(page)).toHaveText("1 of 436 services");
  const card = page.getByTestId("service-sqs");
  await expect(card.getByTestId("coverage")).toContainText("0 of");
  await expect(card).toContainText("Not implemented yet");
  await card.getByRole("link", { name: "Open SQS" }).click();
  await expect(page).toHaveURL(/\/__console\/explorer\?service=sqs$/);
});

for (const view of ["Pill view", "Card view"]) {
  test(`All services has no axe violations (${view})`, async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: view }).click();
    await pinButton(page, "SQS").click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
  });
}

test("the empty state has no axe violations", async ({ page }) => {
  await open(page, "?q=zzzzzz");
  await expect(page.getByText("No Service matches these filters.")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
});
