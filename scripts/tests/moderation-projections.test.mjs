import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyVisibility, blockedConsumerRequest, blockedReference, projectConsumerResponse } from '../../artifacts/api-server/src/lib/moderation-visibility.ts';
import { suspendedAccountAccess } from '../../artifacts/api-server/src/lib/suspended-account-access.ts';

function visibility() {
  const v = emptyVisibility();
  v.editIds.add('hidden'); v.commentIds.add('hidden-comment');
  v.userIds.add('suspended-user'); v.creatorIds.add('suspended-creator'); v.usernames.add('suspended');
  v.editTargets.set('author-id', new Set(['hidden']));
  v.creatorByUsername.set('author', 'author-id');
  v.media.add('/tastekin-media/hidden.webp');
  return v;
}
const hidden = { id: 'hidden', creatorUsername: 'author', title: 'Hidden caption' };
const visible = { id: 'visible', creatorUsername: 'author', title: 'Visible', metadata: { id: 'hidden', userId: 'suspended-user', caption: 'Unrelated metadata' } };

test('exact account-safety methods only, including prefix handling and hostile suffixes', () => {
  for (const p of ['/me', '/auth/user', '/logout', '/privacy', '/terms', '/support']) {
    assert.equal(suspendedAccountAccess('GET', p), true);
    assert.equal(suspendedAccountAccess('GET', '/api' + p), true);
    assert.equal(suspendedAccountAccess('PUT', p), false);
    assert.equal(suspendedAccountAccess('GET', p + '/extra'), false);
  }
  for (const p of ['/me/delete-account', '/auth/native/logout', '/auth/native/logout-all']) {
    assert.equal(suspendedAccountAccess('POST', p), true);
    assert.equal(suspendedAccountAccess('GET', p), false);
  }
  for (const p of ['/auth/login', '/auth/native/login', '/creator-workspace', '/storage/uploads', '/edits/visible/comments', '/relationships', '/conversations', '/me/saved-lists']) {
    assert.equal(suspendedAccountAccess('POST', p), false);
    assert.equal(suspendedAccountAccess('GET', p), false);
  }
  assert.equal(suspendedAccountAccess('HEAD', '/me'), false);
});
test('flat feeds remove actual hidden Edits, not nested metadata IDs', () => {
  const v = visibility();
  assert.deepEqual(projectConsumerResponse('/feed', [hidden, visible], v), [visible]);
  assert.deepEqual(projectConsumerResponse('/edits/visible', visible, v), visible);
  assert.equal(projectConsumerResponse('/edits/hidden', hidden, v), undefined);
});
test('public/Circle wrapped feeds preserve correct envelopes and unrelated creator/metadata IDs', () => {
  const v = visibility(), items = [{ creatorUsername: 'author', edit: hidden },
    { creatorUsername: 'author', edit: visible, metadata: { id: 'hidden' } },
    { creatorUsername: 'other', edit: { id: 'hidden', title: 'Different creator namespace' } },
    { creatorUsername: 'suspended', edit: { id: 'active' } }];
  assert.deepEqual(projectConsumerResponse('/public-feed', { items, metadata: { id: 'hidden' } }, v),
    { items: [items[1], items[2]], metadata: { id: 'hidden' } });
  assert.deepEqual(projectConsumerResponse('/circle/feed', items, v), [items[1], items[2]]);
});
test('profiles/discovery/taste-match remove suspended creators, not ordinary common IDs', () => {
  const v = visibility(), active = { creatorId: 'hidden', username: 'active', metadata: { userId: 'suspended-user' } },
    suspended = { creatorId: 'suspended-creator', username: 'suspended' };
  assert.deepEqual(projectConsumerResponse('/creators', [active, suspended], v), [active]);
  assert.deepEqual(projectConsumerResponse('/circle/members', [active, suspended], v), [active]);
  assert.equal(projectConsumerResponse('/creators/suspended/profile', suspended, v), undefined);
  assert.equal(projectConsumerResponse('/taste-match/suspended', { creator: suspended }, v), undefined);
  const match = { creator: active, preferences: { id: 'hidden' }, match: { id: 'hidden-comment' } };
  assert.equal(projectConsumerResponse('/taste-match/active', match, v), match);
});
test('workspaces and collections filter known edit references and cover assets, never Collection identity', () => {
  const v = visibility(), collection = { id: 'hidden', title: 'Keep collection title', editIds: ['hidden', 'visible'],
    coverImage: '/tastekin-media/hidden.webp', metadata: { id: 'hidden' } };
  const body = { profile: { username: 'author' }, edits: [hidden, visible], collections: [collection], revision: 8 };
  for (const path of ['/creators/author/workspace', '/creator-workspace']) {
    const out = projectConsumerResponse(path, body, v);
    assert.deepEqual(out.edits, [visible]); assert.equal(out.collections[0].id, 'hidden');
    assert.deepEqual(out.collections[0].editIds, ['visible']); assert.equal(out.collections[0].coverImage, '');
    assert.deepEqual(out.collections[0].metadata, { id: 'hidden' });
  }
  const profile = { username: 'author', edits: [hidden, visible], collections: [collection], editCount: 2 };
  assert.equal(projectConsumerResponse('/creators/author', profile, v).editCount, 1);
  assert.deepEqual(projectConsumerResponse('/creators/other', { edits: [{ id: 'hidden' }], collections: [] }, v).edits, [{ id: 'hidden' }]);
  const uploaded = { id: 'hidden', image: '/objects/own-upload', type: 'photo' };
  const realCollection = { id: 'hidden', title: 'Keep title', titleAr: '', description: '', descriptionAr: '',
    access: 'public', coverEditId: 'hidden', editIds: ['hidden', 'visible'], uploads: [uploaded],
    itemOrder: ['hidden', 'visible'], coverImageObjectPath: '/tastekin-media/hidden.webp' };
  const projected = projectConsumerResponse('/creators/author/workspace', { collections: [realCollection], edits: [] }, v).collections[0];
  assert.equal(projected.coverEditId, ''); assert.equal(projected.coverImageObjectPath, null);
  assert.deepEqual(projected.uploads, [uploaded]); assert.deepEqual(projected.itemOrder, ['hidden', 'visible']);
  // Discovery Collection is a summary, not a CreatorCollection.
  const summary = { id: 'hidden', creatorUsername: 'author', title: 'Keep title', description: 'Keep description',
    image: '/api/public-media/author/hidden', itemCount: 2, access: 'public' };
  assert.deepEqual(projectConsumerResponse('/explore', { collections: [summary] }, v).collections[0], { ...summary, image: '' });
  const featured = { collectionIds: ['hidden', 'visible'] };
  assert.equal(projectConsumerResponse('/creators/author/featured-collections', featured, v), featured);
});
test('Explore real envelope filters creators/Edits/collections but leaves taxonomy/products/place IDs', () => {
  const v = visibility(), body = { authenticated: true, sort: 'match', creators: [{ username: 'suspended' }, { username: 'active' }],
    edits: [hidden, visible], collections: [{ id: 'hidden', editIds: ['hidden', 'visible'], creatorUsername: 'author' }],
    places: ['hidden'], products: [{ id: 'hidden', caption: 'Keep product' }] };
  const out = projectConsumerResponse('/explore', body, v);
  assert.deepEqual(out.edits, [visible]); assert.deepEqual(out.creators, [{ username: 'active' }]);
  assert.deepEqual(out.places, body.places); assert.deepEqual(out.products, body.products);
  assert.deepEqual(out.collections[0].editIds, ['visible']);
});
test('comments use comment namespace; engagement counters are not recursively filtered', () => {
  const v = visibility(), comments = [{ id: 'hidden-comment', body: 'Hidden' }, { id: 'hidden', body: 'Unrelated comment ID namespace' }];
  assert.deepEqual(projectConsumerResponse('/edits/visible/comments', comments, v), [comments[1]]);
  const engagement = { editId: 'visible', counts: { id: 'hidden', userId: 'suspended-user', likes: 3 } };
  assert.equal(projectConsumerResponse('/edits/visible/engagement', engagement, v), engagement);
  assert.equal(blockedConsumerRequest('/edits/hidden/engagement', null, v), true);
  assert.equal(blockedConsumerRequest('/edits/%68idden/comments', null, v), true);
  assert.equal(blockedConsumerRequest('/edits/visible/comments/hidden-comment', null, v), true);
});
test('Saved/list identity survives coincident IDs; only declared Edit IDs are removed', () => {
  const v = visibility(), lists = [{ id: 'hidden', name: 'Keep list', editIds: ['hidden', 'visible'], metadata: { id: 'hidden' } }];
  assert.deepEqual(projectConsumerResponse('/me/saved-edits', ['hidden', 'visible'], v), ['visible']);
  const out = projectConsumerResponse('/me/saved-lists', lists, v);
  assert.equal(out[0].id, 'hidden'); assert.equal(out[0].name, 'Keep list'); assert.deepEqual(out[0].editIds, ['visible']);
  assert.equal(blockedConsumerRequest('/me/saved-lists/hidden', {}, v), false);
  assert.equal(blockedConsumerRequest('/me/saved-lists/hidden/edits/hidden', {}, v), true);
});
test('KIN snapshots/results drop retained blocked provenance, not provider/closet/trip IDs or free text', () => {
  const v = visibility(), blocked = { id: 'snapshot', answer: 'Copied hidden text', citations: [{ title: 'Source', url: '/api/public-media/author/hidden' }] },
    safe = { id: 'hidden', answer: 'Safe text', citations: [{ url: 'https://provider.invalid/edits/hidden' }],
      options: [{ id: 'hidden', items: [{ id: 'hidden' }] }] };
  assert.deepEqual(projectConsumerResponse('/kin/saved', { items: [blocked, safe] }, v), { items: [safe] });
  assert.equal(projectConsumerResponse('/kin/search', blocked, v), undefined);
  assert.equal(blockedConsumerRequest('/kin/saved', blocked, v), true);
  assert.equal(blockedConsumerRequest('/kin/looks/generate', { stylingItemIds: ['hidden'] }, v), false);
  const trips = { id: 'hidden', items: [{ id: 'hidden-comment', placeId: 'hidden', notes: 'Copied text without provenance' }] };
  assert.equal(projectConsumerResponse('/kin/trips/hidden', trips, v), trips);
  assert.equal(blockedConsumerRequest('/kin/trips/hidden', {}, v), false);
});
test('public media/relationships enforce their exact target namespace; external URL lookalikes survive', () => {
  const v = visibility();
  assert.equal(blockedConsumerRequest('/public-media/author/hidden', {}, v), true);
  assert.equal(blockedConsumerRequest('/public-media/other/hidden', {}, v), false);
  assert.equal(blockedConsumerRequest('/public-profile-media/suspended/avatar', {}, v), true);
  assert.equal(blockedConsumerRequest('/relationships', { type: 'follow', targetId: 'suspended' }, v), true);
  assert.equal(blockedConsumerRequest('/relationships', { type: 'follow', targetId: 'hidden' }, v), false);
  assert.equal(blockedReference('https://provider.invalid/edits/hidden', v), false);
  v.trustedOrigins.add('https://app.invalid');
  assert.equal(blockedReference('https://app.invalid/api/edits/hidden', v), true);
});
test('admin inspection and unrelated/private response objects are never redacted', () => {
  const v = visibility(), body = { id: 'hidden', target: hidden, history: [{ id: 'hidden-comment' }], userId: 'suspended-user' };
  assert.equal(projectConsumerResponse('/admin/reports/fixture/inspection', body, v), body);
  assert.equal(projectConsumerResponse('/unrelated', body, v), body);
  assert.equal(blockedConsumerRequest('/admin/reports/hidden/inspection', body, v), false);
});