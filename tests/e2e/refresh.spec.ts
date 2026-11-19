import { expect, test } from "./fixtures.ts";

test("reads every Source when the app opens and again on Refresh, ending with a summary", async ({ page }) => {
  const followed = await page.request.post("/api/companies", {
    data: { source: { type: "greenhouse", key: "acme" }, name: "Acme" },
  });
  expect(followed.status()).toBe(201);
  const refreshes: string[] = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/refresh")) refreshes.push(req.method());
  });

  await page.goto("/");

  // A polite live region next to the button (not role=status, which the undo toast uses).
  const status = page.locator("#refresh-status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveText("0 new · 0 outdated");
  expect(refreshes).toEqual(["POST"]);
  await expect(page.getByRole("listitem").filter({ hasText: "Senior Backend Engineer" })).toBeVisible();

  await page.getByRole("button", { name: "Refresh" }).click();

  await expect.poll(() => refreshes.length).toBe(2);
  await expect(status).toHaveText("0 new · 0 outdated");
  await expect(page.getByRole("button", { name: "Refresh" })).toBeFocused();
});
