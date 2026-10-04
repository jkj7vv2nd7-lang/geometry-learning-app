'use strict';

const { test, expect } = require('@playwright/test');

test('student mode hides the prompt panel and its toggle; teacher mode keeps panel controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await expect(page.locator('body')).toHaveAttribute('data-mode', 'student');
  await expect(page.locator('#control-panel')).toBeHidden();
  await expect(page.locator('#toggle-panel-btn')).toBeHidden();
  await expect(page.locator('#main-display-area')).toBeVisible();

  const studentColumns = await page.locator('#app-layout').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns
  );
  expect(studentColumns.trim().split(/\s+/)).toHaveLength(1);

  await page.locator('#mode-teacher-btn').click();
  await expect(page.locator('#control-panel')).toBeVisible();
  await expect(page.locator('#toggle-panel-btn')).toBeVisible();

  await page.locator('#toggle-panel-btn').click();
  await expect(page.locator('#control-panel')).toBeHidden();
  await page.locator('#toggle-panel-btn').click();
  await expect(page.locator('#control-panel')).toBeVisible();

  await page.locator('#mode-student-btn').click();
  await expect(page.locator('#control-panel')).toBeHidden();
  await expect(page.locator('#toggle-panel-btn')).toBeHidden();
});

test('student mode hides input controls at desktop and phone widths', async ({ page }) => {
  await page.goto('/');
  for (const width of [1365, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('#control-panel')).toBeHidden();
    await expect(page.locator('#toggle-panel-btn')).toBeHidden();
    await expect(page.locator('#student-view')).toBeVisible();
    const overflow = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return {
        pageWidth: document.documentElement.scrollWidth,
        chain: (() => {
          const chain = [];
          let element = document.querySelector('#student-tools');
          while (element) {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            chain.push({
              id: element.id,
              className: element.className,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              minWidth: style.minWidth,
              display: style.display,
              gridColumns: style.gridTemplateColumns
            });
            element = element.parentElement;
          }
          return chain;
        })(),
        elements: Array.from(document.body.querySelectorAll('*'))
          .map((element) => ({
            selector: element.id ? `#${element.id}` : element.tagName.toLowerCase(),
            left: Math.round(element.getBoundingClientRect().left),
            right: Math.round(element.getBoundingClientRect().right)
          }))
          .filter((element) => element.right > viewport + 1 || element.left < -1)
          .slice(0, 12)
      };
    });
    expect(overflow.pageWidth, `unexpected horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`)
      .toBeLessThanOrEqual(width);
  }
});

test('teacher input panel does not cover teacher resources', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('#mode-teacher-btn').click();
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('#control-panel').getBoundingClientRect();
    const main = document.querySelector('#main-display-area').getBoundingClientRect();
    return { panelWidth: panel.width, panelRight: panel.right, mainLeft: main.left };
  });
  expect(layout.panelWidth).toBeLessThan(450);
  expect(layout.mainLeft).toBeGreaterThan(layout.panelRight);
  await page.locator('#teacher-lesson-add-btn').click();
  await expect(page.locator('#teacher-lesson-items .teacher-lesson-chip')).toHaveCount(1);
});
