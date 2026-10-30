/* Rules for the built-in games (Memory Match, Sudoku, Solitaire, Tile Match), kept apart from the screen so they can be tested alone.
   Everything takes a random function so tests can use a fixed seed. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GamesLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Small seeded random number generator (mulberry32).
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ── Memory Match ──
  const MATCH_FACES = ['🌻', '🍎', '🐶', '🐱', '🚗', '⛵', '🎈', '🌙', '🍰', '🎵', '🐦', '🌈'];
  function memoryDeck(pairs, rand) {
    const faces = shuffle(MATCH_FACES, rand).slice(0, pairs);
    return shuffle(faces.concat(faces), rand).map((face, i) => ({ id: i, face, matched: false }));
  }

  // ── Sudoku ──
  // Sizes: 4 (2x2 boxes), 6 (2 rows x 3 cols), 9 (3x3).
  const SUDOKU_BOX = { 4: [2, 2], 6: [2, 3], 9: [3, 3] };
  function sudokuSolution(n, rand) {
    const [R, C] = SUDOKU_BOX[n];
    const pattern = (r, c) => (C * (r % R) + Math.floor(r / R) + c) % n;
    const bandRows = (bands, size) => shuffle([...Array(bands).keys()], rand).flatMap((b) => shuffle([...Array(size).keys()], rand).map((i) => b * size + i));
    const rows = bandRows(n / R, R), cols = bandRows(n / C, C);
    const digits = shuffle([...Array(n).keys()].map((d) => d + 1), rand);
    return rows.map((r) => cols.map((c) => digits[pattern(r, c)]));
  }
  // Puzzle: 0 means empty. `keep` is the share of cells shown at the start.
  function sudokuPuzzle(n, keep, rand) {
    const solution = sudokuSolution(n, rand);
    const cells = shuffle([...Array(n * n).keys()], rand);
    const shown = new Set(cells.slice(0, Math.round(n * n * keep)));
    const puzzle = solution.map((row, r) => row.map((v, c) => (shown.has(r * n + c) ? v : 0)));
    return { n, solution, puzzle };
  }
  // A number clashes when the same number is already in its row, column or box.
  function sudokuClashes(grid, r, c, v) {
    const n = grid.length, [R, C] = SUDOKU_BOX[n];
    if (!v) return false;
    for (let i = 0; i < n; i++) {
      if (i !== c && grid[r][i] === v) return true;
      if (i !== r && grid[i][c] === v) return true;
    }
    const br = Math.floor(r / R) * R, bc = Math.floor(c / C) * C;
    for (let i = br; i < br + R; i++) for (let j = bc; j < bc + C; j++) if ((i !== r || j !== c) && grid[i][j] === v) return true;
    return false;
  }
  // Solved when every cell is filled and nothing clashes (any valid answer counts).
  function sudokuSolved(grid) {
    return grid.every((row, r) => row.every((v, c) => v && !sudokuClashes(grid, r, c, v)));
  }

  // ── Solitaire (Klondike, draw one) ──
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RED = { '♥': true, '♦': true };
  const RANK_LABEL = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  function newDeck() { return SUITS.flatMap((suit) => [...Array(13).keys()].map((i) => ({ rank: i + 1, suit, up: false }))); }
  function solitaireDeal(rand) {
    const deck = shuffle(newDeck(), rand).map((c) => ({ ...c }));
    const tableau = [];
    for (let p = 0; p < 7; p++) {
      const pile = deck.splice(0, p + 1);
      pile[pile.length - 1].up = true;
      tableau.push(pile);
    }
    return { tableau, stock: deck, waste: [], foundations: [[], [], [], []], moves: 0 };
  }
  function isRed(card) { return !!RED[card.suit]; }
  function fitsTableau(card, pile) {
    const top = pile[pile.length - 1];
    if (!top) return card.rank === 13;
    return top.up && top.rank === card.rank + 1 && isRed(top) !== isRed(card);
  }
  function fitsFoundation(card, pile) {
    const top = pile[pile.length - 1];
    if (!top) return card.rank === 1;
    return top.suit === card.suit && top.rank === card.rank - 1;
  }
  function clone(state) {
    return {
      tableau: state.tableau.map((p) => p.map((c) => ({ ...c }))),
      stock: state.stock.map((c) => ({ ...c })),
      waste: state.waste.map((c) => ({ ...c })),
      foundations: state.foundations.map((p) => p.map((c) => ({ ...c }))),
      moves: state.moves,
    };
  }
  function flipTops(s) { s.tableau.forEach((p) => { if (p.length && !p[p.length - 1].up) p[p.length - 1].up = true; }); }
  // Tap the stock: turn one card over, or turn the waste back over when the stock is empty.
  function solitaireDraw(state) {
    const s = clone(state);
    if (s.stock.length) { const c = s.stock.pop(); c.up = true; s.waste.push(c); }
    else if (s.waste.length) { s.stock = s.waste.reverse().map((c) => ({ ...c, up: false })); s.waste = []; }
    else return null;
    s.moves++;
    return s;
  }
  // Tap a card: move it (and the cards on top of it) to the best place it fits.
  // from: { from: 'waste' } | { from: 'tableau', pile, index } | { from: 'foundation', pile }
  function solitaireAutoMove(state, from) {
    const s = clone(state);
    let cards;
    if (from.from === 'waste') { if (!s.waste.length) return null; cards = [s.waste[s.waste.length - 1]]; }
    else if (from.from === 'tableau') {
      const pile = s.tableau[from.pile];
      if (!pile || !pile[from.index] || !pile[from.index].up) return null;
      cards = pile.slice(from.index);
    } else if (from.from === 'foundation') {
      const pile = s.foundations[from.pile]; if (!pile || !pile.length) return null; cards = [pile[pile.length - 1]];
    } else return null;
    const lead = cards[0];
    const take = () => {
      if (from.from === 'waste') s.waste.pop();
      else if (from.from === 'tableau') s.tableau[from.pile].splice(from.index);
      else s.foundations[from.pile].pop();
    };
    if (cards.length === 1 && from.from !== 'foundation') {
      const f = s.foundations.findIndex((p) => fitsFoundation(lead, p));
      if (f !== -1) { take(); s.foundations[f].push(lead); flipTops(s); s.moves++; return s; }
    }
    // Prefer a pile that already has cards, so a king does not hop between empty spaces.
    const order = s.tableau.map((p, i) => i).filter((i) => !(from.from === 'tableau' && i === from.pile))
      .sort((a, b) => (s.tableau[a].length ? 0 : 1) - (s.tableau[b].length ? 0 : 1));
    for (const t of order) {
      if (fitsTableau(lead, s.tableau[t])) {
        if (from.from === 'tableau' && lead.rank === 13 && from.index === 0 && !s.tableau[t].length) continue;
        take(); s.tableau[t].push(...cards); flipTops(s); s.moves++; return s;
      }
    }
    return null;
  }
  function solitaireWon(state) { return state.foundations.every((p) => p.length === 13); }
  function cardLabel(card) { return RANK_LABEL[card.rank] + card.suit; }

  // ── Tile Match (mahjong-style) ──
  // Three layers: 6x4, then 4x2 on top, then 2x1 on top. A tile is free when nothing sits on it
  // and its left or right side is open.
  const TILE_FACES = ['🌸', '🍀', '🍊', '🐟', '🌟', '🍇', '🐞', '🌵', '🍄'];
  function tileLayout() {
    const out = [];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) out.push({ x, y, z: 0 });
    for (let y = 1; y < 3; y++) for (let x = 1; x < 5; x++) out.push({ x, y, z: 1 });
    for (let x = 2; x < 4; x++) out.push({ x, y: 1, z: 2 });
    return out.map((t, i) => ({ ...t, id: i }));
  }
  function tileFree(tile, tiles) {
    const live = tiles.filter((t) => !t.gone && t.id !== tile.id);
    if (live.some((t) => t.z === tile.z + 1 && t.x === tile.x && t.y === tile.y)) return false;
    const left = live.some((t) => t.z === tile.z && t.y === tile.y && t.x === tile.x - 1);
    const right = live.some((t) => t.z === tile.z && t.y === tile.y && t.x === tile.x + 1);
    return !left || !right;
  }
  // Faces are given out by taking tiles away in a legal order, so every game can be finished.
  function assignFaces(tiles, rand) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const work = tiles.map((t) => ({ ...t, gone: !!t.gone, face: t.face }));
      const order = shuffle(TILE_FACES, rand);
      let k = 0, ok = true;
      while (work.some((t) => !t.gone)) {
        const free = shuffle(work.filter((t) => !t.gone && tileFree(t, work)), rand);
        if (free.length < 2) { ok = false; break; }
        const face = order[k++ % order.length];
        free[0].face = face; free[1].face = face; free[0].gone = true; free[1].gone = true;
      }
      if (ok) return tiles.map((t) => (t.gone ? t : { ...t, face: work.find((w) => w.id === t.id).face }));
    }
    return null;
  }
  function tileDeal(rand) { return assignFaces(tileLayout().map((t) => ({ ...t, gone: false })), rand); }
  function tileCanPair(a, b, tiles) {
    return !!a && !!b && a.id !== b.id && !a.gone && !b.gone && a.face === b.face && tileFree(a, tiles) && tileFree(b, tiles);
  }
  function freePairs(tiles) {
    const free = tiles.filter((t) => !t.gone && tileFree(t, tiles)), out = [];
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) if (free[i].face === free[j].face) out.push([free[i].id, free[j].id]);
    return out;
  }
  // Hint: a matching free pair, preferring one that still lets the game be finished.
  function tileHint(tiles) {
    const pairs = freePairs(tiles);
    if (!pairs.length) return null;
    let budget = 20000;
    const seen = new Set();
    const finishable = (state) => {
      if (state.every((t) => t.gone)) return true;
      const key = state.map((t) => (t.gone ? 1 : 0)).join('');
      if (seen.has(key) || budget-- <= 0) return false;
      seen.add(key);
      return freePairs(state).some((pair) => finishable(state.map((t) => (pair.includes(t.id) ? { ...t, gone: true } : t))));
    };
    for (const pair of pairs) if (finishable(tiles.map((t) => (pair.includes(t.id) ? { ...t, gone: true } : t)))) return pair;
    return pairs[0];
  }
  // Stuck? Mix the faces of the tiles that are left, keeping the game finishable. If the tiles that
  // are left are stacked so no order can clear them, lay them out flat first.
  function tileShuffle(tiles, rand) {
    let left = tiles.filter((t) => !t.gone).map((t) => ({ ...t }));
    let mixed = assignFaces(left, rand);
    if (!mixed && left.length <= 24) {
      const spots = tileLayout().filter((t) => t.z === 0);
      left = left.map((t, i) => ({ ...t, x: spots[i].x, y: spots[i].y, z: 0 }));
      mixed = assignFaces(left, rand);
      if (!mixed) return tiles;
    }
    const byId = new Map(mixed.map((t) => [t.id, t]));
    return tiles.map((t) => (t.gone ? t : { ...byId.get(t.id) }));
  }
  function tileWon(tiles) { return tiles.every((t) => t.gone); }

  return {
    seeded, shuffle,
    MATCH_FACES, memoryDeck,
    SUDOKU_BOX, sudokuSolution, sudokuPuzzle, sudokuClashes, sudokuSolved,
    newDeck, solitaireDeal, fitsTableau, fitsFoundation, solitaireDraw, solitaireAutoMove, solitaireWon, cardLabel, isRed,
    tileLayout, tileFree, tileDeal, tileCanPair, tileHint, tileShuffle, tileWon,
  };
});
