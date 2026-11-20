import { expect, test } from "./fixtures.ts";

test("follows a Greenhouse Company by link and shows its Jobs in the Inbox", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Companies/ }).click();
  const section = page.getByRole("region", { name: "Follow a Company" });

  // An invalid link gets a clear message.
  await section.getByLabel("Link or Company name").fill("ftp://files.acme.example/jobs");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByRole("alert")).toContainText("doesn't look like a link");

  // Cancel after "N jobs found" saves nothing.
  await section.getByLabel("Link or Company name").fill("https://job-boards.greenhouse.io/acme/jobs/4012001");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByText("3 jobs found")).toBeVisible();
  await section.getByRole("button", { name: "Cancel" }).click();
  await expect(section.getByText("3 jobs found")).toHaveCount(0);
  const before = await (await page.request.get("/api/jobs")).json();
  expect(before.jobs).toHaveLength(0);

  // Found again, renamed, followed.
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByLabel("Company name", { exact: true })).toHaveValue("Acme Robotics");
  await section.getByLabel("Company name", { exact: true }).fill("Acme");
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

test("finds a Company by name on several ATS and follows the one picked", async ({ page }) => {
  const res = await page.request.post("/api/companies", {
    data: { source: { type: "workable", key: "acme" }, name: "Acme on Workable" },
  });
  expect(res.status()).toBe(201);

  await page.goto("/");
  await page.getByRole("tab", { name: /Companies/ }).click();
  const section = page.getByRole("region", { name: "Follow a Company" });

  await section.getByLabel("Link or Company name").fill("Acme");
  await section.getByRole("button", { name: "Find jobs" }).click();

  const choices = section.getByRole("group", { name: "Choose a job board" });
  await expect(choices.getByRole("radio")).toHaveCount(2);
  await choices.getByRole("radio", { name: /Workable/ }).check();
  await expect(section).toContainText("Already following Acme on Workable");
  await expect(section.getByRole("button", { name: "Follow" })).toHaveCount(0);

  await choices.getByRole("radio", { name: /Acme Robotics · Greenhouse · 3 jobs/ }).check();
  await section.getByRole("button", { name: "Follow" }).click();
  await expect(section).toContainText("Following Acme Robotics: 3 jobs added to your Inbox.");
});

test("offers a Shortcut, prefilled with the name and link, when nothing is found", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Companies/ }).click();
  const section = page.getByRole("region", { name: "Follow a Company" });

  await section.getByLabel("Link or Company name").fill("https://www.initech.example/careers");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section).toContainText("No supported job board found");
  await expect(section.getByLabel("Shortcut name")).toHaveValue("Initech");
  await expect(section.getByLabel("Shortcut link")).toHaveValue("https://www.initech.example/careers");
  await section.getByRole("button", { name: "Add as a Shortcut" }).click();
  await expect(section).toContainText("Added Initech to your Shortcuts.");
  await expect(page.getByRole("navigation", { name: "Shortcuts" }).getByRole("link", { name: /Initech/ })).toHaveAttribute(
    "href",
    "https://www.initech.example/careers",
  );

  // From a name, the Shortcut is prefilled with the name; the link is left to fill in.
  await section.getByLabel("Link or Company name").fill("Globex");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByLabel("Shortcut name")).toHaveValue("Globex");
  await expect(section.getByLabel("Shortcut link")).toHaveValue("");

  // A link that can't be opened says so, and still offers the Shortcut.
  await section.getByLabel("Link or Company name").fill("https://careers.unreachable.example/jobs");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section).toContainText("Couldn't reach the page https://careers.unreachable.example/jobs");
  await expect(section.getByLabel("Shortcut link")).toHaveValue("https://careers.unreachable.example/jobs");
});

test("says when a site is read only up to the bound, and how to narrow it by location", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: /Companies/ }).click();
  const section = page.getByRole("region", { name: "Follow a Company" });
  const tip =
    "To read one location only, paste the careers link with ?location=…, e.g. https://bigco.eightfold.ai/careers?domain=bigco.example&location=Switzerland";

  await section.getByLabel("Link or Company name").fill("https://bigco.eightfold.ai/careers?domain=bigco.example");
  await section.getByRole("button", { name: "Find jobs" }).click();
  await expect(section.getByText("10 of 2626 jobs read")).toBeVisible();
  await expect(section).toContainText(tip);

  await section.getByRole("button", { name: "Follow" }).click();
  await expect(section).toContainText("Following Bigco: 10 jobs added to your Inbox.");

  const row = page
    .getByRole("region", { name: "Followed Companies" })
    .getByRole("listitem")
    .filter({ has: page.getByText("Bigco", { exact: true }) });
  await expect(row).toContainText("Only 10 of 2626 jobs read");
  await expect(row).toContainText(tip);
});
