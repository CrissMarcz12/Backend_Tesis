import "dotenv/config";

const DEFAULT_API_URL = "http://18.231.122.110:8000/rag/query";
const DEFAULT_BASE_URL = "http://18.231.122.110:8000";
const DEFAULT_QUERY_PATH = "/rag/query";
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_TOP_K = 5;

function buildURL() {
    const apiUrl = process.env.RAG_API_URL?.trim();
  if (apiUrl) return apiUrl;

  const base = (process.env.RAG_BASE_URL || DEFAULT_BASE_URL).trim();
  const path = (process.env.RAG_QUERY_PATH || DEFAULT_QUERY_PATH).trim();
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
    return url.toString() || DEFAULT_API_URL;
}

function getDefaultEvaluate() {
  const raw = process.env.RAG_DEFAULT_EVALUATE;
  if (raw === undefined) return true;
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return true;
}

function getDefaultTopK() {
  const raw = process.env.RAG_DEFAULT_TOP_K;
  if (!raw) return DEFAULT_TOP_K;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TOP_K;
  return Math.min(Math.max(Math.round(parsed), 1), 20);
}

function getTimeoutMs() {
  const raw = process.env.RAG_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.round(parsed);
}

function buildHeaders() {
  const headers = { "Content-Type": "application/json" };
  const apiKey = process.env.RAG_API_KEY?.trim();
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

export class RagClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "RagClientError";
    this.status = options.status || null;
    this.details = options.details || null;
    this.cause = options.cause;
  }
}

export function buildRagPayload({ question, k, evaluate } = {}) {
  if (!question || typeof question !== "string" || !question.trim()) {
    throw new RagClientError("La pregunta es obligatoria");
  }

  const payload = {
    question: question.trim(),
    k: k ?? getDefaultTopK(),
    evaluate: evaluate ?? getDefaultEvaluate(),
  };

  if (payload.k < 1 || payload.k > 20) {
    throw new RagClientError("El parámetro k debe estar entre 1 y 20");
  }

  return payload;
}

export async function queryRag({ question, k, evaluate } = {}) {
  const payload = buildRagPayload({ question, k, evaluate });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());

  const url = buildURL();
  const headers = buildHeaders();
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (parseError) {
      throw new RagClientError("Respuesta JSON inválida del motor RAG", {
        status: response.status,
        details: text,
        cause: parseError,
      });
    }

    if (!response.ok) {
      throw new RagClientError("Error al consultar el motor RAG", {
        status: response.status,
        details: data || text,
      });
    }

    const answer = typeof data?.answer === "string" ? data.answer.trim() : null;
    if (!answer) {
      throw new RagClientError("El motor RAG no devolvió una respuesta válida", {
        status: response.status,
        details: data,
      });
    }

    const sources = Array.isArray(data.sources) ? data.sources : [];
    const evaluation = data.eval ?? data.evaluation ?? null;

    return {
      answer,
      sources,
      evaluation,
      latency_ms: typeof data.latency_ms === "number" ? Math.max(0, Math.round(data.latency_ms)) : latencyMs,
      raw: data,
      rag_request: payload,
    };
  } catch (err) {
    if (err.name === "AbortError") {
      throw new RagClientError("Timeout al consultar el motor RAG", {
        cause: err,
      });
    }
    if (err instanceof RagClientError) throw err;
    throw new RagClientError("No se pudo consultar el motor RAG", { cause: err });
  } finally {
    clearTimeout(timeout);
  }
}