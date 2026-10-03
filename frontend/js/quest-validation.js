/* ============================================================
 * quest-validation.js — deterministic, browser-local geometry checks
 * Public: window.QuestValidation.evaluate(checks, construction, stats)
 * ============================================================ */
(function (global) {
  'use strict';

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function area(points, triangle) {
    var a = points[triangle[0]], b = points[triangle[1]], c = points[triangle[2]];
    return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  function angleAt(points, vertex, first, second) {
    var v = points[vertex], a = points[first], b = points[second];
    if (!v || !a || !b) return null;
    var ax = a.x - v.x, ay = a.y - v.y;
    var bx = b.x - v.x, by = b.y - v.y;
    var product = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (!product) return null;
    var cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / product));
    return Math.acos(cosine) * 180 / Math.PI;
  }
  function triangles(data) {
    var edges = Object.create(null);
    (data.segments || []).forEach(function (segment) {
      if (!segment || segment.length < 2) return;
      edges[[segment[0], segment[1]].sort().join('|')] = true;
    });
    var names = Object.keys(data.points || {});
    var out = [];
    for (var i = 0; i < names.length; i++) {
      for (var j = i + 1; j < names.length; j++) {
        for (var k = j + 1; k < names.length; k++) {
          var candidate = [names[i], names[j], names[k]];
          if (edges[[candidate[0], candidate[1]].sort().join('|')] &&
              edges[[candidate[1], candidate[2]].sort().join('|')] &&
              edges[[candidate[0], candidate[2]].sort().join('|')]) out.push(candidate);
        }
      }
    }
    return out;
  }
  function recordedAtEveryVertex(data, triangle) {
    var points = data.points || {};
    var measured = Object.create(null);
    (data.angles || []).forEach(function (angle) {
      if (!angle || triangle.indexOf(angle[0]) < 0) return;
      var others = triangle.filter(function (name) { return name !== angle[0]; });
      if (angle.slice(1).sort().join('|') === others.sort().join('|') && angleAt(points, angle[0], angle[1], angle[2]) != null) {
        measured[angle[0]] = true;
      }
    });
    return triangle.every(function (name) { return !!measured[name]; });
  }
  function checkGeometry(kind, data) {
    var points = data.points || {};
    var candidates = triangles(data);
    if (kind === 'triangle_angle_sum') {
      return candidates.some(function (triangle) {
        if (area(points, triangle) <= 0.001 || !recordedAtEveryVertex(data, triangle)) return false;
        var sum = triangle.reduce(function (total, vertex) {
          var others = triangle.filter(function (name) { return name !== vertex; });
          return total + (angleAt(points, vertex, others[0], others[1]) || 0);
        }, 0);
        return Math.abs(sum - 180) <= 0.1;
      });
    }
    if (kind === 'pythagorean') {
      return candidates.some(function (triangle) {
        if (area(points, triangle) <= 0.001) return false;
        var sideLengths = [
          distance(points[triangle[0]], points[triangle[1]]),
          distance(points[triangle[1]], points[triangle[2]]),
          distance(points[triangle[0]], points[triangle[2]])
        ].sort(function (a, b) { return a - b; });
        if (sideLengths[0] <= 0) return false;
        var rightAngle = triangle.some(function (vertex) {
          var others = triangle.filter(function (name) { return name !== vertex; });
          var value = angleAt(points, vertex, others[0], others[1]);
          return value != null && Math.abs(value - 90) <= 1;
        });
        var difference = Math.abs(sideLengths[0] * sideLengths[0] +
          sideLengths[1] * sideLengths[1] - sideLengths[2] * sideLengths[2]);
        return rightAngle && difference / (sideLengths[2] * sideLengths[2]) <= 0.02;
      });
    }
    if (kind === 'isosceles_base_angles') {
      return candidates.some(function (triangle) {
        if (area(points, triangle) <= 0.001) return false;
        return triangle.some(function (apex) {
          var base = triangle.filter(function (name) { return name !== apex; });
          var firstSide = distance(points[apex], points[base[0]]);
          var secondSide = distance(points[apex], points[base[1]]);
          var firstBaseAngle = angleAt(points, base[0], apex, base[1]);
          var secondBaseAngle = angleAt(points, base[1], apex, base[0]);
          return firstSide > 0 && Math.abs(firstSide - secondSide) / Math.max(firstSide, secondSide) <= 0.01 &&
            firstBaseAngle != null && secondBaseAngle != null &&
            Math.abs(firstBaseAngle - secondBaseAngle) <= 1.5;
        });
      });
    }
    if (kind === 'thales_right_angle') {
      return (data.circles || []).some(function (circle) {
        var center = points[circle[0]], radiusPoint = points[circle[1]];
        if (!center || !radiusPoint) return false;
        var radius = distance(center, radiusPoint);
        if (!radius) return false;
        return candidates.some(function (triangle) {
          return triangle.some(function (first, i) {
            return triangle.slice(i + 1).some(function (second) {
              var midpoint = {
                x: (points[first].x + points[second].x) / 2,
                y: (points[first].y + points[second].y) / 2
              };
              var onCircle = triangle.filter(function (name) {
                return Math.abs(distance(center, points[name]) - radius) <= Math.max(2, radius * 0.02);
              });
              var vertex = triangle.filter(function (name) { return name !== first && name !== second; })[0];
              return onCircle.indexOf(first) >= 0 && onCircle.indexOf(second) >= 0 && onCircle.indexOf(vertex) >= 0 &&
                distance(center, midpoint) <= Math.max(2, radius * 0.02) &&
                Math.abs(angleAt(points, vertex, first, second) - 90) <= 1;
            });
          });
        });
      });
    }
    return null;
  }

  function evaluate(checks, construction, stats) {
    var data = construction || {};
    var currentStats = stats || {};
    return (checks || []).map(function (check) {
      var passed = false, label;
      if (check.kind.indexOf('min_') === 0) {
        var key = check.kind.slice(4);
        var count = Number(currentStats[key]) || 0;
        passed = count >= check.n;
        label = (check.label || key) + ': ' + count + '/' + check.n;
      } else if (check.kind.indexOf('geometry_') === 0) {
        var result = checkGeometry(check.kind.slice(9), data);
        passed = result === true;
        label = check.label || ({
          triangle_angle_sum: '作図した三角形の3つの角の和が180°',
          pythagorean: '作図した直角三角形で三平方の関係',
          isosceles_base_angles: '作図した二等辺三角形の底角が等しい',
          thales_right_angle: '直径に対する円周角が90°'
        }[check.kind.slice(9)] || '図形の性質を確認');
      } else {
        return null;
      }
      return { label: label, ok: passed, source: check.kind.indexOf('geometry_') === 0 ? 'geometry' : 'activity' };
    }).filter(Boolean);
  }

  global.QuestValidation = { evaluate: evaluate };
})(window);
