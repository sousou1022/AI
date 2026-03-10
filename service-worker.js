// ==========================================================
// Service Worker - オフライン対応 & キャッシュ管理 & プッシュ通知
// ==========================================================

// キャッシュ名（バージョン管理用）
const CACHE_NAME = 'todo-app-v2';

// キャッシュ対象の静的ファイル一覧
const STATIC_ASSETS = [
  './',
  './index.html',
  './calendar.html',
  './style.css',
  './script.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ---------- インストールイベント ----------
// アプリ初回読み込み時に静的アセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 静的アセットをキャッシュ中...');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // 即座にアクティブ化
        return self.skipWaiting();
      })
  );
});

// ---------- アクティベートイベント ----------
// 古いキャッシュを削除する
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] 古いキャッシュを削除:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // 全クライアントに即時反映
        return self.clients.claim();
      })
  );
});

// ---------- フェッチイベント ----------
// ネットワーク優先、失敗時はキャッシュから返す
self.addEventListener('fetch', (event) => {
  // APIリクエストはキャッシュしない
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // レスポンスをキャッシュに保存
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request);
      })
  );
});

// ==========================================================
// プッシュ通知の受信
// ==========================================================

// ---------- pushイベント ----------
// サーバーからのプッシュ通知を受信して表示
self.addEventListener('push', (event) => {
  console.log('[SW] プッシュ通知を受信');

  let data = {
    title: '🔔 Todo通知',
    body: '新しい通知があります',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    url: '/'
  };

  // プッシュデータがあればパース
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // 通知を表示
  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [200, 100, 200],  // バイブレーションパターン
    data: {
      url: data.url || '/'
    },
    // 通知をグループ化（同じtagは上書き）
    tag: 'todo-notification',
    renotify: true,
    // アクションボタン
    actions: [
      { action: 'open', title: '📋 アプリを開く' },
      { action: 'close', title: '✕ 閉じる' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ---------- notificationclickイベント ----------
// 通知をタップした時の処理
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] 通知がクリックされました');
  event.notification.close();

  // 「閉じる」アクションの場合は何もしない
  if (event.action === 'close') return;

  // アプリのURLを開く
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    // 既に開いているタブがあればフォーカス、なければ新規タブ
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(urlToOpen);
      })
  );
});

// ---------- notificationcloseイベント ----------
// 通知が閉じられた時（ログ目的）
self.addEventListener('notificationclose', (event) => {
  console.log('[SW] 通知が閉じられました');
});
