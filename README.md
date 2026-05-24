# slack-calorie-tracker

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Platform](https://img.shields.io/badge/platform-Google%20Apps%20Script-blue?logo=google)
![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini%20AI-8E75B2?logo=google&logoColor=white)

Slackに食事の写真やテキストを投稿するだけで、Gemini AIがカロリー・PFCを自動計算しスプレッドシートに記録。毎日夜にAIコメント付きデイリーレポートをSlackに投稿するGoogle Apps Script (GAS)ツールです。

## 機能

- **食事ログ**：Slackに食事テキスト or 画像を投稿 → Geminiが自動でカロリー・PFC（タンパク質・脂質・炭水化物）を解析してスプレッドシートに記録
- **体重ログ**：Slackに体重を投稿（例：`52.5kg 18.0%`）→ BMI・目標差を計算して記録
- **デイリーレポート**：毎日定時に実績 vs 目標を集計し、AIコメント付きでSlackに投稿
- **ウィークリーレポート**：週次で平均カロリー・PFC・目標達成日数を集計して投稿

## 必要なもの

- Google アカウント（Google Sheets + GAS用）
- Slack ワークスペース（Bot作成権限）
- [Gemini API キー](https://aistudio.google.com/app/apikey)

## セットアップ

### 1. Google スプレッドシートの準備

新しいスプレッドシートを作成し、以下の3つのシートを作成します：

**食事ログシート**（デフォルト名: `food-log`）

| A: timestamp | B: item | C: kcal | D: p | E: f | F: c | G: raw_text |
|---|---|---|---|---|---|---|

**体重ログシート**（デフォルト名: `weight-log`）

| A: timestamp | B: weight | C: body_fat% | D: bmi | E: diff | F: raw_text |
|---|---|---|---|---|---|

**デバッグシート**（デフォルト名: `Debug`）

| A: timestamp | B: message |
|---|---|

スプレッドシートのURLから **スプレッドシートID** を控えておきます。
```
https://docs.google.com/spreadsheets/d/【ここがID】/edit
```

### 2. Slack アプリの作成

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. **OAuth & Permissions** → **Bot Token Scopes** に以下を追加：
   - `chat:write`
   - `files:read`
3. ワークスペースにインストール → **Bot User OAuth Token**（`xoxb-...`）を控える
4. **Event Subscriptions** → Enable Events をオン（Request URLはGASデプロイ後に設定）
5. **Subscribe to bot events** に `message.channels` を追加
6. 食事・体重を投稿するチャンネルにBotを招待（`/invite @ボット名`）

チャンネルIDの確認方法：Slackでチャンネル名を右クリック → **チャンネル詳細を表示** → 画面下部に表示

### 3. GAS のセットアップ

1. [script.google.com](https://script.google.com) で新しいプロジェクトを作成
2. `Code.gs` の内容を貼り付け
3. ファイル冒頭の **ユーザー設定セクション** を自分の値に変更：

```javascript
// ※ 以下はサンプル値です。自分の目標・身長に書き換えてください
const TARGET = { kcal: 2000, p: 100, f: 60, c: 250, weight: 65.0 };
const PROFILE = { name: "YourName", persona: "なかやまきんに君" }; // persona は自由に変更可
const HEIGHT_M = 1.70;
const SHEETS = { FOOD: 'food-log', WEIGHT: 'weight-log', DEBUG: 'Debug' };
// REPORT_CHANNEL はチャンネル名、CHANNEL_IDS はチャンネルIDで指定（両者で形式が異なる点に注意）
const REPORT_CHANNEL = 'diet-general';
const CHANNEL_IDS = { FOOD: 'C000000000', WEIGHT: 'C000000001' };
```

4. **プロジェクトの設定** → **スクリプト プロパティ** に以下を追加：

| プロパティ名 | 値 |
|---|---|
| `SPREADSHEET_ID` | スプレッドシートID |
| `SLACK_BOT_TOKEN` | `xoxb-...` |
| `GEMINI_API_KEY` | Gemini APIキー |

### 4. デプロイ

1. **デプロイ** → **新しいデプロイ** → 種類: **ウェブアプリ**
2. 「次のユーザーとして実行」→ **自分**
3. 「アクセスできるユーザー」→ **全員**
4. デプロイ → 表示された **URL** を控える

### 5. Slack Event Subscriptions に URL を登録

1. Slackアプリ管理 → **Event Subscriptions** → Request URLに上記のデプロイURLを貼り付け
2. `✓ Verified` と表示されればOK

### 6. デイリーレポートのトリガー設定

GASエディタ → **トリガー（時計アイコン）** → トリガーを追加：

| 項目 | 設定 |
|---|---|
| 実行する関数 | `sendDailyReport` |
| イベントのソース | 時間主導型 |
| 時間ベースのトリガーのタイプ | 日付ベースのタイマー |
| 時刻 | 午後9時〜10時（お好みで） |

### 7. ウィークリーレポートのトリガー設定（任意）

同じくトリガーを追加：

| 項目 | 設定 |
|---|---|
| 実行する関数 | `sendWeeklyReport` |
| イベントのソース | 時間主導型 |
| 時間ベースのトリガーのタイプ | 週ベースのタイマー |
| 曜日 | 日曜日（お好みで） |
| 時刻 | 午後9時〜10時（お好みで） |

## 使い方

### 食事を記録する

食事ログ用チャンネルにテキストまたは画像を投稿するだけです。

```
ランチ：鶏むね定食 ご飯少なめ
```
または食事の写真を投稿するとGeminiが自動解析します。

### 体重を記録する

体重ログ用チャンネルに投稿します。

```
72.5kg 18.5%
```
体重のみでも記録できます（`72.5`）。

### デイリーレポートのサンプル

```
【Daily Report】
Energy: 1850 / 2000
PFC: P98.3 F55.1 C238.4
Weight: 72.5kg

【Comments】
〇〇さん、今日もよく頑張りました！
タンパク質は目標をクリア、素晴らしいです！
カロリーも目標内に収まっていますね。
（AIペルソナによるアドバイスが続きます）
```

### ウィークリーレポートのサンプル

```
【Weekly Report】
Avg kcal: 1920 / 2000
Avg PFC: P95.2 F52.8 C235.1
Success days: 5 / 7
```

## ファイル構成

```
Code.gs     ── メインスクリプト（全機能）
README.md   ── セットアップガイド
```

## 注意事項

- Gemini APIの無料枠（2025年時点）: 1日1500リクエストまで無料
- GASのトリガーは日本時間（JST）で動作します
- 食事の日付境界はAM4:00に設定しています（深夜の食事を前日分として集計）
- APIキー・トークン・スプレッドシートIDはコードに直書きせず、必ずスクリプトプロパティに設定してください

## ライセンス

[MIT License](LICENSE)
