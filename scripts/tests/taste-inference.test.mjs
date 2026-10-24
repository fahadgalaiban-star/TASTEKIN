import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_INFERRED_EDIT_TAGS,
  inferTasteTags,
  normalizeTasteTagIds,
  tasteTagIds,
  tasteTags,
} from '../../lib/taste-catalog/src/index.ts';

test('every catalog tag has English and Arabic keywords', () => {
  for (const tag of tasteTags) {
    assert.ok(tag.keywords.en.length >= 3, `${tag.id} needs English keywords`);
    assert.ok(tag.keywords.ar.length >= 3, `${tag.id} needs Arabic keywords`);
    for (const keyword of tag.keywords.en) assert.equal(keyword, keyword.toLowerCase(), `${tag.id}: English keywords are lowercase`);
  }
});

test('English caption → tags of the Edit category first, then other hits', () => {
  const tags = inferTasteTags({
    category: 'Restaurants',
    title: 'Slow Saturday',
    caption: 'A long lunch by the harbour, then a flat white at the little roaster next door.',
  });
  assert.deepEqual(tags.slice(0, 2), ['long-lunches', 'coffee-stops']);
  assert.ok(tags.includes('coastal-escapes'));
  assert.ok(tags.length <= MAX_INFERRED_EDIT_TAGS);
});

test('Arabic caption → tags (substring match copes with attached prefixes)', () => {
  const tags = inferTasteTags({
    category: 'Places',
    titleAr: 'دليل ٤٨ ساعة',
    captionAr: 'جولة في المتحف والمسجد القديم، وقهوة في مقهى صغير بعيد عن الزحمة.',
  });
  // city-guides: "دليل" + "48 ساعة" (Arabic-Indic digits folded); architecture: "متحف" + "مسجد".
  // Same category and hit count → catalog order puts city-guides first.
  assert.deepEqual(tags.slice(0, 2), ['city-guides', 'architecture']);
  assert.ok(tags.includes('coffee-stops'));
  assert.ok(tags.includes('hidden-gems'));
});

test('English keywords match whole words only', () => {
  // "lift" must not fire on "uplifting"; "sea" must not fire on "season".
  assert.deepEqual(inferTasteTags({ category: 'Books', caption: 'An uplifting season with a new reading list.' }), ['reading-lists']);
});

test('an Edit with no recognisable words gets no tags', () => {
  assert.deepEqual(inferTasteTags({ category: 'Fashion', title: 'Untitled', caption: '…' }), []);
});

test('the cap holds even for a caption that hits many tags', () => {
  const tags = inferTasteTags({
    category: 'DailyRoutine',
    caption: 'Morning ritual, weekly reset, slow living, coffee, perfume, skincare, strength, recovery, reading list, memoir.',
  });
  assert.equal(tags.length, MAX_INFERRED_EDIT_TAGS);
  assert.deepEqual(tags.slice(0, 3), ['morning-rituals', 'weekly-reset', 'slow-living']);
});

test('normalizeTasteTagIds keeps known ids in catalog order, dedupes and caps', () => {
  assert.deepEqual(normalizeTasteTagIds(['tailoring', 'nope', 'quiet-luxury', 'tailoring', 42]), ['quiet-luxury', 'tailoring']);
  assert.equal(normalizeTasteTagIds(tasteTagIds).length, 8);
  assert.equal(normalizeTasteTagIds(tasteTagIds, 16).length, 16);
});
