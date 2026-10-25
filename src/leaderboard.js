/* ===========================================================
   leaderboard.js - two boards, both stored on this device.

   The overall board is the top 10 times, damage or not. The
   second board only takes runs that arrived with the whole load
   intact, and it keeps its own store: a perfect 39s run would
   otherwise be pushed off the overall board by four scrappy 31s
   ones and the thing it is there to celebrate would vanish.

   Every storage call is guarded: private-browsing just means
   scores are not kept, never a crash.
   =========================================================== */
(function (M) {
  'use strict';

  /* The .hard suffix is history, not a setting: when the menu offered
     two cities these keys held the 172 m one. That is the only city now,
     so the board carries straight on from the times already saved under
     them rather than starting empty. */
  var KEY = 'mudita.leaderboard.v1.hard';
  var KEY_P = 'mudita.leaderboard.perfect.v1.hard';
  var MAX = 10;
  var MAX_P = 10;
  var PERFECT = 100;          /* cargo % that counts as a full load */

  var LB = M.Leaderboard = {
    available: true,

    /* ---- storage ---- */
    read: function (key) {
      try {
        var raw = localStorage.getItem(key);
        if (!raw) return [];
        var list = JSON.parse(raw);
        return Array.isArray(list) ? list.filter(valid) : [];
      } catch (e) {
        this.available = false;
        return [];
      }
    },

    write: function (key, list, cap) {
      try {
        localStorage.setItem(key, JSON.stringify(list.slice(0, cap)));
      } catch (e) {
        this.available = false;
      }
    },

    load: function () { return this.read(KEY); },
    loadPerfect: function () { return this.read(KEY_P); },
    save: function (list) { this.write(KEY, list, MAX); },

    /* returns the index the run landed at on the overall board, or -1 */
    add: function (entry) {
      var rec = {
        name: String(entry.name || 'ANON').slice(0, 14).toUpperCase(),
        time: +entry.time,
        cargo: Math.round(entry.cargo),
        score: Math.round(entry.score),
        at: Date.now()
      };

      if (rec.cargo >= PERFECT) {
        var p = this.loadPerfect();
        p.push(rec);
        p.sort(byTime);
        this.write(KEY_P, p, MAX_P);
      }

      var list = this.load();
      list.push(rec);
      list.sort(byTime);
      list = list.slice(0, MAX);
      this.save(list);
      return list.indexOf(rec);
    },

    clear: function () {
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(KEY_P);
      } catch (e) { /* ignore */ }
    },

    best: function () {
      var l = this.load();
      return l.length ? l[0].time : null;
    },

    bestPerfect: function () {
      var l = this.loadPerfect();
      return l.length ? l[0].time : null;
    },

    /* would this run make either board? a full load gets its own shot */
    qualifies: function (time, cargo) {
      if (makes(this.load(), time, MAX)) return true;
      if (cargo != null && Math.round(cargo) >= PERFECT &&
          makes(this.loadPerfect(), time, MAX_P)) return true;
      return false;
    },

    render: function (fresh) {
      this.renderInto('board', this.load(), fresh, false);
      this.renderInto('board-perfect', this.loadPerfect(), fresh, true);
    },

    renderInto: function (id, list, fresh, gold) {
      var el = document.getElementById(id);
      if (!el) return;

      if (!list.length) {
        el.innerHTML = '<div class="lb-empty">' +
          (this.available
            ? (gold
              ? 'No full loads yet.<br>Arrive with cargo integrity at 100% to appear here.'
              : 'No runs recorded yet.<br>Deliver the donations in under 40 seconds to get on the board.')
            : 'Storage is blocked in this browser, so times cannot be saved.') +
          '</div>';
        return;
      }

      /* `fresh` is the index on the overall board, so highlighting the
         same row number on the perfect board would light up a stranger.
         Match the run itself instead. */
      var mark = -1;
      if (fresh >= 0) {
        var ref = gold ? this.load()[fresh] : list[fresh];
        if (ref) {
          for (var k = 0; k < list.length; k++) {
            if (list[k].at === ref.at) { mark = k; break; }
          }
        }
      }

      var html = '';
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        html += '<div class="lb-row' + (gold ? ' gold' : '') +
          (i < 3 ? ' top' : '') + (i === mark ? ' fresh' : '') + '">' +
          '<span class="pos">' + (i + 1) + '</span>' +
          '<span class="nm">' + esc(r.name) + '</span>' +
          (gold ? '' : '<span class="cg">' + r.cargo + '%</span>') +
          '<span class="tm">' + M.util.fmtTime(r.time) + 's</span>' +
          '</div>';
      }
      el.innerHTML = html;
    }
  };

  function byTime(a, b) { return a.time - b.time; }
  function makes(list, time, cap) {
    return list.length < cap || time < list[list.length - 1].time;
  }
  function valid(r) {
    return r && typeof r.time === 'number' && isFinite(r.time) && typeof r.name === 'string';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})(window.MUD);
