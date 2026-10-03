'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = '.hidden{display:none!important}';
    document.documentElement.appendChild(style);
  });
  await page.route('https://cdn.tailwindcss.com', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'window.tailwind = { config: {} };' }));
  await page.route('**/js/solid.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'export {};'}));
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
});

test('filters quests by stage, grade, and unit', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(30);
  await page.getByRole('button', { name: '中学校', exact: true }).click();
  await page.locator('#quest-grade-filter').selectOption('中学校3年');
  await page.locator('#quest-unit-filter').selectOption('円');
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(1);
  await expect(page.locator('#quest-list')).toContainText('半円の角のふしぎ');
});

test('guided, counterexample, blank, and saved-draft quest paths work', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await page.getByRole('button', { name: '中学校', exact: true }).click();
  await page.locator('#quest-grade-filter').selectOption('中学校1年');
  await page.locator('#quest-unit-filter').selectOption('平面図形と作図');
  await page.getByRole('button', { name: /2地点から同じ距離の場所/ }).click();

  await page.locator('#quest-starter-guided-btn').click();
  await expect.poll(() => page.evaluate(() =>
    window.QuestValidation.evaluate([{ kind: 'geometry_perpendicular_bisector_locus' }],
      window.ConstructionBoard.serialize(), {})[0].ok)).toBe(true);

  await page.locator('#quest-starter-counterexample-btn').click();
  await expect.poll(() => page.evaluate(() =>
    window.QuestValidation.evaluate([{ kind: 'geometry_perpendicular_bisector_locus' }],
      window.ConstructionBoard.serialize(), {})[0].ok)).toBe(false);
  await page.locator('#quest-starter-blank-btn').click();
  await expect.poll(() => page.evaluate(() =>
    Object.keys(window.ConstructionBoard.serialize().points).length)).toBe(0);

  await page.locator('#quest-starter-guided-btn').click();
  await page.locator('.quest-step').evaluateAll((steps) => steps.forEach((step) => step.click()));
  await page.locator('#quest-reflection-input').fill('点を移動しても両端までの距離が等しいことを確かめた。');
  await page.locator('#quest-check-btn').click();
  await expect(page.locator('#quest-result')).toContainText('探究活動を記録しました');
  await page.locator('#quest-reflection-input').fill('終了直前の修正も自動保存された。');
  await page.locator('#quest-back-btn').click();
  await expect.poll(() => page.evaluate(() =>
    localStorage.getItem('quest-draft-v1-junior1-pbis-locus')))
    .toContain('終了直前の修正も自動保存された。');

  await page.getByRole('button', { name: /2地点から同じ距離の場所/ }).click();
  await expect(page.locator('#quest-resume-btn')).toBeVisible();
  await page.locator('#quest-starter-blank-btn').click();
  await page.locator('#quest-resume-btn').click();
  await expect(page.locator('#quest-reflection-input')).toHaveValue(
    '終了直前の修正も自動保存された。');
});

test('teacher lesson sets save and export learner worksheets', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mode-teacher-btn').click();
  await page.locator('#teacher-quest-select').selectOption('junior2-congruence');
  await page.locator('#teacher-worksheet-audience').selectOption('learner');
  await page.locator('#teacher-lesson-add-btn').click();
  await page.locator('#teacher-quest-select').selectOption('junior3-similarity');
  await page.locator('#teacher-lesson-add-btn').click();
  await expect(page.locator('#teacher-lesson-items .teacher-lesson-chip')).toHaveCount(2);
  await page.locator('#teacher-lesson-save-btn').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('teacher-lesson-set-v1')))
    .toBe('["junior2-congruence","junior3-similarity"]');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#teacher-lesson-download-btn').click();
  const download = await downloadPromise;
  const worksheet = await fs.readFile(await download.path(), 'utf8');
  expect(worksheet).toContain('授業セット 1 / 2');
  expect(worksheet).toContain('予想・記録');
  expect(worksheet).not.toContain('観点別評価メモ');
  await page.locator('#teacher-worksheet-audience').selectOption('teacher');
  const teacherDownloadPromise = page.waitForEvent('download');
  await page.locator('#teacher-lesson-download-btn').click();
  const teacherDownload = await teacherDownloadPromise;
  const teacherWorksheet = await fs.readFile(await teacherDownload.path(), 'utf8');
  expect(teacherWorksheet).toContain('観点別評価メモ');
  const printPromise = page.waitForEvent('popup');
  await page.locator('#teacher-lesson-print-btn').click();
  const printPage = await printPromise;
  await expect(printPage.locator('body')).toContainText('授業セット 1 / 2');
  await printPage.close();
  await page.locator('#teacher-quest-open-btn').click();
  await expect(page.locator('#student-view')).toBeVisible();
  await expect(page.locator('#quest-active-title')).toContainText('拡大しても変わらないものは');
});

test('journal import and anonymous portfolio export omit free-text learner data', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await page.locator('#journal-import-input').setInputFiles({
    name: 'journal.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      entries: [{
        time: '2026/01/01 12:00', createdAt: '2026-01-01T12:00:00.000Z',
        prediction: 'PRIVATE_PREDICTION', reflection: 'PRIVATE_REFLECTION',
        comment: 'PRIVATE_COMMENT', questId: 'angle-sum', questTitle: '三角形の内角の和',
        checks: [{ name: '確認済み', passed: true }]
      }]
    }))
  });
  await expect(page.locator('#journal-entries')).toContainText('PRIVATE_PREDICTION');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#journal-export-portfolio-btn').click();
  const download = await downloadPromise;
  const exported = await fs.readFile(await download.path(), 'utf8');
  expect(exported).toContain('"questId": "angle-sum"');
  expect(exported).not.toContain('PRIVATE_PREDICTION');
  expect(exported).not.toContain('PRIVATE_REFLECTION');
  expect(exported).not.toContain('PRIVATE_COMMENT');
});
