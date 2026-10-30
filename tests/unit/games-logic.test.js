const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../games-logic.js');

test('seeded random is repeatable', () => {
  const a = G.seeded(7), b = G.seeded(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('memory deck has each face exactly twice', () => {
  const deck = G.memoryDeck(6, G.seeded(1));
  assert.equal(deck.length, 12);
  const counts = {};
  deck.forEach((c) => { counts[c.face] = (counts[c.face] || 0) + 1; });
  assert.ok(Object.values(counts).every((n) => n === 2));
  assert.equal(Object.keys(counts).length, 6);
});

for (const n of [4, 6, 9]) {
  test(`sudoku ${n}x${n}: solutions are valid for many seeds`, () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sol = G.sudokuSolution(n, G.seeded(seed));
      assert.ok(G.sudokuSolved(sol), `seed ${seed}`);
    }
  });
}

test('sudoku puzzle keeps the right share of cells and matches its solution', () => {
  const { puzzle, solution } = G.sudokuPuzzle(9, 0.55, G.seeded(3));
  const shown = puzzle.flat().filter(Boolean).length;
  assert.equal(shown, Math.round(81 * 0.55));
  puzzle.forEach((row, r) => row.forEach((v, c) => { if (v) assert.equal(v, solution[r][c]); }));
  assert.equal(G.sudokuSolved(puzzle), false);
});

test('sudoku clashes: row, column and box', () => {
  const g = [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  assert.equal(G.sudokuClashes(g, 0, 3, 1), true, 'row');
  assert.equal(G.sudokuClashes(g, 3, 0, 1), true, 'column');
  assert.equal(G.sudokuClashes(g, 1, 1, 1), true, 'box');
  assert.equal(G.sudokuClashes(g, 2, 2, 1), false, 'free spot');
  assert.equal(G.sudokuClashes(g, 0, 0, 1), false, 'a cell does not clash with itself');
});

test('solitaire deal: 28 on the table with tops face up, 24 in the stock, all 52 different', () => {
  const s = G.solitaireDeal(G.seeded(5));
  assert.deepEqual(s.tableau.map((p) => p.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(s.tableau.every((p) => p[p.length - 1].up && p.slice(0, -1).every((c) => !c.up)));
  assert.equal(s.stock.length, 24);
  const all = [...s.tableau.flat(), ...s.stock].map(G.cardLabel);
  assert.equal(new Set(all).size, 52);
});

test('solitaire placement rules', () => {
  const c = (rank, suit, up = true) => ({ rank, suit, up });
  assert.ok(G.fitsTableau(c(12, '♥'), [c(13, '♠')]), 'red queen on black king');
  assert.ok(!G.fitsTableau(c(12, '♠'), [c(13, '♣')]), 'not same colour');
  assert.ok(G.fitsTableau(c(13, '♦'), []), 'king on empty');
  assert.ok(!G.fitsTableau(c(5, '♦'), []), 'only kings on empty');
  assert.ok(G.fitsFoundation(c(1, '♣'), []), 'ace starts a foundation');
  assert.ok(G.fitsFoundation(c(2, '♣'), [c(1, '♣')]));
  assert.ok(!G.fitsFoundation(c(2, '♥'), [c(1, '♣')]));
});

test('solitaire tap moves an ace home and flips the card under it', () => {
  const c = (rank, suit, up) => ({ rank, suit, up });
  const state = { tableau: [[c(9, '♠', false), c(1, '♥', true)], [], [], [], [], [], []], stock: [], waste: [], foundations: [[], [], [], []], moves: 0 };
  const next = G.solitaireAutoMove(state, { from: 'tableau', pile: 0, index: 1 });
  assert.equal(next.foundations.flat().length, 1);
  assert.equal(next.tableau[0][0].up, true);
  assert.equal(state.tableau[0].length, 2, 'original state is not changed');
});

test('solitaire moves a run of cards together, and refuses a move that does not fit', () => {
  const c = (rank, suit, up = true) => ({ rank, suit, up });
  const state = { tableau: [[c(8, '♥'), c(7, '♠')], [c(9, '♣')], [c(4, '♦')], [], [], [], []], stock: [], waste: [], foundations: [[], [], [], []], moves: 0 };
  const next = G.solitaireAutoMove(state, { from: 'tableau', pile: 0, index: 0 });
  assert.deepEqual(next.tableau[1].map(G.cardLabel), ['9♣', '8♥', '7♠']);
  assert.equal(G.solitaireAutoMove(state, { from: 'tableau', pile: 2, index: 0 }), null);
});

test('solitaire draw turns one card, then recycles the waste', () => {
  let s = { tableau: [[], [], [], [], [], [], []], stock: [{ rank: 3, suit: '♠', up: false }, { rank: 4, suit: '♥', up: false }], waste: [], foundations: [[], [], [], []], moves: 0 };
  s = G.solitaireDraw(s); s = G.solitaireDraw(s);
  assert.equal(s.stock.length, 0); assert.equal(s.waste.length, 2); assert.ok(s.waste.every((c) => c.up));
  s = G.solitaireDraw(s);
  assert.equal(s.stock.length, 2); assert.equal(s.waste.length, 0); assert.ok(s.stock.every((c) => !c.up));
});

test('tile match: every deal can be finished by always taking a hinted pair', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rand = G.seeded(seed);
    let tiles = G.tileDeal(rand);
    assert.ok(tiles, `deal ${seed}`);
    assert.equal(tiles.length, 34);
    let guard = 0;
    while (!G.tileWon(tiles) && guard++ < 100) {
      let hint = G.tileHint(tiles);
      if (!hint) { tiles = G.tileShuffle(tiles, rand); hint = G.tileHint(tiles); }
      assert.ok(hint, `seed ${seed} got stuck even after a shuffle`);
      tiles = tiles.map((t) => (hint.includes(t.id) ? { ...t, gone: true } : t));
    }
    assert.ok(G.tileWon(tiles), `seed ${seed} finished`);
  }
});

test('tile match: a covered tile or one blocked on both sides is not free', () => {
  const tiles = G.tileLayout().map((t) => ({ ...t, gone: false, face: 'x' }));
  const middleBottom = tiles.find((t) => t.z === 0 && t.x === 2 && t.y === 1);
  const leftEdge = tiles.find((t) => t.z === 0 && t.x === 0 && t.y === 0);
  const blocked = tiles.find((t) => t.z === 0 && t.x === 2 && t.y === 0);
  assert.equal(G.tileFree(middleBottom, tiles), false, 'covered');
  assert.equal(G.tileFree(leftEdge, tiles), true, 'open on the left');
  assert.equal(G.tileFree(blocked, tiles), false, 'blocked both sides');
  assert.equal(G.tileCanPair(leftEdge, leftEdge, tiles), false, 'a tile cannot pair with itself');
});

test('tile match: a dead end of stacked tiles is laid flat by Shuffle', () => {
  const tiles = G.tileLayout().map((t) => ({ ...t, gone: true, face: 'x' }));
  const under = tiles.find((t) => t.z === 0 && t.x === 2 && t.y === 1);
  const over = tiles.find((t) => t.z === 1 && t.x === 2 && t.y === 1);
  under.gone = false; over.gone = false;
  assert.equal(G.tileHint(tiles), null, 'stuck: only the top tile is free');
  const fixed = G.tileShuffle(tiles, G.seeded(2));
  assert.ok(G.tileHint(fixed), 'after Shuffle a pair can be taken');
});
