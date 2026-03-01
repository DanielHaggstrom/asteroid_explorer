import fsPromises from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  API_FIELDS,
  buildQueryApiUrl,
  dedupeAsteroids,
  fetchJsonWithRetries,
  mapQueryPayloadToAsteroids,
  sanitizeConstraintValue
} from "../lib/jpl-api.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const OUTPUT_PATH = path.join(ROOT_DIR, "data", "main-belt-startup.json");
const CORE_BODIES_PATH = path.join(ROOT_DIR, "config", "startup-sample-core-bodies.json");

const DEFAULT_SAMPLE_SIZE = 10_000;
const RANDOM_WINDOW_SIZE = 1_000;
const FETCH_TIMEOUT_MS = 45_000;
const MAX_FETCH_RETRIES = 2;
const AUTO_COMMIT_MESSAGE = "chore(data): refresh startup sample";

const args = parseArgs(process.argv.slice(2));

await main();

async function main() {
  const coreBodies = await readCoreBodies();
  const payload = await buildStartupSample({
    sampleSize: args.sampleSize,
    coreBodies
  });

  await fsPromises.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${payload.asteroids.length} startup-sample objects to ${path.relative(ROOT_DIR, OUTPUT_PATH)}.`
  );

  if (args.shouldCommit) {
    autoCommitSampleArtifacts();
  }
}

async function buildStartupSample({ sampleSize, coreBodies }) {
  const generatedAt = new Date().toISOString();
  const availableCount = await fetchCatalogCount();

  const coreAsteroids = await fetchAsteroidsByPdes(coreBodies.map((body) => body.pdes));
  const coreByPdes = new Map(coreAsteroids.map((asteroid) => [asteroid.primaryDesignation, asteroid]));
  const missingCoreBodies = coreBodies.filter((body) => !coreByPdes.has(body.pdes));
  if (missingCoreBodies.length > 0) {
    throw new Error(
      `Failed to refresh ${missingCoreBodies.length} required core bodies: ` +
        missingCoreBodies.map((body) => body.name).join(", ")
    );
  }

  const targetExtraCount = Math.max(0, sampleSize - coreAsteroids.length);
  const randomAsteroids = await fetchRandomPool(targetExtraCount, availableCount);
  const coreIds = new Set(coreAsteroids.map((asteroid) => asteroid.id));
  const extraCandidates = randomAsteroids.filter((asteroid) => !coreIds.has(asteroid.id));
  const selectedExtras = pickRandomSubset(extraCandidates, targetExtraCount);
  const asteroids = dedupeAsteroids([...coreAsteroids, ...selectedExtras]);

  if (asteroids.length < sampleSize) {
    throw new Error(
      `Prepared sample is undersized (${asteroids.length}/${sampleSize}). Increase fetch budget and retry.`
    );
  }

  return {
    meta: {
      source: "Prepared startup sample from the NASA/JPL SBDB Query API",
      fetchedAt: generatedAt,
      generatedAt,
      loadedCount: asteroids.length,
      availableCount,
      sampleMode: "prepared-startup-sample",
      warning: null,
      coreObjectIds: coreAsteroids.map((asteroid) => asteroid.id),
      coreBodies: coreBodies.map(({ pdes, name }) => ({ pdes, name }))
    },
    asteroids
  };
}

async function readCoreBodies() {
  const file = await fsPromises.readFile(CORE_BODIES_PATH, "utf8");
  const parsed = JSON.parse(file);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Core body configuration is empty.");
  }
  return parsed;
}

async function fetchCatalogCount() {
  const payload = await fetchJsonWithRetries(
    buildQueryApiUrl({
      fields: API_FIELDS,
      limit: 1
    }),
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRetries: MAX_FETCH_RETRIES
    }
  );

  const count = Number(payload?.count);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("Could not determine the current main-belt catalog count from JPL.");
  }
  return count;
}

async function fetchRandomPool(targetCount, availableCount) {
  if (targetCount <= 0) {
    return [];
  }

  const desiredPoolSize = Math.max(targetCount * 2, targetCount + RANDOM_WINDOW_SIZE);
  const collected = new Map();
  const seenOffsets = new Set();
  let attempts = 0;

  while (collected.size < desiredPoolSize && attempts < 40) {
    const limit = Math.min(RANDOM_WINDOW_SIZE, availableCount);
    const maxOffset = Math.max(0, availableCount - limit);
    const offset = pickFreshOffset(maxOffset, seenOffsets);
    const payload = await fetchJsonWithRetries(
      buildQueryApiUrl({
        fields: API_FIELDS,
        limit,
        offset
      }),
      {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxRetries: MAX_FETCH_RETRIES
      }
    );

    for (const asteroid of mapQueryPayloadToAsteroids(payload)) {
      collected.set(asteroid.id, asteroid);
    }
    attempts += 1;
  }

  return Array.from(collected.values());
}

function pickFreshOffset(maxOffset, seenOffsets) {
  if (maxOffset <= 0) {
    return 0;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const offset = Math.floor(Math.random() * (maxOffset + 1));
    if (!seenOffsets.has(offset)) {
      seenOffsets.add(offset);
      return offset;
    }
  }

  const fallback = Math.floor(Math.random() * (maxOffset + 1));
  seenOffsets.add(fallback);
  return fallback;
}

async function fetchAsteroidsByPdes(pdesValues) {
  const clauses = pdesValues
    .map((value) => sanitizeConstraintValue(value))
    .filter(Boolean)
    .map((value) => `pdes|EQ|${value}`);

  const payload = await fetchJsonWithRetries(
    buildQueryApiUrl({
      fields: API_FIELDS,
      limit: clauses.length,
      clauses,
      clauseMode: "OR"
    }),
    {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRetries: MAX_FETCH_RETRIES
    }
  );

  return mapQueryPayloadToAsteroids(payload);
}

function pickRandomSubset(items, targetSize) {
  if (items.length <= targetSize) {
    return items.slice();
  }

  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, targetSize);
}

function autoCommitSampleArtifacts() {
  execFileSync("git", ["add", "--", "data/main-belt-startup.json", "config/startup-sample-core-bodies.json"], {
    cwd: ROOT_DIR,
    stdio: "inherit"
  });

  let shouldCommit = true;
  try {
    execFileSync(
      "git",
      ["diff", "--cached", "--quiet", "--", "data/main-belt-startup.json", "config/startup-sample-core-bodies.json"],
      {
        cwd: ROOT_DIR,
        stdio: "ignore"
      }
    );
    shouldCommit = false;
  } catch {
    shouldCommit = true;
  }

  if (!shouldCommit) {
    console.log("Startup sample refresh produced no staged changes to commit.");
    return;
  }

  execFileSync(
    "git",
    ["commit", "-m", AUTO_COMMIT_MESSAGE, "--", "data/main-belt-startup.json", "config/startup-sample-core-bodies.json"],
    {
      cwd: ROOT_DIR,
      stdio: "inherit"
    }
  );
}

function parseArgs(argv) {
  let sampleSize = DEFAULT_SAMPLE_SIZE;
  let shouldCommit = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--commit") {
      shouldCommit = true;
      continue;
    }

    if (arg === "--size" && argv[index + 1]) {
      sampleSize = parsePositiveInt(argv[index + 1], DEFAULT_SAMPLE_SIZE);
      index += 1;
      continue;
    }

    if (arg.startsWith("--size=")) {
      sampleSize = parsePositiveInt(arg.slice("--size=".length), DEFAULT_SAMPLE_SIZE);
    }
  }

  return {
    sampleSize,
    shouldCommit
  };
}

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}
