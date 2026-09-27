// packages/shared/utils/src/lib/common/jcs.ts

const assertUnicodeScalarValues = (value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error('JCS does not allow lone surrogates');
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('JCS does not allow lone surrogates');
    }
  }
};

/** RFC 8785 JSON Canonicalization Scheme for JSON-compatible values. */
export const jcsStringify = (value: unknown): string => {
  if (typeof value === 'string') {
    assertUnicodeScalarValues(value);
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(jcsStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => {
        assertUnicodeScalarValues(key);
        return `${JSON.stringify(key)}:${jcsStringify(record[key])}`;
      });
    return `{${members.join(',')}}`;
  }
  throw new Error('JCS requires finite JSON values');
};
