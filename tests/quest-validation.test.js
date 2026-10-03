'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = { window: {}, Math };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'frontend/js/quests.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'frontend/js/quest-validation.js'), 'utf8'), context);

const quests = JSON.parse(JSON.stringify(context.window.QUESTS));
const validation = context.window.QuestValidation;

function check(kind, construction) {
  return validation.evaluate([{ kind }], construction, {});
}

function triangle(points) {
  return {
    points,
    segments: [['A', 'B'], ['B', 'C'], ['C', 'A']],
    angles: [['A', 'B', 'C'], ['B', 'A', 'C'], ['C', 'A', 'B']]
  };
}

test('catalog entries are complete, unique, and categorized for all school stages', () => {
  const required = ['id', 'level', 'grade', 'unit', 'title', 'goal', 'scenario', 'question', 'steps',
    'hints', 'focus', 'prediction', 'validation', 'discovery', 'checks', 'complete'];
  assert.equal(quests.length, 30);
  assert.equal(new Set(quests.map((q) => q.id)).size, quests.length);
  for (const quest of quests) {
    for (const key of required) assert.ok(quest[key], `${quest.id} missing ${key}`);
    assert.ok(quest.steps.length > 0, `${quest.id} missing steps`);
    assert.ok(quest.starter, `${quest.id} missing a usable starter`);
    assert.ok(quest.grade.startsWith(quest.level === 'elem' ? '小学校' : quest.level === 'junior' ? '中学校' : '高校'));
    assert.ok(quest.checks.every((check) => check.kind.startsWith('min_') ||
      check.kind.startsWith('geometry_') || ['has_check', 'has_theorem'].includes(check.kind)), `${quest.id} has an unknown check`);
  }
  for (const grade of ['中学校1年', '中学校2年', '中学校3年']) {
    assert.ok(quests.some((q) => q.grade === grade), `${grade} has no tasks`);
  }
});

test('every starter references existing points', () => {
  for (const quest of quests) {
    const data = quest.starter;
    const names = new Set(Object.keys(data.points));
    const refs = [
      ...(data.segments || []).flat(),
      ...(data.lines || []).flat(),
      ...(data.circles || []).flat(),
      ...(data.angles || []).flat(),
      ...(data.bisectors || []).flat(),
      ...(data.pbis || []).flat(),
      ...(data.tangents || []).flat(),
      ...(data.parallels || []).flatMap((line) => [...line.seg, line.p]),
      ...(data.perps || []).flatMap((line) => [...line.seg, line.p])
    ];
    assert.ok(refs.every((name) => names.has(name)), `${quest.id} starter has a dangling point reference`);
  }
});

test('local angle-sum validation requires a drawn triangle and all three measured vertices', () => {
  const valid = triangle({
    A: { x: 0, y: 0 }, B: { x: 4, y: 0 }, C: { x: 0, y: 3 }
  });
  assert.equal(check('geometry_triangle_angle_sum', valid)[0].ok, true);
  valid.angles = [['A', 'B', 'C'], ['B', 'A', 'C']];
  assert.equal(check('geometry_triangle_angle_sum', valid)[0].ok, false);
  valid.angles.push(['C', 'A', 'B']);
  valid.segments.pop();
  assert.equal(check('geometry_triangle_angle_sum', valid)[0].ok, false);
  valid.segments.push(['A', 'C']);
  valid.points.C = { x: 2, y: 0 };
  assert.equal(check('geometry_triangle_angle_sum', valid)[0].ok, false);
});

test('local Pythagorean validation rejects non-right triangles', () => {
  assert.equal(check('geometry_pythagorean', triangle({
    A: { x: 0, y: 0 }, B: { x: 0, y: 3 }, C: { x: 4, y: 0 }
  }))[0].ok, true);
  assert.equal(check('geometry_pythagorean', triangle({
    A: { x: 0, y: 0 }, B: { x: 1, y: 3 }, C: { x: 4, y: 0 }
  }))[0].ok, false);
});

test('local isosceles validation checks equal sides and corresponding base angles', () => {
  assert.equal(check('geometry_isosceles_base_angles', triangle({
    A: { x: 0, y: 3 }, B: { x: -4, y: 0 }, C: { x: 4, y: 0 }
  }))[0].ok, true);
  assert.equal(check('geometry_isosceles_base_angles', triangle({
    A: { x: 0, y: 3 }, B: { x: -4, y: 0 }, C: { x: 2, y: 0 }
  }))[0].ok, false);
});

test('local Thales validation requires a diameter, a circle point, and a right angle', () => {
  const data = {
    points: { O: { x: 0, y: 0 }, A: { x: -5, y: 0 }, B: { x: 5, y: 0 }, C: { x: 0, y: 5 } },
    segments: [['A', 'B'], ['A', 'C'], ['B', 'C']],
    circles: [['O', 'A']],
    angles: [['C', 'A', 'B']]
  };
  assert.equal(check('geometry_thales_right_angle', data)[0].ok, true);
  data.points.C.y = 4;
  assert.equal(check('geometry_thales_right_angle', data)[0].ok, false);
});

test('HTML exposes keyboard-operable filters, reflection, teacher worksheet, and journal backups', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  for (const id of ['quest-grade-filter', 'quest-unit-filter', 'quest-reflection-input', 'teacher-quest-select',
    'teacher-quest-download-btn', 'teacher-quest-print-btn', 'journal-export-json-btn', 'journal-export-csv-btn',
    'journal-import-input']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-quest-level="all" aria-pressed="true"/);
  assert.match(html, /id="quest-reflection-input"[^>]*aria-required="true"/);
  assert.match(html, /id="quest-result"[^>]*role="status"/);
  assert.match(html, /for="teacher-quest-select"/);
  assert.match(html, /id="journal-export-status"[^>]*role="status"/);
  assert.ok(html.indexOf('js/quests.js') < html.indexOf('js/quest-validation.js'));
  assert.ok(html.indexOf('js/quest-validation.js') < html.indexOf('js/app.js'));
  const app = fs.readFileSync(path.join(root, 'frontend/js/app.js'), 'utf8');
  assert.match(app, /if \(questStepDone\.some\(function \(done\) \{ return !done; \}\)\)/);
  assert.match(app, /if \(!reflection\)/);
  assert.match(app, /JSON\.parse\(String\(reader\.result/);
});
