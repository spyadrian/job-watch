import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

async function follow(page: Page, key: string, name: string) {
  const res = await page.request.post("/api/companies", { data: { source: { type: "greenhouse", key }, name } });
  expect(res.status()).toBe(201);
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const companies = (page: Page) => page.getByRole("region", { name: "Followed Companies" });
const companyRow = (page: Page, name: string) =>
  companies(page).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
const jobRow = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: title });

test("lists followed Companies with their Source type and renames one with Save / Cancel", async ({ page }) => {
  await follow(page, "acme", "Acme");
  await page.goto("/");
  await tab(page, "Companies").click();

  await expect(companyRow(page, "Acme")).toContainText("Greenhouse");

  // Cancel leaves the name unchanged.
  await companyRow(page, "Acme").getByRole("button", { name: "Rename Acme" }).click();
  await companies(page).getByLabel("New name for Acme").fill("Something else");
  await companies(page).getByRole("button", { name: "Cancel" }).click();
  await expect(companyRow(page, "Acme")).toBeVisible();
  await expect(companies(page).getByText("Something else")).toHaveCount(0);
  await expect(companyRow(page, "Acme").getByRole("button", { name: "Rename Acme" })).toBeFocused();

  // Save renames it, and its Jobs show the new name.
  await companyRow(page, "Acme").getByRole("button", { name: "Rename Acme" }).click();
  await companies(page).getByLabel("New name for Acme").fill("Acme Corp");
  await companies(page).getByRole("button", { name: "Save" }).click();
  await expect(companyRow(page, "Acme Corp")).toContainText("Greenhouse");

  await tab(page, "Inbox").click();
  await expect(jobRow(page, "Senior Backend Engineer")).toContainText("Acme Corp");
});

test("refuses to follow a Source again with Already following", async ({ page }) => {
  await follow(page, "acme", "Acme");
  await page.goto("/");
  await tab(page, "Companies").click();
  const form = page.getByRole("region", { name: "Follow a Company" });

  await form.getByLabel("Link", { exact: true }).fill("https://boards.greenhouse.io/acme");
  await form.getByRole("button", { name: "Find jobs" }).click();

  await expect(form).toContainText("Already following Acme");
  await expect(form.getByRole("button", { name: "Follow" })).toHaveCount(0);
});

test("removing a Company deletes its Unseen and Seen Jobs and keeps Saved and Applied ones as Outdated", async ({ page }) => {
  await follow(page, "acme", "Acme");
  await page.goto("/");
  await jobRow(page, "Senior Backend Engineer").getByRole("button", { name: "Save" }).click();
  await expect(tab(page, "Saved")).toHaveAccessibleName("Saved 1");
  await tab(page, "Companies").click();

  await companyRow(page, "Acme").getByRole("button", { name: "Remove Acme" }).click();

  await expect(companyRow(page, "Acme")).toHaveCount(0);
  await expect(companies(page)).toContainText("You don't follow any Company yet.");
  await expect(tab(page, "Inbox")).toHaveAccessibleName("Inbox 0");
  await tab(page, "Saved").click();
  const saved = jobRow(page, "Senior Backend Engineer");
  await expect(saved).toContainText("Acme");
  await expect(saved).toContainText("Outdated");
});
