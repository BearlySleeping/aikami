// packages/frontend/ai-gateway/tests/fixtures/llamacpp_native_fixtures.ts
//
// Verbatim wire data captured from a real native llama.cpp server, and
// transcribed from upstream's own documentation at the pinned commit.
//
// biome-ignore-all lint/style/useNamingConvention: these fixtures ARE the wire. Their whole purpose is to be spelled exactly as the server sends them, so a lint rule that camelCases them would be rewriting the thing under test. The naming here is correct; the linter's assumption is not.

/**
 * Upstream README response example, verbatim, including the `score` answer.
 *
 * Source: `tools/server/README.md`, "POST /v1/systemone", Response block, at
 * commit a4cb4c61. Used unmodified so a change in upstream's shape breaks this
 * test rather than being accommodated.
 */
export const upstreamReadmeResponse = {
  model: 'openjev',
  answers: {
    route: {
      type: 'choice',
      choice: 'billing',
      probabilities: { billing: 0.9998, shipping: 0.0001, technical: 0.0001 },
      confidence: 0.9997,
    },
    angry: { type: 'noul', noul: 0.6328 },
    urgency: {
      type: 'score',
      score: 2.0858,
      legend: { '0': 'can wait', '1': 'this week', '2': 'today', '3': 'right now' },
      probabilities: { '0': 0.0023, '1': 0.116, '2': 0.6753, '3': 0.2064 },
      confidence: 0.673,
    },
  },
  usage: { input_tokens: 239, output_tokens: 0 },
};

/**
 * A REAL captured response from `llama-server` a4cb4c61f serving
 * `tinylaya-for-testing-Q8_0.gguf`, answering upstream's own TEST_STATE with
 * upstream's own TEST_QUESTIONS shape.
 *
 * Two facts in here are load-bearing and were not in the README:
 *   - `model` is the FULL FILESYSTEM PATH, not a bare name.
 *   - The probabilities of a near-uniform answer (`confidence` 0.0015) are what a
 *     randomly-initialised testing checkpoint looks like; nothing here should be
 *     read as a quality signal.
 */
export const capturedTinylayaResponse = {
  model: '/home/sonny/llamacpp-pin/models/tinylaya-for-testing-Q8_0.gguf',
  answers: {
    route: {
      type: 'choice',
      choice: 'technical',
      probabilities: {
        billing: 0.3322078058950219,
        shipping: 0.3334600885586067,
        technical: 0.33433210554637144,
      },
      confidence: 0.0014981583195571855,
    },
    angry: { type: 'noul', noul: 0.5015357298593908 },
    refund: { type: 'noul', noul: 0.5017637149909667 },
  },
  usage: { input_tokens: 141, output_tokens: 0 },
};

/** A REAL captured 400 body from the same server. The error is a nested OBJECT. */
export const capturedInvalidRequestBody = {
  error: {
    code: 400,
    message: '"questions" must be a non-empty object',
    type: 'invalid_request_error',
  },
};

/** A REAL captured `/props` body from the same server. `build_info` is a string. */
export const capturedProps = {
  bos_token: 1,
  build_info: 'b11361-a4cb4c61f',
  chat_template: '{%- for message in messages -%}...',
  chat_template_caps: { supports_tools: false },
  model_alias: 'tinylaya',
  model_ftype: 15,
  model_path: '/home/sonny/llamacpp-pin/models/tinylaya-for-testing-Q8_0.gguf',
  total_slots: 1,
  is_sleeping: false,
};
