import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "off" }); // the page loads Emulator Credentials; a trace would store them

const result = (page: Page) => page.getByRole("region", { name: "Response" });

test("SQS SendMessage is filled in through the form and succeeds; validation shows before Send", async ({ page }) => {
  const queue = `form-${Date.now()}`;
  await page.goto("/__console/explorer?service=sqs&op=CreateQueue");
  await page.getByLabel("QueueName", { exact: true }).fill(queue);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(result(page).getByTestId("result-kind")).toHaveText("ok");
  const url = ((await result(page).getByTestId("result-body").textContent()) ?? "").match(/"QueueUrl": "([^"]+)"/)![1]!;

  await page.getByLabel("Operation", { exact: true }).selectOption("SendMessage");
  // Required fields come first; the rest are folded.
  const body = page.getByLabel("MessageBody", { exact: true });
  await expect(body).toBeVisible();
  await expect(page.getByLabel("DelaySeconds", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /more optional fields/ }).click();

  // @range shows as soon as it is broken (DelaySeconds is 0 to 900); required shows when Send is pressed.
  await page.getByLabel("DelaySeconds", { exact: true }).fill("901");
  await expect(page.getByRole("alert").filter({ hasText: /DelaySeconds must be between 0 and 900/ })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /Fix \d+ problems? before sending/ })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "QueueUrl is required" })).toBeVisible();

  await page.getByLabel("DelaySeconds", { exact: true }).fill("0");
  await page.getByLabel("QueueUrl", { exact: true }).fill(url);
  await body.fill("hello from the form");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(result(page).getByTestId("result-kind")).toHaveText("ok");
  await expect(result(page).getByTestId("result-body")).toContainText("MessageId");

  // A JSON tab edit reflects in the form.
  await page.getByRole("tab", { name: "JSON" }).click();
  const json = page.getByLabel("Input (JSON)");
  await expect(json).toHaveValue(/hello from the form/);
  await json.fill(JSON.stringify({ QueueUrl: url, MessageBody: "edited in json" }));
  await page.getByRole("tab", { name: "Form" }).click();
  await expect(page.getByLabel("MessageBody", { exact: true })).toHaveValue("edited in json");
});
