const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

/**
 * Embed dei chunk via Ollama /api/embed.
 * @param {string[]} chunks
 * @returns {Promise<number[][]>} array di vettori (o [] se embed non disponibile)
 */
export async function embedChunks(chunks) {
  if (!chunks.length) return [];
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_EMBED_MODEL,
        input: chunks,
      }),
    });
    if (!res.ok) {
      console.warn(
        `[Ollama] Embed skipped: ${res.status} ${res.statusText} (pull ${OLLAMA_EMBED_MODEL}?)`,
      );
      return [];
    }
    const data = await res.json();
    return data.embeddings || [];
  } catch (err) {
    console.warn("[Ollama] Embed error:", err.message);
    return [];
  }
}

/**
 * Chiamata generate verso Ollama (prompt singolo).
 * @param {string} prompt
 * @param {number} maxTokens
 * @returns {Promise<string>}
 */
export async function ollamaGenerate(prompt, maxTokens = 2048) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: maxTokens,
        repeat_penalty: 1.18,
        num_ctx: 16384,
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama API: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.response || "").trim();
}

export { OLLAMA_URL, OLLAMA_MODEL, OLLAMA_EMBED_MODEL };
