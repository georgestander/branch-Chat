const LEXICAL_VECTOR_DIMENSIONS = 2_048;
const MAX_LEXICAL_INPUT_CHARS = 24_000;
const MAX_FEATURES = 4_096;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "not",
  "of",
  "on",
  "or",
  "our",
  "she",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tokenize(value: string): string[] {
  const normalized = value
    .slice(0, MAX_LEXICAL_INPUT_CHARS)
    .normalize("NFKC")
    .toLowerCase();
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function lexicalFeatures(value: string): Array<{ value: string; weight: number }> {
  const allTokens = tokenize(value);
  const contentTokens = allTokens.filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token),
  );
  const tokens = contentTokens.length > 0 ? contentTokens : allTokens;
  const features: Array<{ value: string; weight: number }> = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    features.push({ value: `t:${token}`, weight: 1 });
    const next = tokens[index + 1];
    if (next) {
      features.push({ value: `b:${token}\u0000${next}`, weight: 0.65 });
    }
    if (features.length >= MAX_FEATURES) {
      break;
    }
  }

  if (features.length === 0) {
    const fallback = value.trim() || "empty";
    features.push({ value: `f:${fallback.slice(0, 128)}`, weight: 1 });
  }
  return features;
}

/**
 * Produces a deterministic, keyless feature-hashed vector for lexical retrieval.
 * The dense shape intentionally matches the existing Durable Object cosine path.
 */
export function createLexicalEmbedding(text: string): number[] {
  const vector = new Array<number>(LEXICAL_VECTOR_DIMENSIONS).fill(0);

  for (const feature of lexicalFeatures(text)) {
    const bucket = fnv1a(feature.value) % LEXICAL_VECTOR_DIMENSIONS;
    const sign = (fnv1a(`sign:${feature.value}`) & 1) === 0 ? 1 : -1;
    vector[bucket] = (vector[bucket] ?? 0) + sign * feature.weight;
  }

  let squaredMagnitude = 0;
  for (let index = 0; index < vector.length; index += 1) {
    const value = vector[index] ?? 0;
    const dampened = Math.sign(value) * Math.sqrt(Math.abs(value));
    vector[index] = dampened;
    squaredMagnitude += dampened * dampened;
  }

  const magnitude = Math.sqrt(squaredMagnitude);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    vector[0] = 1;
    return vector;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = (vector[index] ?? 0) / magnitude;
  }
  return vector;
}
