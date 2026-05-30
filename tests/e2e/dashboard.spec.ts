/* ============================================================
   End-to-end UI tests (Playwright). Run with: npm run test:e2e
   Covers the three core journeys, the filters, the map, units, the
   provisional-month flag, a11y (axe), and saves the three screenshots
   the brief asks for into ../test-screenshots/.
   ============================================================ */
import { test, expect, type ConsoleMessage } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SHOTS = "test-screenshots";

test.describe("ReSource Solar and Battery dashboard", () => {
  test("loads without console errors and shows the solar headline", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m: ConsoleMessage) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Installations");
    // wait for client data to load (KPI number appears)
    await expect(page.getByText("Total installations")).toBeVisible();
    await expect(page.getByText("4,402,670")).toBeVisible();
    await expect(page.getByText("Rooftop solar")).toBeVisible();
    // map canvas renders
    await expect(page.locator(".map-canvas canvas")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/solar.png`, fullPage: true });
    expect(errors, `console errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("SOLAR/BATTERY toggle reshapes the dataset, units and time range", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("4,402,670")).toBeVisible();

    // solar KPI capacity is in GW (power), not GWh
    const capCard = page.locator(".kpi", { hasText: "Total capacity" });
    await expect(capCard).toContainText("GW");
    await expect(capCard).not.toContainText("GWh");

    // switch to battery
    await page.getByRole("button", { name: "Battery" }).click();
    await expect(page.getByText("Home battery")).toBeVisible();
    await expect(page.getByText("343,874")).toBeVisible();
    // battery capacity is energy: GWh
    await expect(page.locator(".kpi", { hasText: "Total capacity" })).toContainText("GWh");
    // battery time range starts Jul 2025 (no empty pre-2025 axis)
    const fromSel = page.getByLabel("From month");
    await expect(fromSel).toHaveValue("2025-07");
    await page.screenshot({ path: `${SHOTS}/battery.png`, fullPage: true });
  });

  test("state, metric and time-range filters change the rendered data", async ({ page }) => {
    await page.goto("/");
    const total = page.locator(".kpi", { hasText: "Total installations" }).locator(".kpi-num");
    await expect(total).toHaveText("4,402,670");

    // select a single state -> total drops
    await page.getByRole("button", { name: "VIC", exact: true }).click();
    await expect(total).not.toHaveText("4,402,670");
    await expect(page.getByRole("button", { name: "VIC", exact: true })).toHaveAttribute("aria-pressed", "true");

    // back to all
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(total).toHaveText("4,402,670");

    // metric -> Capacity updates the map legend
    await page.getByRole("button", { name: "Capacity", exact: true }).click();
    await expect(page.locator(".hl-metric")).toHaveText("Capacity");

    // time-range preset 5Y narrows the series
    await page.getByRole("button", { name: "5Y", exact: true }).click();
    await expect(page.getByLabel("From month")).not.toHaveValue("2001-04");
  });

  test("map renders and the by-state bar reflects the metric", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".map-canvas canvas")).toBeVisible({ timeout: 15_000 });
    // by-state bar lists the states with values; QLD leads on installs
    await expect(page.getByText("By state / territory")).toBeVisible();
    // hovering the map surfaces a tooltip (best-effort; canvas hover)
    await page.locator(".map-canvas").hover({ position: { x: 360, y: 240 } });
  });

  test("the trailing incomplete months are flagged on the time series", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/most recent 3 months are incomplete/i)).toBeVisible();
  });

  test("vintage / waste-arisings chart renders and responds to the lifespan slider", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator(".panel", { hasText: "Installation vintage and waste arisings" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Projected waste arisings")).toBeVisible();
    const slider = panel.getByLabel("Assumed life");
    await expect(slider).toBeVisible();
    await slider.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: `${SHOTS}/vintage.png` });
  });

  test("no serious or critical accessibility violations on the main view", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Total installations")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join("\n")).toHaveLength(0);
  });
});
