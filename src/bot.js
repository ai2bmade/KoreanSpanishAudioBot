const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");

const ROOT_DIR = path.resolve(__dirname, "..");
const CONTENT_PATH = path.join(ROOT_DIR, "content", "expressions.json");
const CHALLENGES_PATH = path.join(ROOT_DIR, "content", "challenges.json");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, "data");
const SCORE_PATH = path.join(DATA_DIR, "challenge_scores.json");
const DEFAULT_DAILY_LIMIT = 3;
const DAILY_CHALLENGE_SIZE = 5;

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("Missing required environment variable TELEGRAM_BOT_TOKEN");
}

const buyMeACoffeeUrl = process.env.BUY_ME_A_COFFEE_URL || "";
const dailyLimit = Number.parseInt(process.env.FREE_DAILY_LIMIT || `${DEFAULT_DAILY_LIMIT}`, 10);
const activeChatIds = new Set(
  (process.env.ACTIVE_CHAT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

const usageByDay = new Map();
const challengeSessions = new Map();

function loadExpressions() {
  const raw = fs.readFileSync(CONTENT_PATH, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.expressions) || parsed.expressions.length === 0) {
    throw new Error("content/expressions.json must contain a non-empty expressions array");
  }
  return parsed.expressions;
}

function loadChallenges(expressionList) {
  const raw = fs.readFileSync(CHALLENGES_PATH, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.challenges) || parsed.challenges.length === 0) {
    throw new Error("content/challenges.json must contain a non-empty challenges array");
  }

  const expressionsById = new Map(expressionList.map((expression) => [expression.id, expression]));
  return parsed.challenges.map((challenge) => {
    const expression = expressionsById.get(challenge.id);
    if (!expression) {
      throw new Error(`Challenge references missing expression id: ${challenge.id}`);
    }
    return { ...challenge, expression };
  });
}

function loadScores() {
  if (!fs.existsSync(SCORE_PATH)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(SCORE_PATH, "utf8").replace(/^\uFEFF/, ""));
}

function saveScores(scores) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SCORE_PATH, JSON.stringify(scores, null, 2), "utf8");
}

function displayName(ctx) {
  const from = ctx.from || {};
  return from.username || [from.first_name, from.last_name].filter(Boolean).join(" ") || String(from.id || "Unknown");
}

function updateScore(ctx, score, total) {
  const chatId = chatIdOf(ctx);
  const scores = loadScores();
  const current = scores[chatId] || {
    name: displayName(ctx),
    bestScore: 0,
    totalCorrect: 0,
    totalQuestions: 0,
    totalChallenges: 0,
    lastScore: 0,
    lastPlayedAt: ""
  };

  current.name = displayName(ctx);
  current.bestScore = Math.max(current.bestScore, score);
  current.totalCorrect += score;
  current.totalQuestions += total;
  current.totalChallenges += 1;
  current.lastScore = score;
  current.lastPlayedAt = new Date().toISOString();
  scores[chatId] = current;
  saveScores(scores);

  const ranking = Object.entries(scores)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      if (b.totalCorrect !== a.totalCorrect) return b.totalCorrect - a.totalCorrect;
      if (a.totalChallenges !== b.totalChallenges) return a.totalChallenges - b.totalChallenges;
      return a.name.localeCompare(b.name);
    });

  const rank = ranking.findIndex((entry) => entry.id === chatId) + 1;
  return { rank, ranking: ranking.slice(0, 10) };
}

const expressions = loadExpressions();
const challenges = loadChallenges(expressions);
const bot = new Telegraf(token);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function chatIdOf(ctx) {
  return String(ctx.chat?.id || ctx.from?.id || "");
}

function isActive(chatId) {
  return activeChatIds.has(chatId);
}

function usageKey(chatId) {
  return `${todayKey()}:${chatId}`;
}

function getUsage(chatId) {
  return usageByDay.get(usageKey(chatId)) || 0;
}

function incrementUsage(chatId) {
  const key = usageKey(chatId);
  usageByDay.set(key, (usageByDay.get(key) || 0) + 1);
}

function pickExpression() {
  return expressions[Math.floor(Math.random() * expressions.length)];
}

function shuffled(values) {
  return [...values].sort(() => Math.random() - 0.5);
}

function pickChallengeItems() {
  return shuffled(challenges).slice(0, DAILY_CHALLENGE_SIZE);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function bottomRankMessage(direction, fromBottom, totalPlayers) {
  if (direction === "ru_ko") {
    return `오늘 이 세트 시험을 본 ${totalPlayers}명 중 당신의 점수는 아래에서 ${fromBottom}번째입니다.`;
  }

  return `Tu puntaje está entre los últimos ${fromBottom} de ${totalPlayers} estudiantes hoy para este set.`;
}

function challengeResultMessage(score, total, direction) {
  if (score === total) {
    return direction === "ru_ko" ? ["완벽합니다! 모두 맞혔습니다."] : ["¡Perfecto! Todas las respuestas son correctas."];
  }

  if (score === 0) {
    return direction === "ru_ko" ? ["아이고... 0개 맞혔습니다."] : ["Ay Dios mío... sacaste cero."];
  }

  const totalPlayers = randomInt(261, 398);
  if (score === 4) {
    const fromBottom = randomInt(101, 195);
    return [bottomRankMessage(direction, fromBottom, totalPlayers)];
  }

  if (score === 3) {
    const fromBottom = randomInt(67, 95);
    return [bottomRankMessage(direction, fromBottom, totalPlayers)];
  }

  if (score === 2) {
    const fromBottom = randomInt(23, 48);
    return [bottomRankMessage(direction, fromBottom, totalPlayers)];
  }

  if (score === 1) {
    const fromBottom = randomInt(7, 22);
    return [bottomRankMessage(direction, fromBottom, totalPlayers)];
  }

  return [];
}

function keyboard() {
  const rows = [
    [Markup.button.callback("Next Practice", "practice")],
    [Markup.button.callback("Daily Challenge", "challenge")]
  ];

  if (buyMeACoffeeUrl) {
    rows.push([Markup.button.url("Buy Me a Coffee", buyMeACoffeeUrl)]);
  }

  return Markup.inlineKeyboard(rows);
}

function nextPracticeKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback("Next Practice", "practice")]]);
}

function challengeKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Korean -> Spanish", "challenge_ko_ru")],
    [Markup.button.callback("Spanish -> Korean", "challenge_ru_ko")],
    [Markup.button.callback("Next Practice", "practice")]
  ]);
}

function supportKeyboard() {
  if (buyMeACoffeeUrl) {
    return Markup.inlineKeyboard([
      [Markup.button.url("Buy Me a Coffee", buyMeACoffeeUrl)],
      [Markup.button.callback("Next Practice", "practice")]
    ]);
  }

  return nextPracticeKeyboard();
}

function expressionText(expression) {
  return [
    "Korean:",
    expression.ko,
    "",
    `${expression.language}:`,
    expression.foreign,
    "",
    "오디오 파일을 다시 누르면 추가로 반복해서 들을 수 있습니다.",
    "Нажмите на аудиофайл ещё раз, чтобы повторить прослушивание."
  ].join("\n");
}

async function sendExpression(ctx, expression) {
  await ctx.reply(expressionText(expression));

  const audioPath = path.join(ROOT_DIR, expression.audio);
  if (fs.existsSync(audioPath)) {
    await ctx.replyWithAudio({ source: audioPath, filename: `${expression.id}.ogg` }, nextPracticeKeyboard());
    return;
  }

  await ctx.reply(`Audio file is not ready yet: ${expression.id}.ogg`, nextPracticeKeyboard());
}

async function sendChallengeQuestion(ctx, chatId) {
  const session = challengeSessions.get(chatId);
  if (!session) return;

  if (session.index >= session.items.length) {
    updateScore(ctx, session.score, session.items.length);
    const resultMessage = challengeResultMessage(session.score, session.items.length, session.direction);
    const finishedLines =
      session.direction === "ru_ko"
        ? ["데일리 챌린지 완료.", `점수: ${session.score}/${session.items.length}`, ...resultMessage]
        : ["Ежедневное задание завершено.", `Результат: ${session.score}/${session.items.length}`, ...resultMessage];

    await ctx.reply(
      finishedLines.join("\n"),
      nextPracticeKeyboard()
    );
    challengeSessions.delete(chatId);
    return;
  }

  const item = session.items[session.index];
  const expression = item.expression;
  const answerFirst = session.index % 2 === 0;
  const correct = session.direction === "ko_ru" ? expression.foreign : expression.ko;
  const wrong = session.direction === "ko_ru" ? item.foreignWrong : item.koWrong;
  const options = answerFirst ? [correct, wrong] : [wrong, correct];
  const correctOption = answerFirst ? 1 : 2;
  session.correctOption = correctOption;
  session.correctText = correct;

  const prompt =
    session.direction === "ko_ru"
      ? ["Coreano -> español", `Задание: ${expression.ko}`, "¿Cuál de las dos opciones tiene el mismo significado?"]
      : ["스페인어 -> 한국어", `문제: ${expression.foreign}`, "다음 둘 중 문제와 같은 뜻은?"];

  await ctx.reply(
    [
      session.direction === "ru_ko" ? `문제 ${session.index + 1}/${session.items.length}` : `Вопрос ${session.index + 1}/${session.items.length}`,
      ...prompt,
      "",
      `1. ${options[0]}`,
      `2. ${options[1]}`
    ].join("\n"),
    Markup.inlineKeyboard([
      [
        Markup.button.callback("1", "challenge_answer_1"),
        Markup.button.callback("2", "challenge_answer_2")
      ]
    ])
  );
}

async function startPractice(ctx) {
  const chatId = chatIdOf(ctx);
  if (!chatId) return;

  const active = isActive(chatId);
  const used = getUsage(chatId);

  if (!active && used >= dailyLimit) {
    await ctx.reply(
      [
        "오늘의 무료 연습이 끝났습니다.",
        "24시간 후에 다시 연습하실 수 있습니다.",
        "",
        "Бесплатная практика на сегодня закончена.",
        "Вы сможете снова заниматься через 24 часа.",
        "",
        "Buy Me a Coffee로 후원하시면 3개월 동안 제한 없이 연습하실 수 있습니다.",
        "",
        "Если вы хотите практиковать корейский диктант, перейдите сюда:",
        "https://t.me/KoreanListeningBot"
      ].join("\n"),
      supportKeyboard()
    );
    return;
  }

  const expression = pickExpression();
  if (!active) {
    incrementUsage(chatId);
  }
  await sendExpression(ctx, expression);

  if (!active && getUsage(chatId) >= dailyLimit) {
    await ctx.reply(
      [
        "오늘의 무료 3개 표현을 모두 들으셨습니다.",
        "24시간 후에 다시 연습하실 수 있습니다.",
        "",
        "Вы прослушали 3 бесплатных выражения на сегодня.",
        "Следующая бесплатная практика будет доступна через 24 часа.",
        "",
        "Если вы хотите практиковать корейский диктант, перейдите сюда:",
        "https://t.me/KoreanListeningBot"
      ].join("\n"),
      supportKeyboard()
    );
  }
}

async function sendChallenge(ctx) {
  const chatId = chatIdOf(ctx);
  if (!isActive(chatId)) {
    await ctx.reply(
      [
        "Daily Challenge는 유료 회원용 연습입니다.",
        "$5 Buy Me a Coffee 후원 후 Telegram ID를 보내주시면 3개월 동안 활성화됩니다.",
        "",
        "Daily Challenge доступен для активных пользователей.",
        "После поддержки проекта на $5 отправьте ваш Telegram ID для активации на 3 месяца.",
        "",
        "Если вы хотите практиковать корейский диктант, перейдите сюда:",
        "https://t.me/KoreanListeningBot"
      ].join("\n"),
      supportKeyboard()
    );
    return;
  }

  await ctx.reply("Choose your daily challenge type.", challengeKeyboard());
}

async function startChallenge(ctx, direction) {
  const chatId = chatIdOf(ctx);
  if (!chatId || !isActive(chatId)) {
    await sendChallenge(ctx);
    return;
  }

  challengeSessions.set(chatId, {
    direction,
    index: 0,
    score: 0,
    items: pickChallengeItems(),
    correctOption: null,
    correctText: ""
  });

  await sendChallengeQuestion(ctx, chatId);
}

async function answerChallenge(ctx, selectedOption) {
  const chatId = chatIdOf(ctx);
  const session = challengeSessions.get(chatId);
  if (!session) {
    await ctx.reply("No active challenge. Start Daily Challenge again.", challengeKeyboard());
    return;
  }

  const isCorrect = selectedOption === session.correctOption;
  if (isCorrect) {
    session.score += 1;
  }

  const feedback =
    session.direction === "ru_ko"
      ? [isCorrect ? "정답입니다." : "아쉬워요.", `정답: ${session.correctText}`]
      : [isCorrect ? "Верно." : "Не совсем.", `Ответ: ${session.correctText}`];

  await ctx.reply(feedback.join("\n"));

  session.index += 1;
  await sendChallengeQuestion(ctx, chatId);
}

bot.start(async (ctx) => {
  await ctx.reply(
    [
      "¡Hola!",
      "",
      "Este bot es para estudiantes hispanohablantes, especialmente de español mexicano, que quieren aprender coreano.",
      "También es útil para coreanos que estudian español.",
      "",
      "Cada audio incluye una expresión en coreano y su equivalente en español. La misma expresión se repite más de 20 veces.",
      "Para repetir, solo toca el archivo de audio otra vez.",
      "",
      "Los usuarios gratuitos pueden escuchar 3 expresiones al día.",
      "Si apoyas el proyecto con $5 en Buy Me a Coffee, tendrás acceso por 3 meses y podrás practicar muchas expresiones sin límite.",
      "",
      "Si quieres practicar dictado en coreano, entra aquí:",
      "https://t.me/KoreanListeningBot",
      "",
      "Use /id to check your Telegram ID.",
      "",
      "안녕하세요!",
      "",
      "이 봇은 한국어를 배우고 싶은 멕시코식 스페인어권 학습자를 위한 듣기 연습 봇입니다. 동시에 스페인어를 배우는 한국인에게도 도움이 되도록 만들었습니다.",
      "",
      "각 오디오 파일에는 한국어 표현과 해당 언어 표현이 함께 들어 있으며, 같은 표현이 최소 20번 이상 반복됩니다.",
      "오디오 파일을 다시 누르면 추가로 반복해서 들을 수 있습니다.",
      "",
            `무료 학습자는 하루에 ${dailyLimit}개의 표현을 들을 수 있습니다.`,
      "Buy Me a Coffee로 $5를 후원해 주시면 3개월 동안 다양한 표현을 제한 없이 듣고 연습하실 수 있습니다.",
      "",
      "영어 받아쓰기 연습도 해보실래요?",
      "https://t.me/EnglishDictationPracticeBot"
    ].join("\n"),
    keyboard()
  );
});

bot.command("id", async (ctx) => {
  await ctx.reply(`Your Telegram ID: ${chatIdOf(ctx)}`);
});

bot.command("practice", startPractice);

bot.action("practice", async (ctx) => {
  await ctx.answerCbQuery();
  await startPractice(ctx);
});

bot.action("challenge", async (ctx) => {
  await ctx.answerCbQuery();
  await sendChallenge(ctx);
});

bot.action("challenge_ko_ru", async (ctx) => {
  await ctx.answerCbQuery();
  await startChallenge(ctx, "ko_ru");
});

bot.action("challenge_ru_ko", async (ctx) => {
  await ctx.answerCbQuery();
  await startChallenge(ctx, "ru_ko");
});

bot.action("challenge_answer_1", async (ctx) => {
  await ctx.answerCbQuery();
  await answerChallenge(ctx, 1);
});

bot.action("challenge_answer_2", async (ctx) => {
  await ctx.answerCbQuery();
  await answerChallenge(ctx, 2);
});

bot.catch((err) => {
  console.error("Bot error:", err);
});

bot.launch();
console.log(`Listening practice bot started with ${expressions.length} expressions and ${challenges.length} challenges.`);

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
