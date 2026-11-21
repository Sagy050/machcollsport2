(function (global) {
  'use strict';

  var PAGE_W = 595.28, PAGE_H = 841.89, MARGIN = 38;
  var palette = global.SportsDayHousePalette;
  var hex = function (value) {
    var match = /^#?([0-9a-f]{6})$/i.exec(value || '');
    if (!match) return [0.4, 0.4, 0.4];
    var n = parseInt(match[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };
  var clean = function (value) {
    return String(value == null ? '' : value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, ' ');
  };
  var safeName = function (value) {
    return String(value || 'sports-day-results').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'sports-day-results';
  };

  function PdfReport(state) {
    this.state = state;
    this.pages = [];
    this.pageNumber = 0;
    this.startPage();
  }

  PdfReport.prototype.startPage = function () {
    this.pageNumber++;
    this.commands = [];
    this.pages.push(this.commands);
    this.y = 56;
    var title = this.state.settings.title || 'Sports Day Results';
    this.text(title, MARGIN, 30, 15, [0.06, 0.11, 0.2], true, null, true);
    this.text('MACHABENG COLLEGE  |  ' + (this.state.settings.date || ''), PAGE_W - MARGIN, 30, 8, [0.34, 0.4, 0.49], false, 'right');
    this.line(MARGIN, 43, PAGE_W - MARGIN, 43, [0.12, 0.17, 0.25], 1.4);
    this.text((this.state.settings.finalised ? 'FINAL RESULTS' : 'RESULTS') + '  |  PAGE ' + this.pageNumber, PAGE_W - MARGIN, PAGE_H - 20, 7, [0.4, 0.44, 0.5], false, 'right');
  };

  PdfReport.prototype.text = function (value, x, y, size, color, bold, align, display) {
    this.commands.push({
      type: 'text', text: clean(value), x: x, y: y, size: size, color: color,
      bold: !!bold, align: align, display: !!display,
    });
  };

  PdfReport.prototype.rect = function (x, y, w, h, color) {
    this.commands.push({ type: 'rect', x: x, y: y, width: w, height: h, color: color });
  };

  PdfReport.prototype.line = function (x1, y1, x2, y2, color, width) {
    this.commands.push({
      type: 'line', x1: x1, y1: y1, x2: x2, y2: y2, color: color, width: width || 0.6,
    });
  };

  PdfReport.prototype.ensure = function (height) {
    if (this.y + height > PAGE_H - 42) this.startPage();
  };

  PdfReport.prototype.section = function (title) {
    this.ensure(34);
    this.y += 8;
    this.rect(MARGIN, this.y - 12, 4, 19, [0.08, 0.55, 0.37]);
    this.text(title, MARGIN + 12, this.y + 2, 14, [0.06, 0.11, 0.2], true, null, true);
    this.y += 20;
  };

  PdfReport.prototype.columnHeaders = function (cells, widths) {
    this.ensure(18);
    var x = MARGIN + 12;
    for (var i = 0; i < cells.length; i++) {
      var right = i > 0;
      this.text(cells[i], right ? x + widths[i] : x, this.y + 3, 7, [0.38, 0.43, 0.5], true, right ? 'right' : null);
      x += widths[i] + 8;
    }
    this.y += 13;
  };

  PdfReport.prototype.house = function (id) {
    var list = this.state.houses || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { name: '—', color: '#64748b' };
  };

  PdfReport.prototype.houseRow = function (y, house, cells, widths, height) {
    var color = hex(palette.color(house));
    var light = color.map(function (channel) { return channel * 0.12 + 0.88; });
    this.rect(MARGIN, y - 11, PAGE_W - MARGIN * 2, height, light);
    this.rect(MARGIN, y - 11, 4, height, color);
    var x = MARGIN + 12;
    for (var i = 0; i < cells.length; i++) {
      var right = i > 0 && (i === 2 || i === 3 || i === 4 || i === 5);
      this.text(cells[i], right ? x + widths[i] : x, y + 3, 9, [0.1, 0.14, 0.2], i === 0 || i === 1, right ? 'right' : null);
      x += widths[i] + 8;
    }
    this.y = y + height - 11;
  };

  PdfReport.prototype.houseChart = function (rows) {
    var max = Math.max.apply(null, rows.map(function (row) { return row.points; }).concat([1]));
    var trackX = MARGIN + 92, trackW = PAGE_W - MARGIN * 2 - 150;
    this.ensure(rows.length * 15 + 4);
    rows.forEach(function (row) {
      var y = this.y + 7, color = hex(palette.color(row.house));
      var barWidth = row.points ? Math.max(2, trackW * row.points / max) : 0;
      this.text(row.house.name, MARGIN + 12, y + 2, 8, [0.2, 0.25, 0.32], true);
      this.rect(trackX, y - 5, trackW, 9, [0.93, 0.95, 0.97]);
      if (barWidth) this.rect(trackX, y - 5, barWidth, 9, color);
      this.text(String(row.points), trackX + trackW + 12, y + 2, 9, [0.1, 0.14, 0.2], true);
      this.y += 15;
    }, this);
    this.y += 2;
  };

  PdfReport.prototype.pointsByHouse = function (event) {
    return (this.state.houses || []).map(function (house) {
      var points = (event.entries || []).reduce(function (total, entry) {
        return total + (entry.house_id === house.id && Number.isFinite(entry.points) ? entry.points : 0);
      }, 0);
      return { house: house, points: points };
    });
  };

  PdfReport.prototype.awardRows = function (title, items, describe) {
    this.section(title);
    var widths = [220, 70, 100, 55];
    this.columnHeaders(['ATHLETE', 'HOUSE', 'AWARD', 'POINTS'], widths);
    if (!items.length) {
      this.text('No awards yet.', MARGIN + 12, this.y, 9, [0.4, 0.44, 0.5], false);
      this.y += 16;
      return;
    }
    var self = this;
    items.forEach(function (item) {
      var house = self.house(item.house_id);
      self.ensure(20);
      self.houseRow(self.y + 11, house, [item.name, house.name, describe(item), String(item.points)], widths, 19);
    });
    this.y += 7;
  };

  PdfReport.prototype.render = function () {
    var s = this.state, standings = s.standings || [], awards = s.awards || {};
    var scoredResults = (s.events || []).reduce(function (total, event) {
      return total + (event.entries || []).filter(function (entry) { return entry.position !== null; }).length;
    }, 0);
    var seenAthletes = new Set(), duplicateEntries = 0, statusCounts = {};
    (s.events || []).forEach(function (event) {
      (event.entries || []).forEach(function (entry) {
        if (entry.status !== 'ok') statusCounts[entry.status] = (statusCounts[entry.status] || 0) + 1;
        if (entry.athlete_id == null) return;
        var key = event.id + ':' + entry.athlete_id;
        if (seenAthletes.has(key)) duplicateEntries++;
        seenAthletes.add(key);
      });
    });
    if (s.settings.finalised && s.winner && s.winner.length) {
      var winnerNames = s.winner.map(function (id) { return this.house(id).name; }, this).join(' & ');
      this.rect(MARGIN, this.y, PAGE_W - MARGIN * 2, 28, [1, 0.96, 0.83]);
      this.text('CHAMPIONS  |  ' + winnerNames, MARGIN + 12, this.y + 18, 12, [0.4, 0.25, 0.02], true, null, true);
      this.y += 40;
    }
    this.section('Overall house ranking');
    var self = this;
    this.columnHeaders(['RANK', 'HOUSE', 'POINTS', 'GOLD', 'SILVER', 'BRONZE'], [26, 180, 80, 40, 40, 40]);
    standings.forEach(function (house) {
      self.ensure(26);
      self.houseRow(self.y + 11, house, [
        '#' + house.rank, house.name, String(house.points), String(house.gold), String(house.silver), String(house.bronze),
      ], [26, 180, 80, 40, 40, 40], 23);
    });
    this.y += 4;
    this.text((s.progress.done || 0) + ' of ' + (s.progress.total || 0) +
      ' events complete. Ties are separated by golds, silvers, then bronzes.', MARGIN, this.y + 5, 8, [0.36, 0.4, 0.47], false);
    this.y += 16;
    this.text('POINTS BY HOUSE', MARGIN + 12, this.y + 3, 7, [0.38, 0.43, 0.5], true);
    this.y += 6;
    this.houseChart(standings.map(function (house) {
      return { house: this.house(house.house_id), points: house.points };
    }, this));
    var leader = standings[0], runnerUp = standings[1];
    var analysis = scoredResults + ' ranked results';
    if (leader && runnerUp) analysis += '  |  ' + leader.name + ' lead by ' + (leader.points - runnerUp.points) + ' points over ' + runnerUp.name;
    var statusSummary = Object.keys(statusCounts).map(function (status) {
      return statusCounts[status] + ' ' + status.toUpperCase();
    }).join(', ');
    if (statusSummary) analysis += '  |  ' + statusSummary + ' (0 points)';
    analysis += duplicateEntries ? '  |  ' + duplicateEntries + ' duplicate individual entries found' : '  |  no duplicate individual entries found';
    this.ensure(18);
    this.text(analysis, MARGIN, this.y + 3, 8, [0.36, 0.4, 0.47], false);
    this.y += 14;

    this.section('Individual awards');
    this.awardRows('Top athletes overall', awards.topAthletes || [], function (a) {
      return '#' + a.rank + (a.level ? ' ' + a.level : '');
    });
    this.awardRows('Best performer in each house', (awards.bestPerHouse || []).map(function (item) {
      return item.athlete ? Object.assign({ house_id: item.house_id }, item.athlete) : {
        name: 'No scored athlete', house_id: item.house_id, points: 0, rank: '',
      };
    }), function (a) { return a.joint ? 'Joint best' : 'Best in house'; });
    this.awardRows('Age-group champions', awards.ageGroups || [], function (a) {
      return a.label + (a.joint ? ' (joint)' : '');
    });

    this.section('Event results');
    (s.events || []).forEach(function (event) {
      var entries = event.entries || [];
      var division = event.gender ? (event.gender === 'F' ? 'Girls' : 'Boys') : event.level === 'Mixed' ? '' : 'Mixed';
      self.ensure(90);
      self.y += 2;
      self.text(event.name + '  |  ' + event.level + (division ? ' ' + division : '') +
        (event.kind === 'relay' ? '  |  RELAY' : ''), MARGIN, self.y, 10, [0.08, 0.13, 0.22], true, null, true);
      self.y += 16;
      self.text('POINTS BY HOUSE', MARGIN + 8, self.y + 2, 7, [0.38, 0.43, 0.5], true);
      self.y += 5;
      self.houseChart(self.pointsByHouse(event));
      if (!entries.length) {
        self.text('No results.', MARGIN + 8, self.y, 8, [0.4, 0.44, 0.5], false);
        self.y += 14;
        return;
      }
      entries.forEach(function (entry) {
        self.ensure(20);
        var house = self.house(entry.house_id);
        var place = entry.status !== 'ok' ? entry.status.toUpperCase() : entry.position === null ? '—' : String(entry.position);
        var details = place + '  |  ' + entry.name + '  |  ' + house.name +
          (event.measure === 'distance' && entry.performance ? '  |  ' + entry.performance : '') +
          '  |  ' + entry.points + ' pts';
        self.houseRow(self.y + 10, house, [details], [PAGE_W - MARGIN * 2 - 30], 18);
      });
      self.y += 6;
    });

    this.section('Points system');
    this.text((s.settings.scheme.points || []).map(function (points, index) {
      return (index + 1) + (index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th') + ' = ' + points;
    }).join(', ') + ', then ' + s.settings.scheme.rest + ' point(s). DNS, DNF and DQ score 0.', MARGIN, this.y, 8, [0.28, 0.33, 0.4], false);
    this.y += 16;
  };

  var resourcesPromise = null;
  var preparedPdfs = new WeakMap();
  var preparingPdfs = new WeakMap();
  var loadFont = function (path) {
    return global.fetch(path).then(function (response) {
      if (!response.ok) throw new Error('Could not load PDF font ' + path + ' (' + response.status + ').');
      return response.arrayBuffer();
    });
  };
  var loadResources = function () {
    if (!resourcesPromise) {
      resourcesPromise = Promise.all([
        import('https://esm.sh/pdf-lib@1.17.1?bundle'),
        import('https://esm.sh/@pdf-lib/fontkit@1.1.1?bundle'),
        loadFont('https://fonts.gstatic.com/s/figtree/v9/_Xmz-HUzqDCFdgfMsYiV_F7wfS-Bs_dNQF5e.ttf'),
        loadFont('https://fonts.gstatic.com/s/figtree/v9/_Xmz-HUzqDCFdgfMsYiV_F7wfS-Bs_eYR15e.ttf'),
        loadFont('https://fonts.gstatic.com/s/bigshouldersdisplay/v24/fC1MPZJEZG-e9gHhdI4-NBbfd2ys3SjJCx12wPgf9g-_3F0YdSY8JF4.ttf'),
      ]).then(function (values) {
        return {
          pdfLib: values[0],
          fontkit: values[1].default || values[1],
          regular: values[2],
          bold: values[3],
          display: values[4],
        };
      }).catch(function (error) {
        resourcesPromise = null;
        throw error;
      });
    }
    return resourcesPromise;
  };

  PdfReport.prototype.toBlob = async function () {
    var resources = await loadResources();
    var PDFDocument = resources.pdfLib.PDFDocument;
    var rgb = resources.pdfLib.rgb;
    var document = await PDFDocument.create();
    document.registerFontkit(resources.fontkit);
    var fonts = await Promise.all([
      document.embedFont(resources.regular, { subset: true }),
      document.embedFont(resources.bold, { subset: true }),
      document.embedFont(resources.display, { subset: true }),
    ]);
    this.pages.forEach(function (commands) {
      var page = document.addPage([PAGE_W, PAGE_H]);
      commands.forEach(function (command) {
        var color = rgb(command.color[0], command.color[1], command.color[2]);
        if (command.type === 'text') {
          var font = command.display ? fonts[2] : command.bold ? fonts[1] : fonts[0];
          var x = command.x, width = font.widthOfTextAtSize(command.text, command.size);
          if (command.align === 'right') x -= width;
          else if (command.align === 'center') x -= width / 2;
          page.drawText(command.text, {
            x: x, y: PAGE_H - command.y, size: command.size, font: font, color: color,
          });
        } else if (command.type === 'rect') {
          page.drawRectangle({
            x: command.x, y: PAGE_H - command.y - command.height,
            width: command.width, height: command.height, color: color,
          });
        } else {
          page.drawLine({
            start: { x: command.x1, y: PAGE_H - command.y1 },
            end: { x: command.x2, y: PAGE_H - command.y2 },
            thickness: command.width, color: color,
          });
        }
      });
    });
    return new Blob([await document.save()], { type: 'application/pdf' });
  };

  global.SportsDayReportPdf = Object.freeze({
    prepare: function (state) {
      if (preparedPdfs.has(state)) return Promise.resolve(preparedPdfs.get(state));
      if (preparingPdfs.has(state)) return preparingPdfs.get(state);
      var promise = loadResources().then(function () {
        var report = new PdfReport(state);
        report.render();
        return report.toBlob();
      }).then(function (blob) {
        preparedPdfs.set(state, blob);
        return blob;
      }).finally(function () {
        preparingPdfs.delete(state);
      });
      preparingPdfs.set(state, promise);
      return promise;
    },
    createDownloadLink: function (state) {
      var blob = preparedPdfs.get(state);
      if (!blob) throw new Error('The results PDF is not ready yet.');
      return {
        url: URL.createObjectURL(blob),
        filename: safeName(state.settings.title) + '-results.pdf',
      };
    },
  });
})(window);
