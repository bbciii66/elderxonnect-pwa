/* Built-in games: Memory Match, Sudoku, Solitaire and Tile Match. No ads, no sign-up, works offline.
   Each game opens full screen with a big ✕ Close button. Rules live in games-logic.js. */
(function () {
  'use strict';
  var G = window.GamesLogic;
  if (!G) return;
  var $ = function (id) { return document.getElementById(id); };
  var rand = Math.random;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function award(points) {
    try { if (typeof gameScore !== 'undefined') { gameScore += points; if (typeof updateScore === 'function') updateScore(); } } catch (e) {}
  }
  function say(msg) { if (typeof window.toast === 'function') window.toast(msg); }

  // ── Full-screen stage ──
  var current = null;
  function openStage(title, start) {
    var stage = $('gameStage');
    $('stageTitle').textContent = title;
    $('stageBody').innerHTML = '';
    stage.classList.remove('hidden');
    document.documentElement.classList.add('stage-open');
    current = title;
    try { history.pushState({ excGame: true }, ''); } catch (e) {}
    start($('stageBody'));
    $('stageClose').focus();
  }
  function closeStage(fromHistory) {
    var stage = $('gameStage');
    if (!stage || stage.classList.contains('hidden')) return;
    stage.classList.add('hidden');
    document.documentElement.classList.remove('stage-open');
    $('stageBody').innerHTML = '';
    current = null;
    if (!fromHistory) { try { if (history.state && history.state.excGame) history.back(); } catch (e) {} }
  }
  window.addEventListener('popstate', function () { closeStage(true); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeStage(); });

  function toolbar(body, buttons) {
    var bar = el('div', 'stage-tools');
    buttons.forEach(function (b) {
      var btn = el('button', 'btn ' + (b.cls || 'ghost'), b.label); btn.type = 'button'; btn.addEventListener('click', b.onClick);
      if (b.id) btn.id = b.id;
      bar.appendChild(btn);
    });
    body.appendChild(bar);
    return bar;
  }
  function winBanner(body, text, again) {
    var box = el('div', 'stage-win');
    box.appendChild(el('div', 'stage-win-title', '🎉 ' + text));
    var btn = el('button', 'btn green', 'Play again'); btn.type = 'button'; btn.addEventListener('click', again);
    box.appendChild(btn);
    body.prepend(box);
    btn.focus();
  }

  // ── Memory Match ──
  function memory(body, pairs) {
    pairs = pairs || 6;
    body.innerHTML = '';
    var deck = G.memoryDeck(pairs, rand), open = [], moves = 0, found = 0, busy = false;
    var status = el('p', 'stage-status', 'Find the matching pairs. Tap two cards.');
    body.appendChild(status);
    var grid = el('div', 'mm-grid mm-' + pairs); body.appendChild(grid);
    deck.forEach(function (card) {
      var b = el('button', 'mm-card'); b.type = 'button'; b.setAttribute('aria-label', 'Hidden card');
      b.dataset.id = card.id;
      b.addEventListener('click', function () {
        if (busy || card.matched || open.indexOf(card) !== -1) return;
        b.classList.add('up'); b.textContent = card.face; b.setAttribute('aria-label', card.face);
        open.push(card);
        if (open.length < 2) return;
        moves++;
        var a = open[0], c = open[1];
        if (a.face === c.face) {
          a.matched = c.matched = true; found++; open = [];
          grid.querySelectorAll('[data-id="' + a.id + '"],[data-id="' + c.id + '"]').forEach(function (x) { x.classList.add('done'); x.disabled = true; });
          status.textContent = found === pairs ? 'All pairs found in ' + moves + ' tries!' : 'A match! ' + (pairs - found) + ' to go.';
          if (found === pairs) { award(10); winBanner(body, 'You found them all!', function () { memory(body, pairs); }); }
        } else {
          busy = true; status.textContent = 'Not a match. Try to remember them.';
          setTimeout(function () {
            grid.querySelectorAll('[data-id="' + a.id + '"],[data-id="' + c.id + '"]').forEach(function (x) { x.classList.remove('up'); x.textContent = ''; x.setAttribute('aria-label', 'Hidden card'); });
            open = []; busy = false;
          }, 1100);
        }
      });
      grid.appendChild(b);
    });
    toolbar(body, [
      { label: 'Easier (6 pairs)', onClick: function () { memory(body, 6); } },
      { label: 'Harder (8 pairs)', onClick: function () { memory(body, 8); } },
    ]);
  }

  // ── Sudoku ──
  function sudoku(body, n) {
    n = n || 4;
    body.innerHTML = '';
    var keep = n === 9 ? 0.55 : 0.5;
    var game = G.sudokuPuzzle(n, keep, rand);
    var grid = game.puzzle.map(function (r) { return r.slice(); });
    var sel = null, done = false;
    var status = el('p', 'stage-status', 'Fill every row, column and box with 1 to ' + n + '. Tap a square, then a number.');
    body.appendChild(status);
    var board = el('div', 'sd-board sd-' + n); body.appendChild(board);
    var box = G.SUDOKU_BOX[n];
    function draw() {
      board.innerHTML = '';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) (function (r, c) {
        var given = !!game.puzzle[r][c], v = grid[r][c];
        var b = el('button', 'sd-cell' + (given ? ' given' : '') + (sel && sel[0] === r && sel[1] === c ? ' sel' : '') +
          (v && !given && G.sudokuClashes(grid, r, c, v) ? ' clash' : '') +
          ((c + 1) % box[1] === 0 && c < n - 1 ? ' edge-r' : '') + ((r + 1) % box[0] === 0 && r < n - 1 ? ' edge-b' : ''), v ? String(v) : '');
        b.type = 'button';
        b.setAttribute('aria-label', 'Row ' + (r + 1) + ', column ' + (c + 1) + (v ? ', ' + v : ', empty') + (given ? ', given' : ''));
        b.disabled = given || done;
        b.addEventListener('click', function () { sel = [r, c]; draw(); });
        board.appendChild(b);
      })(r, c);
    }
    function put(v) {
      if (!sel || done) { status.textContent = 'Tap an empty square first.'; return; }
      grid[sel[0]][sel[1]] = v;
      draw();
      if (v && G.sudokuClashes(grid, sel[0], sel[1], v)) status.textContent = 'That number is already in this row, column or box.';
      else status.textContent = 'Keep going!';
      if (G.sudokuSolved(grid)) { done = true; draw(); award(10); status.textContent = 'Solved!'; winBanner(body, 'Puzzle solved!', function () { sudoku(body, n); }); }
    }
    draw();
    var pad = el('div', 'sd-pad sd-pad-' + n);
    for (var i = 1; i <= n; i++) (function (i) { var b = el('button', 'btn ghost', String(i)); b.type = 'button'; b.addEventListener('click', function () { put(i); }); pad.appendChild(b); })(i);
    var erase = el('button', 'btn ghost', 'Erase'); erase.type = 'button'; erase.addEventListener('click', function () { put(0); }); pad.appendChild(erase);
    body.appendChild(pad);
    toolbar(body, [
      { label: 'Small 4×4', onClick: function () { sudoku(body, 4); } },
      { label: 'Medium 6×6', onClick: function () { sudoku(body, 6); } },
      { label: 'Full 9×9', onClick: function () { sudoku(body, 9); } },
    ]);
  }

  // ── Solitaire ──
  function solitaire(body) {
    body.innerHTML = '';
    var state = G.solitaireDeal(rand), undo = [];
    var status = el('p', 'stage-status', 'Tap a card to move it. Tap the deck to turn a card.');
    var table = el('div', 'sol-table');
    body.appendChild(status); body.appendChild(table);
    function apply(next, fail) {
      if (!next) { status.textContent = fail || 'That card can’t move yet.'; return; }
      undo.push(state); if (undo.length > 200) undo.shift();
      state = next; status.textContent = 'Moves: ' + state.moves;
      draw();
      if (G.solitaireWon(state)) { award(20); winBanner(body, 'You won Solitaire!', function () { solitaire(body); }); }
    }
    function cardEl(card, onClick) {
      var b = el('button', 'sol-card' + (card.up ? (G.isRed(card) ? ' red' : ' black') : ' back'), card.up ? G.cardLabel(card) : '');
      b.type = 'button';
      b.setAttribute('aria-label', card.up ? G.cardLabel(card) : 'Face-down card');
      if (onClick) b.addEventListener('click', onClick); else b.disabled = !card.up;
      return b;
    }
    function slot(label) { var s = el('div', 'sol-slot', label || ''); return s; }
    function draw() {
      table.innerHTML = '';
      var top = el('div', 'sol-top');
      var stock = state.stock.length ? cardEl({ up: false }, function () { apply(G.solitaireDraw(state)); }) : el('button', 'sol-slot sol-recycle', state.waste.length ? '↺' : '');
      if (!state.stock.length) { stock.type = 'button'; stock.setAttribute('aria-label', 'Turn the deck over'); stock.addEventListener('click', function () { apply(G.solitaireDraw(state), 'The deck is empty.'); }); }
      else stock.setAttribute('aria-label', 'Deck, ' + state.stock.length + ' cards. Tap to turn one.');
      top.appendChild(stock);
      var w = state.waste[state.waste.length - 1];
      top.appendChild(w ? cardEl(w, function () { apply(G.solitaireAutoMove(state, { from: 'waste' })); }) : slot());
      top.appendChild(el('div', 'sol-gap'));
      state.foundations.forEach(function (f, i) {
        var t = f[f.length - 1];
        top.appendChild(t ? cardEl(t, function () { apply(G.solitaireAutoMove(state, { from: 'foundation', pile: i })); }) : slot('A'));
      });
      table.appendChild(top);
      var piles = el('div', 'sol-piles');
      state.tableau.forEach(function (pile, p) {
        var col = el('div', 'sol-pile');
        if (!pile.length) col.appendChild(slot('K'));
        pile.forEach(function (card, i) {
          var c = cardEl(card, card.up ? function () { apply(G.solitaireAutoMove(state, { from: 'tableau', pile: p, index: i })); } : null);
          c.style.top = (pile.slice(0, i).reduce(function (y, k) { return y + (k.up ? 30 : 12); }, 0)) + 'px';
          col.appendChild(c);
        });
        col.style.height = (pile.reduce(function (y, k) { return y + (k.up ? 30 : 12); }, 0) + 72) + 'px';
        piles.appendChild(col);
      });
      table.appendChild(piles);
    }
    draw();
    toolbar(body, [
      { label: '↩ Undo', onClick: function () { if (undo.length) { state = undo.pop(); status.textContent = 'Undone.'; draw(); } } },
      { label: 'New game', onClick: function () { solitaire(body); } },
    ]);
  }

  // ── Tile Match (mahjong-style) ──
  function tiles(body) {
    body.innerHTML = '';
    var set = G.tileDeal(rand), pick = null;
    var status = el('p', 'stage-status', 'Match two tiles that look the same. Bright tiles can be picked; dim tiles are blocked.');
    var board = el('div', 'tm-board');
    body.appendChild(status); body.appendChild(board);
    function draw(hint) {
      board.innerHTML = '';
      set.filter(function (t) { return !t.gone; }).sort(function (a, b) { return a.z - b.z || a.y - b.y || a.x - b.x; }).forEach(function (t) {
        var free = G.tileFree(t, set);
        var b = el('button', 'tm-tile' + (free ? ' free' : '') + (pick && pick.id === t.id ? ' sel' : '') + (hint && hint.indexOf(t.id) !== -1 ? ' hint' : ''), t.face);
        b.type = 'button';
        b.style.setProperty('--x', t.x); b.style.setProperty('--y', t.y); b.style.setProperty('--z', t.z);
        b.setAttribute('aria-label', t.face + (free ? '' : ', blocked'));
        b.addEventListener('click', function () {
          if (!free) { status.textContent = 'That tile is blocked. Pick a bright one.'; return; }
          if (!pick || pick.id === t.id) { pick = pick && pick.id === t.id ? null : t; draw(); return; }
          if (G.tileCanPair(pick, t, set)) {
            var a = pick.id, c = t.id;
            set = set.map(function (x) { return x.id === a || x.id === c ? Object.assign({}, x, { gone: true }) : x; });
            pick = null;
            var left = set.filter(function (x) { return !x.gone; }).length;
            status.textContent = left ? left + ' tiles left.' : 'All cleared!';
            draw();
            if (G.tileWon(set)) { award(15); winBanner(body, 'Board cleared!', function () { tiles(body); }); }
            else if (!G.tileHint(set)) status.textContent = 'No matches left. Tap Shuffle to mix the tiles.';
          } else { pick = t; status.textContent = 'Those don’t match. Try another.'; draw(); }
        });
        board.appendChild(b);
      });
    }
    draw();
    toolbar(body, [
      { label: '💡 Hint', onClick: function () { var h = G.tileHint(set); if (h) { status.textContent = 'Try the two glowing tiles.'; draw(h); } else status.textContent = 'No matches left. Tap Shuffle.'; } },
      { label: '🔀 Shuffle', onClick: function () { set = G.tileShuffle(set, rand); pick = null; status.textContent = 'Tiles mixed.'; draw(); } },
      { label: 'New game', onClick: function () { tiles(body); } },
    ]);
  }

  var GAMES = {
    match: ['Memory Match', function (b) { memory(b, 6); }],
    sudoku: ['Sudoku', function (b) { sudoku(b, 4); }],
    solitaire: ['Solitaire', solitaire],
    tiles: ['Tile Match', tiles],
  };
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-game]');
    if (t && GAMES[t.dataset.game]) { var g = GAMES[t.dataset.game]; openStage(g[0], g[1]); }
    if (e.target.closest && e.target.closest('#stageClose')) closeStage();
  });
  window.ExcGames = { open: function (key) { var g = GAMES[key]; if (g) openStage(g[0], g[1]); }, close: closeStage, isOpen: function () { return !!current; } };
})();
