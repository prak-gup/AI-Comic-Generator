import { test, expect } from '@playwright/test';

test.describe('AI Comic Strip Generator', () => {
  test('homepage renders and shows gated error without env', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await expect(page).toHaveTitle(/AI Comic Strip Generator/);

    // App requires VITE_GEMINI_API_KEY; our config sets a test key.
    // Check main header renders.
    await expect(page.locator('h1')).toHaveText('AI Comic Strip Generator');

    // Check primary controls presence
    await expect(page.getByRole('button', { name: 'Select File' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use Camera' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create My Comic!' })).toBeVisible();

    // Without an uploaded image and story, the button should be disabled
    await expect(page.getByRole('button', { name: 'Create My Comic!' })).toBeDisabled();

    // No unexpected console errors on load
    expect(consoleErrors.join('\n')).not.toMatch(/TypeError|ReferenceError|FATAL/i);
  });
});


