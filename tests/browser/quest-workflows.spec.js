'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const AxeBuilder = require('@axe-core/playwright').default;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.protocol.startsWith('http') &&
        requestUrl.hostname !== '127.0.0.1' &&
        requestUrl.hostname !== 'localhost') {
      return route.abort();
    }
    return route.continue();
  });
  await page.route('**/js/solid.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'export {};'}));
});

test('local CSS, math rendering, and vendor assets work without external network access', async ({ page }) => {
  const externalRequests = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  page.on('request', (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.protocol.startsWith('http') &&
        requestUrl.hostname !== '127.0.0.1' &&
        requestUrl.hostname !== 'localhost') {
      externalRequests.push(request.url());
    }
  });
  await page.goto('/');
  const readiness = await page.evaluate(() => ({
    katex: Boolean(window.katex),
    board: Boolean(window.ConstructionBoard),
    styleSheets: Array.from(document.styleSheets).map((sheet) => sheet.href)
  }));
  expect(readiness, JSON.stringify({ readiness, pageErrors, failedRequests })).toMatchObject({ katex: true, board: true });
  await expect(page.locator('#teacher-view')).toHaveCSS('display', 'none');
  const vendorResponseStatuses = await page.evaluate(async () => {
    const paths = [
      'css/tailwind.generated.css',
      'vendor/katex/katex.min.css',
      'vendor/katex/fonts/KaTeX_Main-Regular.woff2',
      'vendor/three.module.min.js'
    ];
    return Promise.all(paths.map(async (path) => (await fetch(path)).status));
  });
  expect(vendorResponseStatuses).toEqual([200, 200, 200, 200]);
  const threeModuleLoaded = await page.evaluate(async () =>
    Boolean((await import('/vendor/three.module.min.js')).Scene));
  expect(threeModuleLoaded).toBe(true);
  const mathMarkupRendered = await page.evaluate(() => {
    const output = document.createElement('span');
    window.katex.render('\\frac{1}{2}', output, { throwOnError: true });
    return Boolean(output.querySelector('.katex'));
  });
  expect(mathMarkupRendered).toBe(true);
  expect(externalRequests).toEqual([]);
});

test('submission reports export one selected record with only explicitly selected personal content', async ({ page }) => {
  await page.goto('/');
  await page.locator('#student-tab-journal').click();
  await page.evaluate(() => localStorage.setItem('journal-v1', JSON.stringify([{
    time: '2026/10/04 10:00',
    createdAt: '2026-10-04T01:00:00.000Z',
    prediction: '予想-SENSITIVE',
    checks: [{ name: '作図の条件', passed: true }],
    comment: '',
    questId: 'junior-triangle',
    questTitle: '三角形の探究',
    reflection: '振り返り-SENSITIVE',
    construction: { points: { A: { x: 20, y: 40 } }, segments: [['A', 'B']] }
  }])));
  await page.reload();
  await page.locator('#student-tab-journal').click();
  await page.locator('#journal-export-report-btn').click();
  await expect(page.locator('#journal-report-dialog')).toBeVisible();
  await expect(page.locator('#journal-report-name')).toBeDisabled();
  await page.locator('#journal-report-include-prediction').uncheck();
  await page.locator('#journal-report-include-reflection').uncheck();
  const [anonymousDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#journal-report-download').click()
  ]);
  const anonymousReport = JSON.parse(await fs.readFile(await anonymousDownload.path(), 'utf8'));
  expect(anonymousReport.task.title).toBe('三角形の探究');
  expect(anonymousReport.checks).toEqual([{ name: '作図の条件', passed: true }]);
  expect(anonymousReport.construction.points.A).toEqual({ x: 20, y: 40 });
  expect(anonymousReport).not.toHaveProperty('studentName');
  expect(anonymousReport).not.toHaveProperty('prediction');
  expect(anonymousReport).not.toHaveProperty('reflection');
  expect(JSON.stringify(anonymousReport)).not.toContain('SENSITIVE');

  await page.locator('#journal-export-report-btn').click();
  await page.locator('#journal-report-include-name').check();
  await page.locator('#journal-report-name').fill('山田 花子');
  const [namedDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#journal-report-download').click()
  ]);
  const namedReport = JSON.parse(await fs.readFile(await namedDownload.path(), 'utf8'));
  expect(namedReport.studentName).toBe('山田 花子');
});

test('filters quests by stage, grade, and unit', async ({ page }) => {
  await page.goto('/');
  await page.locator('#student-tab-quests').click();
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(30);
  await page.getByRole('button', { name: '中学校', exact: true }).click();
  await page.locator('#quest-grade-filter').selectOption('中学校3年');
  await page.locator('#quest-unit-filter').selectOption('円');
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(1);
  await expect(page.locator('#quest-list')).toContainText('半円の角のふしぎ');
});

test('teacher task packs can be imported by learners and cleared locally', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mode-teacher-btn').click();
  await page.locator('#teacher-lesson-add-btn').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#teacher-lesson-pack-btn').click()
  ]);
  const pack = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(pack.type).toBe('geometry-quest-pack');
  expect(pack.schemaVersion).toBe(1);
  expect(pack.questIds).toHaveLength(1);

  await page.locator('#mode-student-btn').click();
  await page.locator('#student-tab-quests').click();
  await page.locator('#student-task-pack-input').setInputFiles({
    name: 'lesson-pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(pack))
  });
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(1);
  await expect(page.locator('#student-task-pack-status')).toContainText('1課題を表示');
  await page.locator('#student-task-pack-input').setInputFiles({
    name: 'invalid-pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      type: 'geometry-quest-pack',
      schemaVersion: 1,
      title: '不正な課題パック',
      questIds: ['missing-quest']
    }))
  });
  await expect(page.locator('#student-task-pack-status')).toContainText('一致しないID');
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(1);
  await page.locator('#student-task-pack-clear').click();
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(30);

  await page.locator('#mode-teacher-btn').click();
  await page.locator('#teacher-lesson-pack-import-btn').click();
  await page.locator('#teacher-lesson-pack-input').setInputFiles({
    name: 'lesson-pack.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(pack))
  });
  await expect(page.locator('#teacher-lesson-items .teacher-lesson-chip')).toHaveCount(1);
});

test('teacher curriculum map covers every task and shows stage totals', async ({ page }) => {
  await page.goto('/');
  await page.locator('#mode-teacher-btn').click();
  const coverage = page.locator('#teacher-curriculum-coverage');
  await coverage.locator('summary').click();
  await expect(page.locator('#teacher-curriculum-rows tr')).toHaveCount(30);
  await expect(page.locator('#teacher-curriculum-summary')).toContainText('中学校 16課題');
  await expect(page.locator('#teacher-quest-preview')).toContainText('既習事項の目安');
  await expect(page.locator('#teacher-quest-preview')).toContainText('授業配当の目安');
});

test('service worker caches the app shell for offline inquiry and construction', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    await new Promise((resolve) => {
      if (navigator.serviceWorker.controller) return resolve();
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
    });
  });
  const pwaResources = await page.evaluate(async () => ({
    manifest: (await fetch('/manifest.webmanifest')).status,
    worker: (await fetch('/service-worker.js')).status,
    cacheKeys: await caches.keys()
  }));
  expect(pwaResources.manifest).toBe(200);
  expect(pwaResources.worker).toBe(200);
  expect(pwaResources.cacheKeys).toContain('geometry-learning-shell-v2');

  await page.locator('#student-tab-quests').click();
  await context.setOffline(true);
  await page.reload();
  await page.locator('#student-tab-quests').click();
  await expect(page.locator('#quest-list .quest-card')).toHaveCount(30);
  await expect(page.locator('#connection-status')).toContainText('オフラインです');
  await page.locator('#geometry-canvas').focus();
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.ConstructionBoard.stats().points)).toBe(1);
  await context.setOffline(false);
});

test('student and teacher workflows have no WCAG 2.1 A/AA violations', async ({ page }) => {
  await page.goto('/');
  const studentAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(studentAudit.violations.map((issue) => ({
    id: issue.id,
    description: issue.description,
    nodes: issue.nodes.map((node) => ({ target: node.target, summary: node.failureSummary }))
  }))).toEqual([]);

  await page.locator('#mode-teacher-btn').click();
  await expect.poll(() => page.locator('#teacher-source-area').evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  await page.waitForTimeout(350);
  const teacherAudit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(teacherAudit.violations.map((issue) => ({
    id: issue.id,
    description: issue.description,
    nodes: issue.nodes.map((node) => ({ target: node.target, summary: node.failureSummary }))
  }))).toEqual([]);
});

test('keyboard users can navigate modes, move between teacher tabs, and place points', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#mode-tabs')).toHaveAttribute('role', 'tablist');
  await page.locator('.skip-link').focus();
  await expect(page.locator('.skip-link')).toBeFocused();
  const toolbarToggle = page.locator('#construct-tools-toggle');
  await toolbarToggle.click();
  await expect(toolbarToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toolbarToggle).toHaveAttribute('aria-label', '作図ツールを表示');
  await expect(page.locator('#construct-toolbar')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#construct-toolbar')).toHaveAttribute('inert', '');
  await toolbarToggle.click();
  await expect(toolbarToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toolbarToggle).toHaveAttribute('aria-label', '作図ツールを隠す');
  await expect(page.locator('#construct-toolbar')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mode-student-btn').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#mode-teacher-btn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#teacher-view')).toHaveAttribute('aria-hidden', 'false');

  await page.locator('#tab-lesson-plan').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-print-figure')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-print-figure')).toHaveAttribute('aria-hidden', 'false');

  await page.locator('#mode-student-btn').click();
  await page.locator('#geometry-canvas').focus();
  await page.keyboard.press('p');
  await expect(page.locator('#tool-point')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#canvas-keyboard-status')).toContainText('x 420');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#canvas-keyboard-status')).toContainText('x 425');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.ConstructionBoard.stats().points)).toBe(1);
  await expect(page.locator('#canvas-keyboard-status')).toContainText('Enterを押します');
});

test('tablet and phone layouts keep inquiry and drawing controls within the viewport', async ({ page }) => {
  for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.locator('#student-tab-quests').click();
    await page.getByRole('button', { name: '中学校', exact: true }).click();
    await page.locator('#quest-grade-filter').selectOption('中学校1年');
    await page.locator('#quest-list .quest-card').first().focus();
    const dimensions = await page.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      overflowing: Array.from(document.querySelectorAll('body *')).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < 0 || rect.right > window.innerWidth + 1);
      }).map((element) => {
        const parent = element.parentElement;
        return { id: element.id, className: String(element.className).slice(0, 100), right: Math.round(element.getBoundingClientRect().right), parent: parent && { id: parent.id, className: parent.className, display: getComputedStyle(parent).display } };
      }).slice(0, 10),
      toolbarButtons: Array.from(document.querySelectorAll('#construct-toolbar .construct-tool')).map((button) =>
        Math.min(button.getBoundingClientRect().width, button.getBoundingClientRect().height))
    }));
    expect(dimensions.pageWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.toolbarButtons.every((size) => size >= 44)).toBe(true);
  }
});

test('guided, counterexample, blank, and saved-draft quest paths work', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await page.goto('/');
  await page.locator('#student-tab-quests').click();
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
  await expect(page.locator('#teacher-lesson-estimate')).toContainText('合計 100分');
  await expect(page.locator('#teacher-quest-preview')).toContainText('予想されるつまずき');
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
  expect(teacherWorksheet).toContain('## 授業の流れ');
  expect(teacherWorksheet).toContain('## 発問例');
  expect(teacherWorksheet).toContain('## 予想されるつまずき');
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
  await page.locator('#student-tab-journal').click();
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
