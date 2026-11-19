import { expect, test } from "@playwright/test";

test("opens on the Inbox with the five tabs and empty states", async ({ page }) => {
  await page.goto("/");

  const tabs = page.getByRole("tablist", { name: "Lists" }).getByRole("tab");
  await expect(tabs).toHaveText([/^Inbox/, /^Saved/, /^Applied/, /^Seen/, /^Companies/]);
  await expect(page.getByRole("tab", { name: /Inbox/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Your Inbox is empty");

  await page.getByRole("tab", { name: /Saved/ }).click();
  await expect(page.getByRole("tab", { name: /Saved/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("No saved Jobs");
});

test("follows the system dark theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: "light" });
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  expect(dark).not.toBe(light);
});
