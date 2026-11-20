import type { Page } from "@playwright/test";
import type { Job } from "../../src/shared/types.ts";
import { expect, test } from "./fixtures.ts";

async function followAcme(page: Page) {
  const res = await page.request.post("/api/companies", {
    data: { source: { type: "greenhouse", key: "acme" }, name: "Acme" },
  });
  expect(res.status()).toBe(201);
}

const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const titles = (page: Page) => page.locator(".job-list .job-title");
const expectTitles = (page: Page, list: string[]) => expect(titles(page)).toHaveText(list.map((t) => new RegExp(`^${t}`)));

test("edits the Filter in a collapsible panel; it is saved, applied to the Inbox only and highlighted", async ({
  page,
}) => {
  await followAcme(page);
  await page.goto("/");
  await expect(titles(page)).toHaveCount(3);

  const panel = page.getByRole("region", { name: "Filter" });
  const toggle = panel.getByRole("button", { name: /^Filter/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // A City filter with several spellings shows as one; Jobs with no location or a remote one stay.
  await panel.getByLabel("New City filter").fill("Bern / Berne");
  await panel.getByLabel("New City filter").press("Enter");
  await expect(panel.getByRole("list", { name: "City filters" }).getByRole("listitem")).toHaveText([/^Bern \/ Berne/]);
  await expectTitles(page, ["Product Designer", "Office Manager"]);

  await panel.getByLabel("New Excluded keyword").fill("manager");
  await panel.getByLabel("New Excluded keyword").press("Enter");
  await panel.getByLabel("New Required keyword").fill("designer");
  await panel.getByLabel("New Required keyword").press("Enter");
  await expectTitles(page, ["Product Designer"]);
  await expect(tab(page, "Inbox")).toHaveAccessibleName("Inbox 1");
  await expect(page.locator("mark.hl-required")).toHaveText("Designer");

  // Saved through the API: still applied after a reload.
  await page.reload();
  await expectTitles(page, ["Product Designer"]);

  // Other lists ignore the Filter but keep the highlights.
  await page.request.post(`/api/jobs/${await jobId(page, "Office Manager")}/status`, { data: { action: "save" } });
  await page.request.post(`/api/jobs/${await jobId(page, "Product Designer")}/status`, { data: { action: "save" } });
  await page.reload();
  await tab(page, "Saved").click();
  await expect(titles(page)).toHaveCount(2);
  await expect(page.locator("mark.hl-required")).toHaveText("Designer");

  // Removing a City filter brings its Jobs back.
  await tab(page, "Inbox").click();
  await page.getByRole("button", { name: "Remove City filter Bern / Berne" }).click();
  await expectTitles(page, []);
  await page.getByRole("button", { name: "Remove Required keyword designer" }).click();
  await expectTitles(page, ["Senior Backend Engineer"]);
});

test("the collapsed Filter summary counts City filters and keywords in plain English", async ({ page }) => {
  const summary = page.getByRole("region", { name: "Filter" }).locator(".filter-summary");
  const put = (filter: object) =>
    page.request.put("/api/filter", { data: { includeRemote: true, ...filter } });

  await put({ cities: [["Bern"]], required: ["designer"], boosted: ["senior"], excluded: ["manager"] });
  await page.goto("/");
  await expect(summary).toHaveText("1 city · 1 required keyword · 1 boosted keyword · 1 excluded keyword");

  await put({
    cities: [["Bern"], ["Zurich"], ["Geneva"]],
    required: ["a", "b", "c", "d", "e", "f"],
    boosted: ["g", "h"],
    excluded: ["i", "j"],
  });
  await page.reload();
  await expect(summary).toHaveText("3 cities · 6 required keywords · 2 boosted keywords · 2 excluded keywords");

  // Parts with a count of 0 are left out.
  await put({ cities: [], required: ["a", "b"], boosted: [], excluded: [] });
  await page.reload();
  await expect(summary).toHaveText("2 required keywords");
});

test("unchecking Include remote Jobs removes remote Jobs from the Inbox; it is saved", async ({ page }) => {
  await followAcme(page);
  await page.request.put("/api/filter", {
    data: { cities: [["Bern"]], required: [], boosted: [], excluded: [], includeRemote: true },
  });
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Filter" });
  await panel.getByRole("button", { name: /^Filter/ }).click();
  // The remote Product Designer shows; the Office Manager has no location.
  await expectTitles(page, ["Product Designer", "Office Manager"]);

  const includeRemote = panel.getByRole("checkbox", { name: "Include remote Jobs" });
  await expect(includeRemote).toBeChecked();
  await includeRemote.uncheck();
  await expectTitles(page, ["Office Manager"]);

  // Saved straight away.
  await page.reload();
  await expectTitles(page, ["Office Manager"]);
  await expect(includeRemote).not.toBeChecked();

  await includeRemote.check();
  await expectTitles(page, ["Product Designer", "Office Manager"]);
});

test("Mark all as seen marks only the Jobs visible in the Inbox", async ({ page }) => {
  await followAcme(page);
  await page.request.put("/api/filter", {
    data: { cities: [], required: [], boosted: [], excluded: ["manager"], includeRemote: true },
  });
  await page.goto("/");
  await expect(titles(page)).toHaveCount(2);

  await page.getByRole("button", { name: "Mark all as seen" }).click();

  await expect(page.getByText("You're all caught up: nothing new to review.")).toBeVisible();
  await expect(page.getByText("1 Unseen Job is hidden by your Filter.")).toBeVisible();
  await expect(tab(page, "Seen")).toHaveAccessibleName("Seen 2");
  const jobs = ((await (await page.request.get("/api/jobs")).json()) as { jobs: Job[] }).jobs;
  expect(jobs.find((j) => j.title === "Office Manager")!.status).toBe("unseen");
});

async function jobId(page: Page, title: string): Promise<number> {
  const jobs = ((await (await page.request.get("/api/jobs")).json()) as { jobs: Job[] }).jobs;
  return jobs.find((j) => j.title === title)!.id;
}
