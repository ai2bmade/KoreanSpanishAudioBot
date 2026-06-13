const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const expressionsPath = path.join(rootDir, "content", "expressions.json");
const challengesPath = path.join(rootDir, "content", "challenges.json");
const manifestPath = path.join(rootDir, "content", "audio_manifest.csv");

function fail(message) {
  console.error(`Validation failed: ${message}`);
  process.exit(1);
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

const content = JSON.parse(fs.readFileSync(expressionsPath, "utf8").replace(/^\uFEFF/, ""));
if (!Array.isArray(content.expressions) || content.expressions.length === 0) {
  fail("content/expressions.json must contain a non-empty expressions array");
}

const ids = new Set();
const koreanValues = new Set();
const foreignValues = new Set();
for (const expression of content.expressions) {
  for (const field of ["id", "ko", "foreign", "language", "audio"]) {
    if (!expression[field]) {
      fail(`Expression is missing ${field}`);
    }
  }

  if (ids.has(expression.id)) {
    fail(`Duplicate expression id: ${expression.id}`);
  }
  ids.add(expression.id);
  koreanValues.add(expression.ko);
  foreignValues.add(expression.foreign);

  const audioPath = path.join(rootDir, expression.audio);
  if (!fs.existsSync(audioPath)) {
    fail(`Missing audio file for ${expression.id}: ${expression.audio}`);
  }
}

const manifestLines = fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
const header = parseCsvLine(manifestLines[0]);
const expectedHeader = ["id", "type", "language", "ko", "foreign", "source_file", "public_file"];
if (header.join(",") !== expectedHeader.join(",")) {
  fail(`Manifest header must be: ${expectedHeader.join(",")}`);
}

const manifestIds = new Set();
for (const line of manifestLines.slice(1)) {
  const row = parseCsvLine(line);
  if (row.length !== expectedHeader.length) {
    fail(`Manifest row has ${row.length} columns instead of ${expectedHeader.length}: ${line}`);
  }
  manifestIds.add(row[0]);
}

for (const id of ids) {
  if (!manifestIds.has(id)) {
    fail(`Missing manifest row for ${id}`);
  }
}

const challengeContent = JSON.parse(fs.readFileSync(challengesPath, "utf8").replace(/^\uFEFF/, ""));
if (!Array.isArray(challengeContent.challenges) || challengeContent.challenges.length === 0) {
  fail("content/challenges.json must contain a non-empty challenges array");
}

const challengeIds = new Set();
for (const challenge of challengeContent.challenges) {
  for (const field of ["id", "koWrong", "foreignWrong"]) {
    if (!challenge[field]) {
      fail(`Challenge is missing ${field}`);
    }
  }

  if (!ids.has(challenge.id)) {
    fail(`Challenge references missing expression id: ${challenge.id}`);
  }
  if (challengeIds.has(challenge.id)) {
    fail(`Duplicate challenge id: ${challenge.id}`);
  }
  challengeIds.add(challenge.id);

  if (!koreanValues.has(challenge.koWrong)) {
    fail(`Challenge ${challenge.id} koWrong is not from the 30 sample expressions: ${challenge.koWrong}`);
  }
  if (!foreignValues.has(challenge.foreignWrong)) {
    fail(`Challenge ${challenge.id} foreignWrong is not from the 30 sample expressions: ${challenge.foreignWrong}`);
  }
}

console.log(`Validated ${content.expressions.length} expressions and ${challengeContent.challenges.length} challenges.`);
