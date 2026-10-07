/** One log line. CR/LF stripped so a response body cannot forge extra lines. */
export function logSafe(...parts: unknown[]): void {
  const text = parts
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
    .join(' ')
    .replaceAll('\r', '')
    .replaceAll('\n', '')
  console.log(text)
}
