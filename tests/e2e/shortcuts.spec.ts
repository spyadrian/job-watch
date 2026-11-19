import { expect, test } from "@playwright/test";

test("manages Shortcuts in the Companies tab and opens them in a new tab from the header", async ({ page }) => {
  await page.goto("/");

  const header = page.getByRole("navigation", { name: "Shortcuts" });
  const jobup = header.getByRole("link", { name: /Jobup/ });
  await expect(jobup).toHaveAttribute("href", "https://www.jobup.ch");
  await expect(jobup).toHaveAttribute("target", "_blank");

  await page.getByRole("tab", { name: /Companies/ }).click();
  const section = page.getByRole("region", { name: "Shortcuts" });
  await expect(section.getByRole("link", { name: /Indeed Switzerland/ })).toHaveAttribute("target", "_blank");

  // Add: an invalid link is refused with a message.
  await section.getByLabel("Name", { exact: true }).fill("Acme careers");
  await section.getByLabel("Link", { exact: true }).fill("acme careers");
  await section.getByRole("button", { name: "Add Shortcut" }).click();
  await expect(section.getByRole("alert")).toContainText(/link/i);

  await section.getByLabel("Link", { exact: true }).fill("https://careers.acme.example/jobs");
  await section.getByRole("button", { name: "Add Shortcut" }).click();
  const added = section.getByRole("link", { name: /Acme careers/ });
  await expect(added).toHaveAttribute("href", "https://careers.acme.example/jobs");
  await expect(header.getByRole("link", { name: /Acme careers/ })).toBeVisible();

  // Rename: Cancel keeps the old name, Save applies the new one.
  await section.getByRole("button", { name: "Rename Acme careers" }).click();
  await section.getByLabel("New name for Acme careers").fill("Ignored");
  await section.getByRole("button", { name: "Cancel" }).click();
  await expect(added).toBeVisible();

  await section.getByRole("button", { name: "Rename Acme careers" }).click();
  await section.getByLabel("New name for Acme careers").fill("Acme jobs");
  await section.getByRole("button", { name: "Save", exact: true }).click();
  await expect(section.getByRole("link", { name: /Acme jobs/ })).toBeVisible();
  await expect(header.getByRole("link", { name: /Acme jobs/ })).toBeVisible();

  // Remove.
  await section.getByRole("button", { name: "Remove Acme jobs" }).click();
  await expect(section.getByRole("link", { name: /Acme jobs/ })).toHaveCount(0);
  await expect(header.getByRole("link", { name: /Acme jobs/ })).toHaveCount(0);
});
