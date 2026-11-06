// Immutable preview dispatch identity. Old five-segment reservations remain
// readable; new requests use four segments without shortening the source SHA.
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const fullSha = value => typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/.test(value);

export function previewDispatchTag({ prNumber, commentId, sha }, { legacy = false } = {}) {
  if (!positiveId(prNumber) || !positiveId(commentId) || !fullSha(sha) || typeof legacy !== 'boolean') {
    throw new Error('Preview dispatch requires positive safe identities and a full lowercase SHA');
  }
  return `ios-testflight/pr/${prNumber}/${commentId}${legacy ? '/' : '-'}${sha}`;
}

export function parsePreviewDispatchTag(tag) {
  if (typeof tag !== 'string') return undefined;
  const match = /^ios-testflight\/pr\/([1-9][0-9]*)\/([1-9][0-9]*)([/-])([a-f0-9]{40})$/.exec(tag);
  if (!match || match[0] !== tag) return undefined;
  const prNumber = Number(match[1]), commentId = Number(match[2]);
  if (!positiveId(prNumber) || !positiveId(commentId)) return undefined;
  return { prNumber, commentId, sha: match[4], legacy: match[3] === '/' };
}
