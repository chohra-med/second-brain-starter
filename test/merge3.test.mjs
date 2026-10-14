import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeThreeWay, splitLines, twoWayProposal } from '../lib/merge3.mjs';

const lines = (...items) => items.map((item) => `${item}\n`).join('');

test('splitLines keeps each line ending and a final line without one', () => {
  assert.deepEqual(splitLines('a\r\nb\nc'), ['a\r\n', 'b\n', 'c']);
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\n'), ['a\n']);
});

test('a change on one side only merges cleanly, from either side', () => {
  const base = lines('one', 'two', 'three');
  assert.deepEqual(mergeThreeWay(base, lines('one', 'TWO', 'three'), base), { clean: true, conflicts: 0, text: lines('one', 'TWO', 'three') });
  assert.deepEqual(mergeThreeWay(base, base, lines('one', 'two', 'THREE')), { clean: true, conflicts: 0, text: lines('one', 'two', 'THREE') });
});

test('separate edits on both sides merge cleanly', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');
  const local = lines('A', 'b', 'c', 'd', 'e');
  const template = lines('a', 'b', 'c', 'd', 'E');
  assert.equal(mergeThreeWay(base, local, template).text, lines('A', 'b', 'c', 'd', 'E'));
  const inserted = mergeThreeWay(base, lines('a', 'local line', 'b', 'c', 'd', 'e'), lines('a', 'b', 'c', 'd', 'template line', 'e'));
  assert.equal(inserted.clean, true);
  assert.equal(inserted.text, lines('a', 'local line', 'b', 'c', 'd', 'template line', 'e'));
});

test('the same change on both sides is clean', () => {
  const base = lines('a', 'b');
  const both = lines('a', 'B', 'new');
  assert.deepEqual(mergeThreeWay(base, both, both), { clean: true, conflicts: 0, text: both });
});

test('overlapping edits are a conflict rendered with all three versions', () => {
  const result = mergeThreeWay(lines('a', 'b', 'c'), lines('a', 'local edit', 'c'), lines('a', 'template edit', 'c'));
  assert.equal(result.clean, false);
  assert.equal(result.conflicts, 1);
  assert.equal(result.text, lines('a', '<<<<<<< local', 'local edit', '||||||| base', 'b', '=======', 'template edit', '>>>>>>> template', 'c'));
});

test('adjacent edits are a conflict, for lines and for words', () => {
  const adjacentLines = mergeThreeWay(lines('a', 'b', 'c', 'd'), lines('a', 'B local', 'c', 'd'), lines('a', 'b', 'C template', 'd'));
  assert.equal(adjacentLines.clean, false, 'lines b and c are adjacent, as in diff3');
  assert.match(adjacentLines.text, /<<<<<<< local/);
  const adjacentWords = mergeThreeWay(lines('alpha beta gamma'), lines('alpha BETA gamma'), lines('alpha beta GAMMA'));
  assert.equal(adjacentWords.clean, false, 'beta and gamma are adjacent words');
  const insertAfterEdit = mergeThreeWay(lines('Then the roadmap.'), lines('Then my roadmap.'), lines('Then the new roadmap.'));
  assert.equal(insertAfterEdit.clean, false, 'an insertion right after an edited word touches it');
  const separated = mergeThreeWay(lines('alpha beta gamma delta'), lines('alpha BETA gamma delta'), lines('alpha beta gamma DELTA'));
  assert.equal(separated.text, lines('alpha BETA gamma DELTA'), 'one unchanged word between two edits keeps them apart');
  const editAndInsert = mergeThreeWay(lines('x', 'the selected project folder', 'y'), lines('x', 'each selected project folder', 'y'), lines('x', 'the selected project folders', 'new line', 'y'));
  assert.deepEqual(editAndInsert, { clean: true, conflicts: 0, text: lines('x', 'each selected project folders', 'new line', 'y') });
});

test('word refinement merges separate edits within the same line, and refuses overlapping words', () => {
  const base = lines('Read the selected project folder you named.');
  const clean = mergeThreeWay(base, lines('Read each selected project folder you named.'), lines('Read the selected project folder you named today.'));
  assert.deepEqual(clean, { clean: true, conflicts: 0, text: lines('Read each selected project folder you named today.') });
  const overlap = mergeThreeWay(base, lines('Read each selected project folder you named.'), lines('Read one selected project folder you named.'));
  assert.equal(overlap.clean, false);
});

test('insertion at end of file from both sides', () => {
  const base = lines('a', 'b');
  assert.equal(mergeThreeWay(base, lines('a', 'b', 'local tail'), base).text, lines('a', 'b', 'local tail'));
  assert.equal(mergeThreeWay(base, base, lines('a', 'b', 'template tail')).text, lines('a', 'b', 'template tail'));
  const both = mergeThreeWay(base, lines('a', 'b', 'local tail'), lines('a', 'b', 'template tail'));
  assert.equal(both.clean, false, 'two different insertions at the same point conflict');
  const edited = mergeThreeWay(base, lines('A', 'b'), lines('a', 'b', 'template tail'));
  assert.equal(edited.text, lines('A', 'b', 'template tail'));
});

test('CRLF line endings are preserved byte for byte', () => {
  const base = 'a\r\nb\r\nc\r\n';
  const local = 'a\r\nB\r\nc\r\n';
  const template = 'a\r\nb\r\nc\r\nd\r\n';
  assert.equal(mergeThreeWay(base, local, template).text, 'a\r\nB\r\nc\r\nd\r\n');
  const conflict = mergeThreeWay(base, 'a\r\nX\r\nc\r\n', 'a\r\nY\r\nc\r\n');
  assert.equal(conflict.text.includes('\r\n=======\r\n'), true, 'markers use the file line ending');
  assert.equal(/[^\r]\n/.test(conflict.text), false, 'no bare LF is introduced');
});

test('a missing trailing newline is kept, and adding one is an ordinary change', () => {
  assert.equal(mergeThreeWay('a\nb', 'A\nb', 'a\nb').text, 'A\nb');
  assert.equal(mergeThreeWay('a\nx\nb', 'A\nx\nb', 'a\nx\nb\n').text, 'A\nx\nb\n');
  assert.equal(mergeThreeWay('a\nb\n', 'a\nb\n', 'a\nb').text, 'a\nb');
});

test('Buffer input is accepted and an empty base merges two creations only when equal', () => {
  assert.equal(mergeThreeWay(Buffer.from('x\n'), Buffer.from('x\ny\n'), Buffer.from('x\n')).text, 'x\ny\n');
  assert.equal(mergeThreeWay('', 'same\n', 'same\n').clean, true);
  assert.equal(mergeThreeWay('', 'mine\n', 'theirs\n').clean, false);
});

test('a two-way proposal marks the whole file when no base is known', () => {
  assert.equal(twoWayProposal('mine', 'theirs\n'), '<<<<<<< local\nmine\n=======\ntheirs\n>>>>>>> template\n');
});

test('two insertions at the same point merge on their common lines; only different lines at one gap conflict', () => {
  const base = lines('# Title', 'end');
  const shared = ['## Section', 'Shared paragraph.', ''];
  const local = lines('# Title', ...shared, '', 'end');
  const template = lines('# Title', ...shared, 'end');
  assert.deepEqual(mergeThreeWay(base, local, template), { clean: true, conflicts: 0, text: local }, 'an extra blank line on one side is a one-sided insertion');
  const linkLocal = lines('# Title', '## Section', 'See the [index](local.md).', 'More.', 'end');
  const linkTemplate = lines('# Title', '## Section', 'See the [index](Index.md).', 'More.', 'end');
  const narrowed = mergeThreeWay(base, linkLocal, linkTemplate);
  assert.equal(narrowed.clean, false);
  assert.equal(narrowed.conflicts, 1);
  assert.equal(narrowed.text, lines('# Title', '## Section', '<<<<<<< local', 'See the [index](local.md).', '||||||| base', '=======', 'See the [index](Index.md).', '>>>>>>> template', 'More.', 'end'), 'the conflict is narrowed to the one differing line');
  assert.equal(mergeThreeWay(base, lines('# Title', 'mine', 'end'), lines('# Title', 'theirs', 'end')).clean, false, 'nothing in common: still one conflict');
  const interleave = mergeThreeWay(base, lines('# Title', 'Local paragraph.', '', 'end'), lines('# Title', '', 'Template paragraph.', 'end'));
  assert.equal(interleave.clean, false, 'two different insertions sharing only a blank line are not interleaved');
});
