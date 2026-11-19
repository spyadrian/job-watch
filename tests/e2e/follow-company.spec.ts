import { expect, test } from "./fixtures.ts";

test("follows a Greenhouse Company by link and shows its Jobs in the Inbox", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Companies/ }).click();
  const section = page.getByRole("region", { name: "Follow a Company" });

  // An invalid link gets a clear message.
  await section.getByLabel("Link", { exact: true }).fill("not a link");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByRole("alert")).toContainText("doesn't look like a link");

  // Cancel after "N jobs found" saves nothing.
  await section.getByLabel("Link", { exact: true }).fill("https://job-boards.greenhouse.io/acme/jobs/4012001");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByText("3 jobs found")).toBeVisible();
  await section.getByRole("button", { name: "Cancel" }).click();
  await expect(section.getByText("3 jobs found")).toHaveCount(0);
  const before = await (await page.request.get("/api/jobs")).json();
  expect(before.jobs).toHaveLength(0);

  // Found again, renamed, followed.
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByLabel("Company name")).toHaveValue("Acme Robotics");
  await section.getByLabel("Company name").fill("Acme");
  await section.getByRole("button", { name: "Follow" }).click();
  await expect(section).toContainText("Following Acme: 3 jobs added to your Inbox.");

  await page.getByRole("tab", { name: /Inbox/ }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Senior Backend Engineer" });
  await expect(row).toContainText("Acme");
  await expect(row).toContainText("Zürich, Switzerland");
  await expect(row).toContainText(/just now|\dm ago/);
  const link = row.getByRole("link", { name: /Senior Backend Engineer/ });
  await expect(link).toHaveAttribute("href", "https://job-boards.greenhouse.io/acme/jobs/4012001");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("shows 50 Jobs at a time with Show more", async ({ page }) => {
  const res = await page.request.post("/api/companies", {
    data: { source: { type: "greenhouse", key: "manyroles" }, name: "Many Roles" },
  });
  expect(res.status()).toBe(201);

  await page.goto("/");
  const rows = page.getByRole("listitem").filter({ hasText: "Many Roles" });
  await expect(rows).toHaveCount(50);
  await page.getByRole("button", { name: "Show 5 more" }).click();
  await expect(rows).toHaveCount(55);
  await expect(page.getByRole("button", { name: /Show \d+ more/ })).toHaveCount(0);
});
