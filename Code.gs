// ============================================================
// ユーザー設定（自分の環境に合わせて変更してください）
// ============================================================

// スプレッドシートID（URLの /d/XXXX/edit の XXXX 部分）
// → PropertiesService に設定してください（下記 README 参照）

// カロリー・栄養素の1日の目標値（※サンプル値です。自分の目標に変更してください）
const TARGET = {
  kcal: 2000,
  p: 100,
  f: 60,
  c: 250,
  weight: 65.0  // 目標体重 (kg)
};

// プロフィール
const PROFILE = {
  name: "User",       // Geminiレポートで使用される名前
  persona: "なかやまきんに君" // AIコメントのペルソナ（自由に変更可）
};

// 身長（m）（※サンプル値です。自分の身長に変更してください）
const HEIGHT_M = 1.70;

// スプレッドシートのシート名
const SHEETS = {
  FOOD:   'food-log',    // 食事ログシート名
  WEIGHT: 'weight-log',  // 体重ログシート名
  DEBUG:  'Debug'        // デバッグログシート名
};

// デイリー/ウィークリーレポートを投稿するSlackチャンネル名（例: "general"）
// ※ CHANNEL_IDS はチャンネルIDを使用するが、こちらはチャンネル名で指定する点に注意
const REPORT_CHANNEL = 'diet-general';

// 食事・体重を投稿するSlackチャンネルのチャンネルID
// SlackチャンネルIDの確認方法: チャンネル名を右クリック → 「チャンネル詳細を表示」→ 下部に表示
const CHANNEL_IDS = {
  FOOD:   'C000000000',  // 食事ログを投稿するチャンネルID
  WEIGHT: 'C000000001'   // 体重ログを投稿するチャンネルID
};

// ============================================================
// 以下はロジック本体（通常は変更不要）
// ============================================================

function getSpreadsheetId() {
  return PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
}

function isDuplicate(eventId) {
  if (!eventId) return false;
  const cache = CacheService.getScriptCache();
  const key = "ev_" + eventId;
  if (cache.get(key)) return true;
  cache.put(key, "1", 60 * 10);
  return false;
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) return ContentService.createTextOutput("empty");
  const data = JSON.parse(e.postData.contents);

  if (data.type === "url_verification") {
    return ContentService.createTextOutput(data.challenge);
  }

  if (e.parameter && e.parameter['X-Slack-Retry-Num']) {
    return ContentService.createTextOutput("retry ignored");
  }

  const event = data.event;

  if (event && event.bot_id) return ContentService.createTextOutput("bot ignored");

  if (!event || event.type !== "message" || event.subtype === "message_changed") {
    return ContentService.createTextOutput("ignored");
  }

  if (isDuplicate(data.event_id)) {
    return ContentService.createTextOutput("duplicate ignored");
  }

  // エラーが起きても必ず200を返してSlackのリトライを防ぐ
  try {
    if (event.channel === CHANNEL_IDS.FOOD) {
      handleMealLog(event);
    } else if (event.channel === CHANNEL_IDS.WEIGHT) {
      handleWeightLog(event);
    }
  } catch (err) {
    logToSheet("doPost error: " + err.toString());
  }

  return ContentService.createTextOutput(JSON.stringify({ status: "ok" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleWeightLog(event) {
  const text = String((event && event.text) || "");
  const weightMatch = text.match(/\d+(\.\d+)?/);
  if (!weightMatch) return;

  const weight = parseFloat(weightMatch[0]);
  const fatMatch = text.match(/(\d+(\.\d+)?)\s*%/);
  const fat = fatMatch ? parseFloat(fatMatch[1]) : "";

  const bmi = (weight / (HEIGHT_M * HEIGHT_M)).toFixed(1);
  const diff = (weight - TARGET.weight).toFixed(1);

  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = ss.getSheetByName(SHEETS.WEIGHT);

  if (sheet) {
    sheet.appendRow([
      Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd HH:mm:ss"),
      weight,
      fat,
      bmi,
      diff,
      text
    ]);
    logToSheet("SUCCESS: Recorded Weight " + weight);
  }
}

function handleMealLog(event) {
  if (!event) return;

  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SLACK_BOT_TOKEN');

  let imageBlob = null;

  if (event.files && event.files.length > 0 && event.files[0].mimetype.startsWith("image/")) {
    try {
      imageBlob = UrlFetchApp.fetch(event.files[0].url_private_download, {
        headers: { "Authorization": `Bearer ${token}` }
      }).getBlob();
    } catch (e) {
      logToSheet("Image fetch error: " + e.toString());
    }
  }

  const analysis = callGeminiApi(event.text || "食事画像", imageBlob, true);
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = ss.getSheetByName(SHEETS.FOOD);

  if (sheet) {
    sheet.appendRow([
      Utilities.formatDate(new Date(), "JST", "yyyy-MM-dd HH:mm:ss"),
      analysis.item || "不明",
      analysis.kcal || 0,
      analysis.p    || 0,
      analysis.f    || 0,
      analysis.c    || 0,
      event.text    || ""
    ]);
    logToSheet("SUCCESS: Recorded Meal " + (analysis.item || "不明"));
  }
}

function callGeminiApi(text, imageBlob, isAnalysis) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const prompt = isAnalysis
    ? `栄養士として食事解析。1人前特定→数量計算→合計値を算出。入力:${text}`
    : text;

  const parts = [{ text: prompt }];

  if (imageBlob) {
    parts.push({
      inline_data: {
        mime_type: imageBlob.getContentType(),
        data: Utilities.base64Encode(imageBlob.getBytes())
      }
    });
  }

  const requestBody = { contents: [{ parts }] };

  if (isAnalysis) {
    // responseSchema で JSON を強制し、正規表現パースを不要にする
    requestBody.generationConfig = {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          item: { type: "STRING" },
          kcal: { type: "NUMBER" },
          p:    { type: "NUMBER" },
          f:    { type: "NUMBER" },
          c:    { type: "NUMBER" }
        },
        required: ["item", "kcal", "p", "f", "c"]
      }
    };
  }

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  const json = JSON.parse(res.getContentText());

  if (json?.candidates?.length > 0) {
    const resultText = json.candidates[0].content.parts[0].text;
    return isAnalysis ? JSON.parse(resultText) : resultText;
  }

  logToSheet("API Response Error: " + res.getContentText());
  throw new Error("Gemini API call failed");
}

function sendDailyReport()  { sendSummary("Daily");  }
function sendWeeklyReport() { sendSummary("Weekly"); }

function sendSummary(type) {
  const data = getFilteredData(type);
  if (!data || !data.count) return;

  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('SLACK_BOT_TOKEN');

  let message = "";

  if (type === "Daily") {
    const ss = SpreadsheetApp.openById(getSpreadsheetId());
    const weightSheet = ss.getSheetByName(SHEETS.WEIGHT);
    const lastWeight = weightSheet && weightSheet.getLastRow() > 1
      ? weightSheet.getRange(weightSheet.getLastRow(), 2).getValue()
      : "不明";

    const evalPrompt = `あなたは${PROFILE.persona}です。

筋肉への純粋な愛と、見る人を元気にする明るさが持ち味のお笑い芸人です。
ネタのパターンを機械的に繰り返すのではなく、その日のデータや状況に合わせて自然に語りかけてください。
ポジティブで体育会系だけど押しつけがましくなく、読んだ人が思わず笑ってしまうような温かみのあるコメントが理想です。
マークダウン記号（「**」「##」など）は使わず、400字程度で。

ユーザー名: ${PROFILE.name}
現在体重: ${lastWeight}kg　目標体重: ${TARGET.weight}kg
今日の実績: カロリー${data.stats.kcal.toFixed(0)}kcal / 目標${TARGET.kcal}kcal、P${data.stats.p.toFixed(1)}g / 目標${TARGET.p}g、F${data.stats.f.toFixed(1)}g、C${data.stats.c.toFixed(1)}g`;

    const evaluation = callGeminiApi(evalPrompt, null, false);

    message =
      `【Daily Report】\n` +
      `Energy: ${data.stats.kcal.toFixed(0)} / ${TARGET.kcal}\n` +
      `PFC: P${data.stats.p.toFixed(1)} F${data.stats.f.toFixed(1)} C${data.stats.c.toFixed(1)}\n` +
      `Weight: ${lastWeight}kg\n\n` +
      `【Comments】\n${evaluation}`;
  } else {
    const avgKcal = (data.stats.kcal / (data.countDays || 1)).toFixed(0);
    const avgP    = (data.stats.p    / (data.countDays || 1)).toFixed(1);
    const avgF    = (data.stats.f    / (data.countDays || 1)).toFixed(1);
    const avgC    = (data.stats.c    / (data.countDays || 1)).toFixed(1);
    const success = calculateSuccessDays(data.rawRows);

    message =
      `【Weekly Report】\n` +
      `Avg kcal: ${avgKcal} / ${TARGET.kcal}\n` +
      `Avg PFC: P${avgP} F${avgF} C${avgC}\n` +
      `Success days: ${success} / ${data.countDays}`;
  }

  UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${token}` },
    payload: JSON.stringify({
      channel: REPORT_CHANNEL,
      text: message
    })
  });
}

function getFilteredData(type) {
  const ss = SpreadsheetApp.openById(getSpreadsheetId());
  const sheet = ss.getSheetByName(SHEETS.FOOD);
  if (!sheet) return null;

  const rows = sheet.getDataRange().getValues();
  const nowJST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));

  // 日付の境目をAM4:00に設定（夜食を前日分として集計するため）
  const today4 = new Date(nowJST);
  today4.setHours(4, 0, 0, 0);
  if (nowJST < today4) today4.setDate(today4.getDate() - 1);

  let start, end;

  if (type === "Daily") {
    start = new Date(today4);
    start.setDate(start.getDate() - 1);
    end = new Date(today4);
  } else {
    start = new Date(today4);
    start.setDate(start.getDate() - 7);
    end = new Date(today4);
  }

  let stats = { kcal: 0, p: 0, f: 0, c: 0 }, rawRows = [], count = 0;
  const dates = new Set();

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const rowDate = new Date(rows[i][0]);

    if (rowDate >= start && rowDate < end) {
      stats.kcal += Number(rows[i][2] || 0);
      stats.p    += Number(rows[i][3] || 0);
      stats.f    += Number(rows[i][4] || 0);
      stats.c    += Number(rows[i][5] || 0);
      rawRows.push(rows[i]);
      count++;
      dates.add(rowDate.toDateString());
    }
  }

  return { stats, rawRows, count, countDays: dates.size || 1 };
}

function calculateSuccessDays(rows) {
  if (!rows || rows.length === 0) return 0;
  const daily = rows.reduce((acc, r) => {
    const d = new Date(r[0]).toDateString();
    acc[d] = (acc[d] || 0) + Number(r[2]);
    return acc;
  }, {});
  return Object.values(daily).filter(k => k <= TARGET.kcal + 100).length;
}

function logToSheet(msg) {
  try {
    const ss = SpreadsheetApp.openById(getSpreadsheetId());
    const sheet = ss.getSheetByName(SHEETS.DEBUG);
    if (sheet) sheet.appendRow([new Date(), msg]);
  } catch (e) {}
}
