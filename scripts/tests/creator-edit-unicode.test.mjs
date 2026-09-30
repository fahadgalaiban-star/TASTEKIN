import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editTextForSave, fullEditCaption, summarizeEditTitle } from '../../artifacts/tastekin/src/lib/edit-text.ts';
import { containsUnpairedSurrogate } from '../../artifacts/api-server/src/lib/unicode-validation.ts';
import { SaveCreatorWorkspaceBody, SaveCreatorWorkspaceResponse } from '../../lib/api-zod/src/generated/api.ts';

function saveAndRead(caption, previous = {}) {
  const form = { caption, captionAr: caption, title: previous.title || '', titleAr: previous.titleAr || '', placeName: null };
  const edit = {
    id: 'edit-1', category: 'Fashion', ...editTextForSave(form),
    location: '', locationAr: '', altText: '', access: 'public', status: 'draft', collectionIds: [],
  };
  // Exercise both generated request and response schemas without opening a database.
  const request = SaveCreatorWorkspaceBody.parse(JSON.parse(JSON.stringify({
    edits: [edit], collections: [], expectedRevision: 1,
  })));
  const response = SaveCreatorWorkspaceResponse.parse({
    ...request, creatorId: 'test-creator', revision: 2, updatedAt: new Date(),
  });
  assert.equal(request.edits[0].caption, caption);
  assert.equal(response.edits[0].caption, caption);
  assert.equal(response.edits[0].captionAr, caption);
  assert.equal(fullEditCaption(response.edits[0], false), caption);
  assert.equal(fullEditCaption(response.edits[0], true), caption);
  assert.ok(response.edits[0].title.length <= 160);
  assert.equal(containsUnpairedSurrogate(response.edits), false);
  return response.edits[0];
}

test('flag crossing the old 80-code-unit boundary never breaks a hidden title or its full caption', () => {
  const caption = `${'a'.repeat(78)} 🇺🇸 A visit to Grand Central`;
  assert.equal(caption.slice(0, 80).charCodeAt(79), 0xd83c);
  const edit = saveAndRead(caption);
  assert.ok(edit.title.includes('🇺🇸'));
  assert.equal(edit.caption, caption);
});

for (const [name, caption] of [
  ['skin-tone modifier', `${'x'.repeat(78)} 👍🏽 and more words`],
  ['family emoji sequence', `${'x'.repeat(78)} 👨‍👩‍👧‍👦 and more words`],
  ['Arabic and English with emoji', `${'مرحبًا بالعالم 🌙 English '.repeat(7)}نهاية`],
  ['multiline caption', 'First line\nسطر ثانٍ 🇺🇸\nThird line with combining e\u0301'],
  ['very long normal caption', 'A complete sentence with details. '.repeat(450)],
]) {
  test(`${name}: full caption survives workspace request and response`, () => {
    const edit = saveAndRead(caption);
    assert.equal(edit.caption, caption);
    if (name === 'skin-tone modifier') assert.ok(edit.title.includes('👍🏽'));
    if (name === 'family emoji sequence') assert.ok(edit.title.includes('👨‍👩‍👧‍👦'));
  });
}

test('editing and re-saving a long existing caption updates only the hidden summary', () => {
  const oldCaption = 'An earlier long caption '.repeat(150);
  const firstSave = saveAndRead(oldCaption);
  const editedCaption = `${'New text '.repeat(140)}\nنهاية 🇺🇸`;
  const secondSave = saveAndRead(editedCaption, firstSave);
  assert.notEqual(secondSave.title, firstSave.title);
  assert.equal(secondSave.caption, editedCaption);
  assert.equal(secondSave.captionAr, editedCaption);
});

test('combining marks and emoji clusters are not separated by Intl.Segmenter', () => {
  assert.equal(summarizeEditTitle(`${'x'.repeat(79)}e\u0301 rest`), `${'x'.repeat(79)}e\u0301`);
  assert.equal(summarizeEditTitle(`${'x'.repeat(79)}👨‍👩‍👧‍👦 rest`), `${'x'.repeat(79)}👨‍👩‍👧‍👦`);
});

test('code-point fallback never creates an unpaired surrogate', () => {
  const segmenter = Intl.Segmenter;
  try {
    Intl.Segmenter = undefined;
    const summary = summarizeEditTitle(`${'x'.repeat(79)}🇺🇸\ud83c`);
    assert.equal(containsUnpairedSurrogate(summary), false);
  } finally {
    Intl.Segmenter = segmenter;
  }
});

test('server guard rejects malformed nested Unicode and accepts valid pairs', () => {
  assert.equal(containsUnpairedSurrogate({ edits: [{ caption: `hello \ud83c` }] }), true);
  assert.equal(containsUnpairedSurrogate({ edits: [{ titleAr: `\udcfa` }] }), true);
  assert.equal(containsUnpairedSurrogate({ collections: [{ title: `\ud83cX` }] }), true);
  assert.equal(containsUnpairedSurrogate({ edits: [{ caption: 'مرحبا 🇺🇸 👨‍👩‍👧‍👦 e\u0301' }] }), false);
});