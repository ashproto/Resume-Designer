export function parseChromeVersion(value) {
  if (typeof value !== 'string') throw new Error('Chrome extension version must be a string');
  const parts = value.split('.');
  if (parts.length < 1 || parts.length > 4) {
    throw new Error(`Invalid Chrome extension version: ${value}`);
  }

  const numbers = parts.map((part) => {
    if (!/^(?:0|[1-9]\d*)$/u.test(part)) {
      throw new Error(`Invalid Chrome extension version: ${value}`);
    }
    const number = Number(part);
    if (!Number.isSafeInteger(number) || number > 65_535) {
      throw new Error(`Invalid Chrome extension version: ${value}`);
    }
    return number;
  });

  if (numbers.every((number) => number === 0)) {
    throw new Error(`Chrome extension version cannot be all zero: ${value}`);
  }

  return [...numbers, ...Array(4 - numbers.length).fill(0)];
}

export function compareChromeVersions(left, right) {
  const leftParts = parseChromeVersion(left);
  const rightParts = parseChromeVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}
