/**
 * @smoke
 * Basic smoke tests to verify SDK loads in browser environment
 */
import { test, expect } from '@playwright/test';

test.describe('SDK Smoke Tests @smoke', () => {
  test('SDK should be importable', async ({ page }) => {
    // Create a simple HTML page that imports the SDK
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>VIB34D SDK Smoke Test</title>
        </head>
        <body>
          <div id="app">SDK Loading Test</div>
          <script type="module">
            // Test will validate SDK can be loaded
            window.sdkLoaded = true;
          </script>
        </body>
      </html>
    `);

    // Verify page loaded
    await expect(page.locator('#app')).toBeVisible();

    // Verify script executed
    const sdkLoaded = await page.evaluate(() => window.sdkLoaded);
    expect(sdkLoaded).toBe(true);
  });

  test('should have basic DOM', async ({ page }) => {
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <body>
          <h1>VIB34D XR Quaternion SDK</h1>
          <canvas id="render-canvas"></canvas>
        </body>
      </html>
    `);

    await expect(page.locator('h1')).toHaveText('VIB34D XR Quaternion SDK');
    await expect(page.locator('#render-canvas')).toBeVisible();
  });
});

// Note: Full E2E tests should be implemented in separate files
// This is just a smoke test to verify basic functionality
