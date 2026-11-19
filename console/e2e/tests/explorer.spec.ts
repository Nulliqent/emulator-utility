import { expect, test, type Page } from "@playwright/test";

const API = "/__console/api/v1";
const ORIGIN = "http://127.0.0.1:19300";

// These specs load the Emulator Credentials in the page (the credentials endpoint answers the SDK client), so a
// Playwright trace would store them. The trace is off here; the keys are also throwaway (the e2e Emulator home is a
// volume that is removed with the stack).
test.use({ trace: "off" });

async function send(page: Page, service: string, op: string, input: object) {
  await page.getByLabel("Service", { exact: true }).selectOption(service);
  await page.getByLabel("Operation", { exact: true }).selectOption(op);
  await expect(page).toHaveURL(new RegExp(`op=${op}`));
  const field = page.getByLabel("Input (JSON)");
  // Picking an Operation pre-fills its required members and shows the form; wait for that, switch to the JSON tab
  // and replace the text with this test's input.
  await expect(async () => {
    await page.getByRole("tab", { name: "JSON" }).click();
    await field.fill(JSON.stringify(input));
    await expect(field).toHaveValue(JSON.stringify(input));
  }).toPass();
  await page.getByRole("button", { name: "Send" }).click();
}

const result = (page: Page) => page.getByRole("region", { name: "Response" });

test("SQS CreateQueue then ListQueues through the API Explorer shows the new queue", async ({ page }) => {
  const name = `e2e-${Date.now()}`;
  await page.goto("/__console/explorer");
  await send(page, "sqs", "CreateQueue", { QueueName: name });
  await expect(result(page).getByTestId("result-kind")).toHaveText("ok");
  await expect(result(page)).toContainText(/Status 200/);
  await expect(result(page)).toContainText(/\d+ ms/);
  await expect(result(page)).toContainText(name);

  await send(page, "sqs", "ListQueues", {});
  await expect(result(page).getByTestId("result-kind")).toHaveText("ok");
  await expect(result(page).getByTestId("result-body")).toContainText(name);
});

test("a service error is classified, and invalid JSON is refused before sending", async ({ page }) => {
  await page.goto("/__console/explorer");
  await send(page, "sqs", "GetQueueUrl", { QueueName: `missing-${Date.now()}` });
  await expect(result(page).getByTestId("result-kind")).toHaveText("service-error");

  await page.getByLabel("Input (JSON)").fill("{ nope");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert")).toContainText(/JSON/);
});

test("a scaffolded Operation is classified not-implemented", async ({ page }) => {
  // Find one from the Catalog itself: a Scaffolded Operation with no required input (so a validation error cannot come first).
  const meta = (await (await page.request.get(`${API}/meta`)).json()) as { catalog: { fingerprint: string } };
  const base = `/__console/catalog/${meta.catalog.fingerprint}`;
  const index = (await (await page.request.get(`${base}/index.json`)).json()) as {
    entries: { serviceId: string; coverage: { scaffolded: number }; files: { ui: string } }[];
  };
  type Ui = {
    operations: Record<string, { name: string; status: string; input?: string }>;
    shapes: Record<string, { kind: string; members?: Record<string, { required: boolean }> }>;
  };
  let found: { serviceId: string; op: string; input?: object } | undefined;
  // Pinned first: S3 CreateBucketMetadataTableConfiguration is scaffolded at the pinned Emulator commit.
  const s3 = index.entries.find((x) => x.serviceId === "s3");
  if (s3) {
    const ui = (await (await page.request.get(`${base}/${s3.files.ui}`)).json()) as Ui;
    if (ui.operations["CreateBucketMetadataTableConfiguration"]?.status === "scaffolded") {
      found = {
        serviceId: "s3",
        op: "CreateBucketMetadataTableConfiguration",
        input: {
          Bucket: `nope-${Date.now()}`,
          MetadataTableConfiguration: { S3TablesDestination: { TableBucketArn: "arn:aws:s3tables:us-east-1:000000000000:bucket/x", TableName: "t" } },
        },
      };
    }
  }
  for (const e of found ? [] : index.entries.filter((x) => x.coverage.scaffolded > 0).slice(0, 40)) {
    const ui = (await (await page.request.get(`${base}/${e.files.ui}`)).json()) as Ui;
    const op = Object.values(ui.operations).find(
      (o) => o.status === "scaffolded" && (!o.input || !Object.values(ui.shapes[o.input]?.members ?? {}).some((m) => m.required)),
    );
    if (op) {
      found = { serviceId: e.serviceId, op: op.name };
      break;
    }
  }
  test.skip(!found, "no scaffolded Operation without required input in the first 40 Services");
  await page.goto("/__console/explorer");
  await send(page, found!.serviceId, found!.op, found!.input ?? {});
  await expect(page.getByRole("note")).toContainText("answers 501 in the emulator source");
  await expect(
    result(page).getByTestId("result-kind"),
    `${found!.serviceId}.${found!.op}`,
  ).toHaveText("not-implemented");
});

test("S3 CreateBucket then ListBuckets shows the bucket, with path-style requests (GET / is not redirected)", async ({ page }) => {
  const bucket = `e2e-bucket-${Date.now()}`;
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.headers()["x-console"]) urls.push(`${r.method()} ${new URL(r.url()).host}${new URL(r.url()).pathname}`);
  });
  await page.goto("/__console/explorer");
  await send(page, "s3", "CreateBucket", { Bucket: bucket });
  await expect(result(page).getByTestId("result-kind")).toHaveText("ok");
  await send(page, "s3", "ListBuckets", {});
  await expect(result(page).getByTestId("result-kind")).toHaveText("ok");
  await expect(result(page).getByTestId("result-body")).toContainText(bucket);
  // Path style: the bucket is in the path and the host is the Gateway's, never `<bucket>.127.0.0.1`.
  expect(urls).toContain(`PUT 127.0.0.1:19300/${bucket}/`);
  expect(urls.some((u) => u.includes(`${bucket}.`))).toBe(false);
  expect(urls).toContain("GET 127.0.0.1:19300/");
});

test("an Operation can be opened by a deep link, which is also written as the URL changes", async ({ page }) => {
  await page.goto("/__console/explorer?service=sqs&op=CreateQueue");
  await expect(page.getByLabel("Service", { exact: true })).toHaveValue("sqs");
  await expect(page.getByLabel("Operation", { exact: true })).toHaveValue("CreateQueue");
  // The required member is pre-filled as a placeholder.
  await expect(page.getByLabel("QueueName", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(page.getByLabel("Input (JSON)")).toHaveValue(/"QueueName": ""/);
  await page.getByLabel("Operation", { exact: true }).selectOption("ListQueues");
  await expect(page).toHaveURL(/service=sqs&op=ListQueues|op=ListQueues&service=sqs/);
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(page.getByLabel("Input (JSON)")).toHaveValue("{}");
});

test("a deep link to an unknown Operation, even `constructor`, says so and disables Send", async ({ page }) => {
  await page.goto("/__console/explorer?service=sqs&op=constructor");
  await expect(page.getByRole("alert").filter({ hasText: "No Operation constructor in this Service." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("the service filter matches the title, id, SDK id and category, and says when nothing matches", async ({ page }) => {
  await page.goto("/__console/explorer");
  const service = page.getByLabel("Service", { exact: true });
  await expect(service.locator("option")).not.toHaveCount(2); // the full list, not filtered yet
  await page.getByLabel("Filter services").fill("Application integration"); // a category name
  await expect(service.locator("option", { hasText: "(sqs)" })).toHaveCount(1);
  await page.getByLabel("Filter services").fill("zzz-nothing-matches");
  await expect(page.getByText('No services match "zzz-nothing-matches".')).toBeVisible();
});

test("picking a Service moves focus to the Operation picker; Send says why it is disabled", async ({ page }) => {
  await page.goto("/__console/explorer");
  await expect(page.getByText("Choose a Service first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await page.getByLabel("Service", { exact: true }).selectOption("sqs");
  await expect(page.getByLabel("Operation", { exact: true })).toBeFocused();
  await expect(page.getByText("Choose an Operation first.")).toBeVisible();
});

test("at phone width the explorer does not scroll sideways and the inputs fit their card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/__console/explorer?service=sqs&op=CreateQueue");
  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(page.getByLabel("Input (JSON)")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const card = (await page.getByRole("region", { name: "Request" }).boundingBox())!;
  for (const label of ["Filter services", "Service", "Operation", "Input (JSON)"]) {
    const box = (await page.getByLabel(label, { exact: true }).boundingBox())!;
    expect(box.x + box.width, label).toBeLessThanOrEqual(card.x + card.width + 1);
  }
});

test("a call that fails client-side validation is `input`; a missing queue is a service error; the response can be copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/__console/explorer?service=sqs&op=GetQueueUrl");
  await send(page, "sqs", "GetQueueUrl", {});
  // The form validates the model's required members before anything is sent.
  await expect(page.getByRole("alert").filter({ hasText: "QueueName is required" })).toBeVisible();
  await expect(result(page)).toHaveCount(0);
  await send(page, "sqs", "GetQueueUrl", { QueueName: `missing-${Date.now()}` });
  await expect(result(page).getByTestId("result-kind")).toHaveText("service-error");
  await expect(result(page)).toContainText(/\d+ bytes/);
  await result(page).getByRole("button", { name: "Copy" }).click();
  await expect(result(page).getByRole("button", { name: "Copied" })).toBeVisible();
});

test("a browser navigation to an unknown root path is a plain 404; other callers are told about X-Console", async ({ request }) => {
  const nav = await request.get("/favicon.ico", { headers: { "Sec-Fetch-Mode": "navigate" } });
  expect(nav.status()).toBe(404);
  expect((await request.get("/favicon.ico")).status()).toBe(403);
});

test("the Gateway marks its own failures so the Invoker can tell them from the Emulator's", async ({ request }) => {
  const res = await request.get("/", { headers: {} });
  expect(res.status()).toBe(200); // follows the redirect to the SPA: a navigation-style GET /
  const refused = await request.get("/nope", { headers: { "Sec-Fetch-Site": "cross-site" } });
  expect(refused.status()).toBe(403);
  expect(refused.headers()["x-console-error"]).toBe("forbidden-origin");
});

test("the pass-through refuses a request without X-Console, and cross-site ones", async ({ request }) => {
  const url = "/";
  const body = { headers: { "Content-Type": "application/x-amz-json-1.0", "X-Amz-Target": "AmazonSQS.ListQueues" }, data: "{}" };
  const noHeader = await request.post(url, body);
  expect(noHeader.status()).toBe(403);
  expect((await noHeader.json()).error.code).toBe("console-header-required");

  const crossSite = await request.post(url, { ...body, headers: { ...body.headers, "X-Console": "1", "Sec-Fetch-Site": "cross-site" } });
  expect(crossSite.status()).toBe(403);
  const foreign = await request.post(url, { ...body, headers: { ...body.headers, "X-Console": "1", Origin: "http://evil.example" } });
  expect(foreign.status()).toBe(403);
  const rebinding = await request.post(url, { ...body, headers: { ...body.headers, "X-Console": "1", Host: "evil.example:19300" } });
  expect(rebinding.status()).toBe(403);
});

test("the credentials endpoint needs X-Console and is not readable cross-site", async ({ request }) => {
  const url = `${API}/connections/local/credentials`;
  expect((await request.get(url)).status()).toBe(403);
  expect((await request.get(url, { headers: { "X-Console": "1", "Sec-Fetch-Site": "cross-site" } })).status()).toBe(403);
  expect((await request.get(url, { headers: { "X-Console": "1", Origin: "http://evil.example" } })).status()).toBe(403);

  const ok = await request.get(url, { headers: { "X-Console": "1" } });
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toContain("no-store");
  expect(Object.keys(await ok.json()).sort()).toEqual(expect.arrayContaining(["accessKeyId", "epoch", "secretAccessKey"]));
});

test("a page on another site cannot read the credentials or call the proxy from the browser", async ({ page }) => {
  await page.route("http://evil.example/", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>evil</title>" }));
  await page.goto("http://evil.example/");
  const outcome = await page.evaluate(async (origin) => {
    const tries: Record<string, string> = {};
    const attempt = async (name: string, url: string, init: RequestInit) => {
      try {
        const r = await fetch(url, init);
        tries[name] = `answered ${r.status}`;
      } catch {
        tries[name] = "blocked";
      }
    };
    await attempt("credentials with header", `${origin}/__console/api/v1/connections/local/credentials`, { headers: { "X-Console": "1" } });
    await attempt("credentials plain", `${origin}/__console/api/v1/connections/local/credentials`, { mode: "no-cors" });
    await attempt("proxy with header", `${origin}/`, { method: "POST", headers: { "X-Console": "1", "Content-Type": "application/x-amz-json-1.0" }, body: "{}" });
    return tries;
  }, ORIGIN);
  // The custom header forces a preflight that the Gateway refuses; a simple no-cors request is opaque and carries no header.
  expect(outcome["credentials with header"]).toBe("blocked");
  expect(outcome["proxy with header"]).toBe("blocked");
  expect(outcome["credentials plain"]).not.toMatch(/answered 200/); // opaque responses read as status 0 at most
});

test("catalog files are served immutable under the current fingerprint only", async ({ request }) => {
  const meta = (await (await request.get(`${API}/meta`)).json()) as { catalog: { fingerprint: string } };
  const ok = await request.get(`/__console/catalog/${meta.catalog.fingerprint}/index.json`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["cache-control"]).toContain("immutable");
  expect((await request.get(`/__console/catalog/${"0".repeat(64)}/index.json`)).status()).toBe(404);
  expect((await request.get(`/__console/catalog/${meta.catalog.fingerprint}/..%2Fmanifest.json`)).status()).toBe(404);
  expect((await request.get(`/__console/catalog/${meta.catalog.fingerprint}/not-a-file.json`)).status()).toBe(404);
});
