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

test('middle-school geometry checks accept intended examples and reject counterexamples', () => {
  const fixtures = [
    ['parallel-angles', 'geometry_parallel_lines'],
    ['junior1-pbis-locus', 'geometry_perpendicular_bisector_locus'],
    ['junior1-angle-bisector-locus', 'geometry_angle_bisector_locus'],
    ['junior1-circle-tangent', 'geometry_tangent_radius'],
    ['junior2-exterior-angle', 'geometry_triangle_exterior_angle'],
    ['junior2-parallelogram', 'geometry_parallelogram'],
    ['junior2-congruence', 'geometry_congruent_triangles'],
    ['junior3-similarity', 'geometry_similar_triangles'],
    ['junior3-parallel-ratio', 'geometry_parallel_side_ratio'],
    ['junior3-similarity-height', 'geometry_similar_triangles'],
    ['junior3-circle-angle', 'geometry_inscribed_angle'],
    ['high-chord-center', 'geometry_circle_chord_bisector']
  ];
  for (const [questId, kind] of fixtures) {
    const quest = quests.find((item) => item.id === questId);
    assert.ok(quest, `${questId} exists`);
    assert.ok(check(kind, quest.starter)[0].ok, `${questId} guided starter satisfies ${kind}`);
    if (quest.starterVariants.counterexample) {
      assert.equal(check(kind, quest.starterVariants.counterexample)[0].ok, false,
        `${questId} counterexample is rejected by ${kind}`);
    }
  }
});

test('circle-angle, locus, and side-ratio checks use actual coordinates rather than tool counts', () => {
  const circle = {
    points: { O: { x: 0, y: 0 }, A: { x: -5, y: 0 }, B: { x: 5, y: 0 }, C: { x: 0, y: 5 } },
    circles: [['O', 'A']],
    angles: [['O', 'A', 'B'], ['C', 'A', 'B']]
  };
  assert.equal(check('geometry_inscribed_angle', circle)[0].ok, true);
  circle.points.C.y = 4;
  assert.equal(check('geometry_inscribed_angle', circle)[0].ok, false);

  const ratio = {
    points: {
      A: { x: 0, y: 0 }, B: { x: 8, y: 0 }, C: { x: 0, y: 8 },
      D: { x: 4, y: 0 }, E: { x: 0, y: 4 }
    },
    segments: [['A', 'B'], ['B', 'C'], ['C', 'A'], ['D', 'E']]
  };
  assert.equal(check('geometry_parallel_side_ratio', ratio)[0].ok, true);
  ratio.points.E.y = 2;
  assert.equal(check('geometry_parallel_side_ratio', ratio)[0].ok, false);
});

test('unknown and server-only geometry requirements never pass locally', () => {
  assert.equal(check('geometry_not_implemented', { points: {} })[0].ok, false);
  assert.equal(check('has_theorem', { points: {} })[0].ok, false);
});

test('HTML exposes keyboard-operable filters, reflection, teacher worksheet, and journal backups', () => {
  const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
  for (const id of ['quest-grade-filter', 'quest-unit-filter', 'quest-reflection-input', 'teacher-quest-select',
    'teacher-quest-download-btn', 'teacher-quest-print-btn', 'journal-export-json-btn', 'journal-export-csv-btn',
    'journal-import-input', 'quest-starter-guided-btn', 'quest-starter-counterexample-btn', 'quest-starter-blank-btn',
    'quest-resume-btn', 'teacher-lesson-add-btn', 'teacher-lesson-print-btn', 'teacher-worksheet-audience',
    'journal-export-portfolio-btn']) {
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
  assert.match(app, /氏名・予想・振り返り・自由記述は含みません/);
  assert.match(app, /function scheduleQuestDraftSave/);
});
