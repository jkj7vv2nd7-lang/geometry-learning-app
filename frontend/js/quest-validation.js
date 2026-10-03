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
  function hasSegment(data, first, second) {
    return (data.segments || []).some(function (segment) {
      return segment && segment.length >= 2 &&
        ((segment[0] === first && segment[1] === second) || (segment[0] === second && segment[1] === first));
    });
  }
  function cross(ax, ay, bx, by) { return ax * by - ay * bx; }
  function pointOnSegmentLine(point, first, second, tolerance) {
    var dx = second.x - first.x, dy = second.y - first.y;
    var length = Math.hypot(dx, dy);
    if (!length) return false;
    return Math.abs(cross(dx, dy, point.x - first.x, point.y - first.y)) / length <= tolerance;
  }
  function pointOnSegment(point, first, second, tolerance) {
    if (!pointOnSegmentLine(point, first, second, tolerance)) return false;
    var dx = second.x - first.x, dy = second.y - first.y;
    var lengthSquared = dx * dx + dy * dy;
    var projection = (point.x - first.x) * dx + (point.y - first.y) * dy;
    return projection > tolerance && projection < lengthSquared - tolerance;
  }
  function pointLineDistance(point, first, second) {
    var dx = second.x - first.x, dy = second.y - first.y;
    var length = Math.hypot(dx, dy);
    return length ? Math.abs(cross(dx, dy, point.x - first.x, point.y - first.y)) / length : Infinity;
  }
  function circles(data) {
    return (data.circles || []).map(function (circle) {
      var center = data.points && data.points[circle[0]];
      var radiusPoint = data.points && data.points[circle[1]];
      return center && radiusPoint ? { name: circle[0], center: center, radius: distance(center, radiusPoint) } : null;
    }).filter(function (circle) { return circle && circle.radius > 0; });
  }
  function angles(data) {
    return (data.angles || []).map(function (angle) {
      if (!angle || angle.length < 3) return null;
      var value = angleAt(data.points || {}, angle[0], angle[1], angle[2]);
      return value == null ? null : { vertex: angle[0], first: angle[1], second: angle[2], value: value };
    }).filter(Boolean);
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
    if (kind === 'parallel_lines') {
      return (data.parallels || []).some(function (parallel) {
        var first = points[parallel.a || (parallel.seg && parallel.seg[0])];
        var second = points[parallel.b || (parallel.seg && parallel.seg[1])];
        var through = points[parallel.p];
        if (!first || !second || !through || distance(first, second) < 0.001) return false;
        var length = distance(first, second);
        var offset = Math.abs(cross(second.x - first.x, second.y - first.y,
          through.x - first.x, through.y - first.y)) / length;
        if (offset < 0.001) return false;
        var transversals = (data.segments || []).concat(data.lines || []);
        return transversals.some(function (segment) {
          var start = points[segment[0]], end = points[segment[1]];
          if (!start || !end || distance(start, end) < 0.001) return false;
          var dx = end.x - start.x, dy = end.y - start.y;
          var baselineDirection = { x: second.x - first.x, y: second.y - first.y };
          var denominator = cross(dx, dy, baselineDirection.x, baselineDirection.y);
          if (Math.abs(denominator) / (length * distance(start, end)) < 0.01) return false;
          var firstIntersection = cross(first.x - start.x, first.y - start.y,
            baselineDirection.x, baselineDirection.y) / denominator;
          var secondIntersection = cross(through.x - start.x, through.y - start.y,
            baselineDirection.x, baselineDirection.y) / denominator;
          return firstIntersection >= 0 && firstIntersection <= 1 &&
            secondIntersection >= 0 && secondIntersection <= 1;
        });
      });
    }
    if (kind === 'perpendicular_bisector_locus') {
      return (data.pbis || []).some(function (bisector) {
        var first = points[bisector[0]], second = points[bisector[1]];
        if (!first || !second) return false;
        return Object.keys(points).some(function (name) {
          if (name === bisector[0] || name === bisector[1]) return false;
          var candidate = points[name];
          var midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
          var dx = second.x - first.x, dy = second.y - first.y;
          var isPerpendicular = Math.abs((candidate.x - midpoint.x) * dx + (candidate.y - midpoint.y) * dy) <=
            Math.max(2, Math.hypot(dx, dy) * 1.5);
          if (!isPerpendicular) return false;
          var firstDistance = distance(candidate, first), secondDistance = distance(candidate, second);
          return Math.abs(firstDistance - secondDistance) <= Math.max(1.5, firstDistance * 0.015);
        });
      });
    }
    if (kind === 'angle_bisector_locus') {
      return (data.bisectors || []).some(function (bisector) {
        var vertex = points[bisector[0]], first = points[bisector[1]], second = points[bisector[2]];
        if (!vertex || !first || !second) return false;
        var ux = first.x - vertex.x, uy = first.y - vertex.y;
        var vx = second.x - vertex.x, vy = second.y - vertex.y;
        var ul = Math.hypot(ux, uy), vl = Math.hypot(vx, vy);
        if (!ul || !vl) return false;
        var dx = ux / ul + vx / vl, dy = uy / ul + vy / vl;
        var dl = Math.hypot(dx, dy);
        if (dl < 0.001) return false;
        dx /= dl; dy /= dl;
        return Object.keys(points).some(function (name) {
          if (name === bisector[0] || name === bisector[1] || name === bisector[2]) return false;
          var candidate = points[name];
          var along = (candidate.x - vertex.x) * dx + (candidate.y - vertex.y) * dy;
          if (along <= 1) return false;
          var lineError = Math.abs(cross(dx, dy, candidate.x - vertex.x, candidate.y - vertex.y));
          var firstDistance = pointLineDistance(candidate, vertex, first);
          var secondDistance = pointLineDistance(candidate, vertex, second);
          return lineError <= 2 && Math.abs(firstDistance - secondDistance) <= Math.max(2, firstDistance * 0.02);
        });
      });
    }
    if (kind === 'tangent_radius') {
      return (data.tangents || []).some(function (tangent) {
        var center = points[tangent[0]], contact = points[tangent[1]];
        if (!center || !contact) return false;
        return circles(data).some(function (circle) {
          return circle.name === tangent[0] &&
            Math.abs(distance(center, contact) - circle.radius) <= Math.max(1.5, circle.radius * 0.015);
        });
      });
    }
    if (kind === 'circle_chord_bisector') {
      return (data.pbis || []).some(function (bisector) {
        var first = points[bisector[0]], second = points[bisector[1]];
        if (!first || !second) return false;
        return circles(data).some(function (circle) {
          var centerOnBisector = Math.abs(
            (circle.center.x - (first.x + second.x) / 2) * (second.x - first.x) +
            (circle.center.y - (first.y + second.y) / 2) * (second.y - first.y)
          ) <= Math.max(2, distance(first, second) * 1.5);
          return centerOnBisector &&
            Math.abs(distance(circle.center, first) - circle.radius) <= Math.max(1.5, circle.radius * 0.015) &&
            Math.abs(distance(circle.center, second) - circle.radius) <= Math.max(1.5, circle.radius * 0.015);
        });
      });
    }
    if (kind === 'congruent_triangles' || kind === 'similar_triangles') {
      var allTriangles = candidates.filter(function (triangle) { return area(points, triangle) > 0.001; });
      for (var firstIndex = 0; firstIndex < allTriangles.length; firstIndex++) {
        for (var secondIndex = firstIndex + 1; secondIndex < allTriangles.length; secondIndex++) {
          var firstTriangle = allTriangles[firstIndex], secondTriangle = allTriangles[secondIndex];
          var permutations = [
            [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
          ];
          var matched = permutations.some(function (permutation) {
            var firstSides = [
              distance(points[firstTriangle[0]], points[firstTriangle[1]]),
              distance(points[firstTriangle[1]], points[firstTriangle[2]]),
              distance(points[firstTriangle[2]], points[firstTriangle[0]])
            ];
            var secondSides = [
              distance(points[secondTriangle[permutation[0]]], points[secondTriangle[permutation[1]]]),
              distance(points[secondTriangle[permutation[1]]], points[secondTriangle[permutation[2]]]),
              distance(points[secondTriangle[permutation[2]]], points[secondTriangle[permutation[0]]])
            ];
            if (firstSides.some(function (side) { return side < 0.001; })) return false;
            var scale = secondSides[0] / firstSides[0];
            var sideMatch = firstSides.every(function (side, index) {
              return Math.abs(secondSides[index] / side - scale) <= Math.max(0.015, scale * 0.015);
            });
            var angleMatch = firstTriangle.every(function (vertex, index) {
              var firstOthers = firstTriangle.filter(function (name) { return name !== vertex; });
              var secondVertex = secondTriangle[permutation[index]];
              var secondOthers = [secondTriangle[permutation[(index + 1) % 3]], secondTriangle[permutation[(index + 2) % 3]]];
              var firstAngle = angleAt(points, vertex, firstOthers[0], firstOthers[1]);
              var secondAngle = angleAt(points, secondVertex, secondOthers[0], secondOthers[1]);
              return firstAngle != null && secondAngle != null && Math.abs(firstAngle - secondAngle) <= 1.5;
            });
            var wantsCongruent = kind === 'congruent_triangles';
            return sideMatch && angleMatch && (wantsCongruent ? Math.abs(scale - 1) <= 0.015 : scale > 0.015);
          });
          if (matched) return true;
        }
      }
      return false;
    }
    if (kind === 'parallel_side_ratio') {
      var segmentPairs = data.segments || [];
      for (var ti = 0; ti < candidates.length; ti++) {
        var triangle = candidates[ti];
        for (var vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
          var apex = triangle[vertexIndex];
          var sideNames = triangle.filter(function (name) { return name !== apex; });
          for (var di = 0; di < sideNames.length; di++) {
            for (var ei = di + 1; ei < sideNames.length; ei++) {
              var dName = sideNames[di], eName = sideNames[ei];
              if (!hasSegment(data, dName, eName)) continue;
              Object.keys(points).forEach(function (dCandidate) {
                if (triangle.indexOf(dCandidate) >= 0 || !pointOnSegment(points[dCandidate], points[apex], points[dName], 1.5)) return;
                Object.keys(points).forEach(function (eCandidate) {
                  if (triangle.indexOf(eCandidate) >= 0 || eCandidate === dCandidate ||
                      !pointOnSegment(points[eCandidate], points[apex], points[eName], 1.5) ||
                      !hasSegment(data, dCandidate, eCandidate)) return;
                  var cut = { x: points[eCandidate].x - points[dCandidate].x, y: points[eCandidate].y - points[dCandidate].y };
                  var base = { x: points[eName].x - points[dName].x, y: points[eName].y - points[dName].y };
                  var cutLength = Math.hypot(cut.x, cut.y), baseLength = Math.hypot(base.x, base.y);
                  if (!cutLength || !baseLength || Math.abs(cross(cut.x, cut.y, base.x, base.y)) /
                      (cutLength * baseLength) > 0.015) return;
                  var firstRatio = distance(points[apex], points[dCandidate]) / distance(points[dCandidate], points[dName]);
                  var secondRatio = distance(points[apex], points[eCandidate]) / distance(points[eCandidate], points[eName]);
                  if (Number.isFinite(firstRatio) && Number.isFinite(secondRatio) &&
                      Math.abs(firstRatio - secondRatio) <= Math.max(0.03, firstRatio * 0.03)) triangle.__ratioFound = true;
                });
              });
              if (triangle.__ratioFound) { delete triangle.__ratioFound; return true; }
            }
          }
        }
      }
      return false;
    }
    if (kind === 'inscribed_angle') {
      var circleList = circles(data), measuredAngles = angles(data);
      return circleList.some(function (circle) {
        function isOnCircle(name) {
          return name !== circle.name && points[name] &&
            Math.abs(distance(circle.center, points[name]) - circle.radius) <= Math.max(1.5, circle.radius * 0.015);
        }
        return measuredAngles.some(function (central) {
          if (central.vertex !== circle.name || !isOnCircle(central.first) || !isOnCircle(central.second)) return false;
          return measuredAngles.some(function (inscribed) {
            if (inscribed.vertex === circle.name || !isOnCircle(inscribed.vertex)) return false;
            var endpoints = [inscribed.first, inscribed.second].sort().join('|');
            return endpoints === [central.first, central.second].sort().join('|') &&
              Math.abs(central.value - 2 * inscribed.value) <= 2;
          });
        });
      });
    }
    if (kind === 'parallelogram') {
      var names = Object.keys(points);
      for (var aIndex = 0; aIndex < names.length; aIndex++) {
        for (var bIndex = aIndex + 1; bIndex < names.length; bIndex++) {
          for (var cIndex = bIndex + 1; cIndex < names.length; cIndex++) {
            for (var dIndex = cIndex + 1; dIndex < names.length; dIndex++) {
              var quad = [names[aIndex], names[bIndex], names[cIndex], names[dIndex]];
              var orders = [[0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3]];
              if (orders.some(function (order) {
                var A = quad[order[0]], B = quad[order[1]], C = quad[order[2]], D = quad[order[3]];
                if (!hasSegment(data, A, B) || !hasSegment(data, B, C) ||
                    !hasSegment(data, C, D) || !hasSegment(data, D, A)) return false;
                var ab = { x: points[B].x - points[A].x, y: points[B].y - points[A].y };
                var dc = { x: points[C].x - points[D].x, y: points[C].y - points[D].y };
                var bc = { x: points[C].x - points[B].x, y: points[C].y - points[B].y };
                var ad = { x: points[D].x - points[A].x, y: points[D].y - points[A].y };
                return Math.abs(cross(ab.x, ab.y, dc.x, dc.y)) <= 0.015 * Math.hypot(ab.x, ab.y) * Math.hypot(dc.x, dc.y) &&
                  Math.abs(cross(bc.x, bc.y, ad.x, ad.y)) <= 0.015 * Math.hypot(bc.x, bc.y) * Math.hypot(ad.x, ad.y);
              })) return true;
            }
          }
        }
      }
      return false;
    }
    if (kind === 'triangle_exterior_angle') {
      var measured = angles(data);
      return candidates.some(function (triangle) {
        if (area(points, triangle) <= 0.001) return false;
        return triangle.some(function (vertex) {
          var adjacent = triangle.filter(function (name) { return name !== vertex; });
          return adjacent.some(function (side) {
            var remote = adjacent.filter(function (name) { return name !== side; })[0];
            return Object.keys(points).some(function (extension) {
              if (triangle.indexOf(extension) >= 0 || !pointOnSegmentLine(points[extension], points[side], points[vertex], 1.5)) return false;
              var sx = points[side].x - points[vertex].x, sy = points[side].y - points[vertex].y;
              var ex = points[extension].x - points[vertex].x, ey = points[extension].y - points[vertex].y;
              if (sx * ex + sy * ey >= 0 || !hasSegment(data, vertex, extension)) return false;
              var exterior = measured.filter(function (angle) {
                return angle.vertex === vertex &&
                  [angle.first, angle.second].indexOf(remote) >= 0 &&
                  [angle.first, angle.second].indexOf(extension) >= 0;
              })[0];
              var remoteFirst = angleAt(points, remote, vertex, side);
              var remoteSecond = angleAt(points, side, remote, vertex);
              return exterior && remoteFirst != null && remoteSecond != null &&
                Math.abs(exterior.value - remoteFirst - remoteSecond) <= 2;
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
          thales_right_angle: '直径に対する円周角が90°',
          parallel_lines: '作図した2直線が平行で横断線が交わる',
          perpendicular_bisector_locus: '垂直二等分線上の点は両端から等距離',
          angle_bisector_locus: '角の二等分線上の点は2辺から等距離',
          tangent_radius: '接点を通る半径と接線の関係',
          circle_chord_bisector: '弦の垂直二等分線が円の中心を通る',
          congruent_triangles: '2つの三角形の合同条件',
          similar_triangles: '2つの三角形の相似条件',
          parallel_side_ratio: '平行線で分けた線分の比',
          inscribed_angle: '同じ弧に対する中心角と円周角',
          parallelogram: '四角形の対辺がそれぞれ平行',
          triangle_exterior_angle: '三角形の外角と離れた内角の和'
        }[check.kind.slice(9)] || '図形の性質を確認');
      } else if (check.kind === 'has_check' || check.kind === 'has_theorem') {
        return { label: check.label || check.name || check.kind, ok: false, source: 'server-required' };
      } else {
        return { label: '未対応の確認条件: ' + check.kind, ok: false, source: 'unknown' };
      }
      return { label: label, ok: passed, source: check.kind.indexOf('geometry_') === 0 ? 'geometry' : 'activity' };
    }).filter(Boolean);
  }

  global.QuestValidation = { evaluate: evaluate };
})(window);
