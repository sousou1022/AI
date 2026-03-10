// ==========================================================
// Service Worker - オフライン対応 & キャッシュ管理
// ==========================================================

// キャッシュ名（バージョン管理用）
const CACHE_NAME = 'todo-app-v1';

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
