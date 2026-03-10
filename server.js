// ==========================================================
// Todo管理アプリ - プッシュ通知サーバー
// Express + web-push + node-cron
// ==========================================================

require('dotenv').config();
const express = require('express');
const webPush = require('web-push');
const cron = require('node-cron');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- データファイルパス ----------
const DATA_DIR = path.join(__dirname, 'data');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const TODOS_FILE = path.join(DATA_DIR, 'todos.json');
const ENV_FILE = path.join(__dirname, '.env');

// ---------- データディレクトリ作成 ----------
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==========================================================
// VAPID鍵の管理（初回起動時に自動生成）
// ==========================================================

/**
 * VAPID鍵を初期化する
 * .envファイルに鍵がなければ新規生成して保存
 */
function initializeVapidKeys() {
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;

  // 鍵が未設定の場合は自動生成
  if (!publicKey || !privateKey) {
    console.log('[Server] VAPID鍵を新規生成しています...');
    const vapidKeys = webPush.generateVAPIDKeys();
    publicKey = vapidKeys.publicKey;
    privateKey = vapidKeys.privateKey;

    // .envファイルに保存
    const envContent = `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`;
    fs.writeFileSync(ENV_FILE, envContent, 'utf-8');
    console.log('[Server] VAPID鍵を .env に保存しました');

    // 現在のプロセスにもセット
    process.env.VAPID_PUBLIC_KEY = publicKey;
    process.env.VAPID_PRIVATE_KEY = privateKey;
  }

  // web-pushにVAPID鍵を設定
  webPush.setVapidDetails(
    'mailto:todo-app@example.com',
    publicKey,
    privateKey
  );

  console.log('[Server] VAPID公開鍵:', publicKey);
}

// VAPID鍵を初期化
initializeVapidKeys();

// ==========================================================
// ミドルウェア
// ==========================================================

app.use(cors());
app.use(express.json());

// 静的ファイル配信（フロントエンドのHTML/CSS/JS）
app.use(express.static(path.join(__dirname), {
  // service-worker.jsのキャッシュを無効化
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('service-worker.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ==========================================================
// データ管理（JSONファイル）
// ==========================================================

/**
 * プッシュ通知のサブスクリプション一覧を読み込む
 * @returns {Array} サブスクリプションの配列
 */
function loadSubscriptions() {
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Server] サブスクリプション読み込みエラー:', e);
  }
  return [];
}

/**
 * サブスクリプション一覧を保存する
 * @param {Array} subs - サブスクリプションの配列
 */
function saveSubscriptions(subs) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2), 'utf-8');
}

/**
 * Todoデータを読み込む
 * @returns {Array} Todoの配列
 */
function loadTodos() {
  try {
    if (fs.existsSync(TODOS_FILE)) {
      return JSON.parse(fs.readFileSync(TODOS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[Server] Todo読み込みエラー:', e);
  }
  return [];
}

/**
 * Todoデータを保存する
 * @param {Array} todos - Todoの配列
 */
function saveTodos(todos) {
  fs.writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2), 'utf-8');
}

// ==========================================================
// 通知済み管理
// ==========================================================

// 通知済みIDを管理するセット（サーバー再起動でリセット）
const NOTIFIED_FILE = path.join(DATA_DIR, 'notified.json');

/**
 * 通知済みIDセットを読み込む
 * @returns {Set}
 */
function loadNotifiedIds() {
  try {
    if (fs.existsSync(NOTIFIED_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(NOTIFIED_FILE, 'utf-8')));
    }
  } catch (e) {
    console.error('[Server] 通知済みID読み込みエラー:', e);
  }
  return new Set();
}

/**
 * 通知済みIDセットを保存
 * @param {Set} ids
 */
function saveNotifiedIds(ids) {
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...ids], null, 2), 'utf-8');
}

let notifiedIds = loadNotifiedIds();

// ==========================================================
// API エンドポイント
// ==========================================================

/**
 * VAPID公開鍵を取得
 * フロントエンドがプッシュ通知登録時に使用
 */
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

/**
 * プッシュ通知サブスクリプションを登録
 * ブラウザがプッシュ通知を購読した際に呼ばれる
 */
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'サブスクリプションが無効です' });
  }

  // 既存のサブスクリプションを読み込み
  const subs = loadSubscriptions();

  // 重複チェック（同じendpointがあれば更新）
  const existingIndex = subs.findIndex(s => s.endpoint === subscription.endpoint);
  if (existingIndex !== -1) {
    subs[existingIndex] = subscription;
  } else {
    subs.push(subscription);
  }

  saveSubscriptions(subs);
  console.log('[Server] サブスクリプション登録完了（合計:', subs.length, '件）');
  res.json({ success: true, message: 'サブスクリプション登録完了' });
});

/**
 * サブスクリプションを解除
 */
app.post('/api/unsubscribe', (req, res) => {
  const { endpoint } = req.body;

  if (!endpoint) {
    return res.status(400).json({ error: 'endpointが必要です' });
  }

  let subs = loadSubscriptions();
  subs = subs.filter(s => s.endpoint !== endpoint);
  saveSubscriptions(subs);

  console.log('[Server] サブスクリプション解除（残り:', subs.length, '件）');
  res.json({ success: true });
});

/**
 * Todoデータをサーバーに同期
 * フロントエンドでTodoが更新された際に呼ばれる
 */
app.post('/api/save-todos', (req, res) => {
  const { todos } = req.body;

  if (!Array.isArray(todos)) {
    return res.status(400).json({ error: 'todosが配列ではありません' });
  }

  saveTodos(todos);
  console.log('[Server] Todoデータ同期完了（', todos.length, '件）');
  res.json({ success: true });
});

/**
 * テスト通知を送信
 * 動作確認用
 */
app.post('/api/test-notification', (req, res) => {
  const subs = loadSubscriptions();

  if (subs.length === 0) {
    return res.status(400).json({ error: '登録されたサブスクリプションがありません' });
  }

  const payload = JSON.stringify({
    title: '🔔 テスト通知',
    body: 'プッシュ通知が正常に動作しています！',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    url: '/'
  });

  // 全サブスクリプションに送信
  const sendPromises = subs.map(sub =>
    webPush.sendNotification(sub, payload).catch(err => {
      console.error('[Server] 通知送信エラー:', err.statusCode);
      // 無効なサブスクリプションを削除
      if (err.statusCode === 410 || err.statusCode === 404) {
        return { remove: sub.endpoint };
      }
      return null;
    })
  );

  Promise.all(sendPromises).then(results => {
    // 無効なサブスクリプションを削除
    const toRemove = results.filter(r => r && r.remove).map(r => r.remove);
    if (toRemove.length > 0) {
      const updatedSubs = subs.filter(s => !toRemove.includes(s.endpoint));
      saveSubscriptions(updatedSubs);
    }
    res.json({ success: true, sent: subs.length - toRemove.length });
  });
});

// ==========================================================
// プッシュ通知スケジューラ
// ==========================================================

/**
 * 全サブスクリプションにプッシュ通知を送信する
 * @param {string} title - 通知タイトル
 * @param {string} body - 通知本文
 */
function sendPushToAll(title, body) {
  const subs = loadSubscriptions();

  if (subs.length === 0) return;

  const payload = JSON.stringify({
    title,
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    url: '/'
  });

  const invalidEndpoints = [];

  subs.forEach(sub => {
    webPush.sendNotification(sub, payload).catch(err => {
      console.error('[Server] プッシュ送信失敗:', err.statusCode || err.message);
      // 410 Gone や 404 の場合はサブスクリプションを削除
      if (err.statusCode === 410 || err.statusCode === 404) {
        invalidEndpoints.push(sub.endpoint);
      }
    });
  });

  // 無効なサブスクリプションを定期的にクリーンアップ
  setTimeout(() => {
    if (invalidEndpoints.length > 0) {
      const currentSubs = loadSubscriptions();
      const cleaned = currentSubs.filter(s => !invalidEndpoints.includes(s.endpoint));
      saveSubscriptions(cleaned);
      console.log('[Server] 無効なサブスクリプションを削除:', invalidEndpoints.length, '件');
    }
  }, 5000);
}

/**
 * Todoの通知時間をチェックし、該当するものがあれば通知を送信
 * 毎分実行される
 */
function checkAndSendNotifications() {
  const todos = loadTodos();
  if (todos.length === 0) return;

  const now = new Date();
  // 現在時刻をdatetime-local形式に変換（分単位）
  const currentMinute = `${now.getFullYear()}-${
    String(now.getMonth() + 1).padStart(2, '0')}-${
    String(now.getDate()).padStart(2, '0')}T${
    String(now.getHours()).padStart(2, '0')}:${
    String(now.getMinutes()).padStart(2, '0')}`;

  let changed = false;

  todos.forEach(todo => {
    // 完了済み・通知時間未設定・通知済みはスキップ
    if (todo.completed || !todo.notifyTime || notifiedIds.has(`push-${todo.id}`)) return;

    // 通知時間と現在時刻を比較
    if (todo.notifyTime === currentMinute) {
      console.log('[Server] 通知送信:', todo.title);
      sendPushToAll(
        '🔔 Todo通知',
        `「${todo.title}」のタスクの時間です`
      );
      notifiedIds.add(`push-${todo.id}`);
      changed = true;
    }
  });

  if (changed) {
    saveNotifiedIds(notifiedIds);
  }
}

/**
 * 毎朝9:00に今日のTodo一覧を通知
 */
function checkMorningNotification() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const morningKey = `morning-${todayStr}`;

  // 9:00でない場合、または既に通知済みの場合はスキップ
  if (now.getHours() !== 9 || now.getMinutes() !== 0) return;
  if (notifiedIds.has(morningKey)) return;

  const todos = loadTodos();
  const todayTodos = todos.filter(t => t.dueDate === todayStr && !t.completed);

  if (todayTodos.length === 0) return;

  const todoList = todayTodos.map(t => `・${t.title}`).join('\n');
  sendPushToAll('🌅 今日のTodo', `${todayTodos.length}件のタスクがあります\n${todoList}`);

  notifiedIds.add(morningKey);
  saveNotifiedIds(notifiedIds);
}

// ---------- cronジョブ設定 ----------
// 毎分実行：個別Todoの通知時間チェック & 朝9時通知
cron.schedule('* * * * *', () => {
  checkAndSendNotifications();
  checkMorningNotification();
});

console.log('[Server] 通知スケジューラを開始しました（毎分チェック）');

// ==========================================================
// サーバー起動
// ==========================================================

app.listen(PORT, () => {
  console.log(`[Server] Todo管理アプリサーバーが起動しました`);
  console.log(`[Server] URL: http://localhost:${PORT}`);
  console.log(`[Server] プッシュ通知: 有効`);
});
