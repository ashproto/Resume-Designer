import test from 'node:test';
import assert from 'node:assert/strict';
import { previewDispatchTag, parsePreviewDispatchTag } from './ios-pr-tags.mjs';

const request = { prNumber: 161, commentId: 6692295270, sha: 'a'.repeat(40) };
const current = `ios-testflight/pr/161/6692295270-${request.sha}`;
const legacy = `ios-testflight/pr/161/6692295270/${request.sha}`;

test('new dispatch tags use four segments and retain every identity component', () => {
  assert.equal(previewDispatchTag(request), current);
  assert.equal(current.split('/').length, 4);
  assert.equal(previewDispatchTag(request, { legacy: true }), legacy);
  assert.deepEqual(parsePreviewDispatchTag(current), { ...request, legacy: false });
  assert.deepEqual(parsePreviewDispatchTag(legacy), { ...request, legacy: true });
});

test('safe integer boundaries round trip in both formats', () => {
  for (const legacy of [false, true]) {
    for (const ids of [{ prNumber: 1, commentId: Number.MAX_SAFE_INTEGER }, { prNumber: Number.MAX_SAFE_INTEGER, commentId: 1 }]) {
      const value = { ...request, ...ids };
      assert.deepEqual(parsePreviewDispatchTag(previewDispatchTag(value, { legacy })), { ...value, legacy });
    }
  }
});

test('dispatch construction rejects noncanonical identities and incomplete source SHAs', () => {
  for (const bad of [
    { prNumber: 0 }, { commentId: -1 }, { prNumber: 1.5 }, { commentId: Number.MAX_SAFE_INTEGER + 1 },
    { prNumber: '161' }, { commentId: NaN }, { prNumber: Infinity },
    { sha: 'abc' }, { sha: 'A'.repeat(40) }, { sha: `${request.sha}\n` }, { sha: null },
    { sha: `${'a'.repeat(39)}\n` }, { sha: `${'a'.repeat(39)}\r` }, { sha: `${'a'.repeat(39)}\u2028` },
  ]) assert.throws(() => previewDispatchTag({ ...request, ...bad }));
});

test('parsing refuses malformed namespaces, IDs, sources and suffixes', () => {
  const invalid = [undefined, null, 1, '',
    current.replace('ios-testflight/', 'other/'), `refs/tags/${current}`, current.replace('/pr/', '/request/'),
    current.replace('/161/', '/0161/'), current.replace('/161/', '/0/'), current.replace('/161/', '/-1/'),
    current.replace('/161/', '/1.5/'), current.replace('/161/', '/9007199254740992/'),
    current.replace('/6692295270-', '/06692295270-'), current.replace('/6692295270-', '/0-'),
    current.replace('/6692295270-', '/9007199254740992-'), current.replace(request.sha, 'A'.repeat(40)),
    current.replace(request.sha, 'a'.repeat(39)), current.replace(request.sha, 'a'.repeat(41)),
    `${current}/extra`, `${current}\n`, current.replace('/6692295270-', '/6692295270%2D'), current.replace('/161/', '%2F161%2F'),
    legacy.replace('/6692295270/', '/06692295270/'), `${legacy}\n`, `${legacy}/extra`,
  ];
  for (const tag of invalid) assert.equal(parsePreviewDispatchTag(tag), undefined, String(tag));
});
