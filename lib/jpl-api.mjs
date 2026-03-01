const API_BASE_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
const OBJECT_API_BASE_URL = "https://ssd-api.jpl.nasa.gov/sbdb.api";

const API_FIELDS = Object.freeze([
  "spkid",
  "full_name",
  "pdes",
  "class",
  "a",
  "e",
  "i",
  "om",
  "w",
  "ma",
  "diameter",
  "albedo",
  "H",
  "epoch"
]);

export {
  API_BASE_URL,
  OBJECT_API_BASE_URL,
  API_FIELDS
};

export async function fetchJsonWithRetries(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const maxRetries = options.maxRetries ?? 2;

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) {
        break;
      }
      await sleep(500 * (attempt + 1));
    }
  }

  throw lastError ?? new Error("Unknown fetch failure.");
}

export function buildQueryApiUrl(options = {}) {
  const params = new URLSearchParams({
    fields: (options.fields ?? API_FIELDS).join(","),
    "sb-kind": options.kind ?? "a",
    "sb-class": options.classCode ?? "MBA",
    "full-prec": options.fullPrecision ?? "1",
    limit: String(options.limit ?? 25)
  });

  if (Number.isFinite(options.offset) && options.offset > 0) {
    params.set("limit-from", String(Math.floor(options.offset)));
  }

  if (options.sort) {
    params.set("sort", String(options.sort));
  }

  if (Array.isArray(options.clauses) && options.clauses.length > 0) {
    const clauseMode = options.clauseMode === "OR" ? "OR" : "AND";
    params.set("sb-cdata", JSON.stringify({ [clauseMode]: options.clauses }));
  }

  return `${API_BASE_URL}?${params.toString()}`;
}

export function mapQueryPayloadToAsteroids(payload) {
  const fields = Array.isArray(payload?.fields) ? payload.fields : [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const fieldIndex = createFieldIndex(fields);
  return dedupeAsteroids(rows.map((row) => mapRowToAsteroid(row, fieldIndex)).filter(Boolean));
}

export function dedupeAsteroids(records) {
  const output = new Map();
  for (const record of records) {
    if (record?.id) {
      output.set(record.id, record);
    }
  }
  return Array.from(output.values());
}

export function sanitizeConstraintValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).replace(/[|"]/g, "").trim();
  return cleaned || null;
}

export function sanitizeSearchFragment(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value)
    .replace(/[^0-9A-Za-z ._\-()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

export function titleCaseWords(value) {
  if (!value) {
    return value;
  }

  return value
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part))
    .join(" ");
}

function createFieldIndex(fields) {
  const output = {};
  fields.forEach((field, index) => {
    output[field] = index;
  });
  return output;
}

function mapRowToAsteroid(row, fieldIndex) {
  const id = pickField(row, fieldIndex, "spkid");
  const name = pickField(row, fieldIndex, "full_name");
  const a = toNumber(pickField(row, fieldIndex, "a"));
  const e = toNumber(pickField(row, fieldIndex, "e"));
  const i = toNumber(pickField(row, fieldIndex, "i"));

  if (!id || !name || !Number.isFinite(a) || !Number.isFinite(e) || !Number.isFinite(i)) {
    return null;
  }

  return {
    id: String(id),
    name: String(name).trim(),
    primaryDesignation: sanitizeText(pickField(row, fieldIndex, "pdes")),
    classCode: String(pickField(row, fieldIndex, "class") ?? "Unknown"),
    zone: classifyBeltZone(a),
    a,
    e,
    i,
    om: toNumber(pickField(row, fieldIndex, "om")),
    w: toNumber(pickField(row, fieldIndex, "w")),
    ma: toNumber(pickField(row, fieldIndex, "ma")),
    diameterKm: toNumber(pickField(row, fieldIndex, "diameter")),
    albedo: toNumber(pickField(row, fieldIndex, "albedo")),
    absoluteMagnitudeH: toNumber(pickField(row, fieldIndex, "H")),
    epochMjd: toNumber(pickField(row, fieldIndex, "epoch")),
    orbitalPeriodYears: periodYearsFromSemiMajorAxis(a)
  };
}

function pickField(row, fieldIndex, name) {
  const index = fieldIndex[name];
  if (index === undefined || !Array.isArray(row)) {
    return null;
  }
  return row[index];
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const cleaned = String(value).trim();
  return cleaned || null;
}

function classifyBeltZone(a) {
  if (!Number.isFinite(a)) {
    return "Unknown";
  }
  if (a < 2.5) {
    return "Inner Belt";
  }
  if (a < 2.82) {
    return "Middle Belt";
  }
  return "Outer Belt";
}

function periodYearsFromSemiMajorAxis(a) {
  if (!Number.isFinite(a) || a <= 0) {
    return null;
  }

  return Math.sqrt(a ** 3);
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Upstream request failed with status ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
