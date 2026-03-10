// ==========================================================
// Todo管理アプリ - メインスクリプト
// CRUD操作・通知・カレンダー・Service Worker管理
// ==========================================================

// ---------- 定数 ----------
const STORAGE_KEY = 'todo-app-data';          // localStorageのキー
const NOTIFIED_KEY = 'todo-app-notified';     // 通知済みIDのキー
const CHECK_INTERVAL = 60000;                  // 通知チェック間隔（1分）

// サーバーURL（同一オリジンの場合は空文字）
const SERVER_URL = '';

// ---------- 状態管理 ----------
let todos = [];           // Todoリスト
let editingId = null;     // 現在編集中のTodo ID
let currentFilter = 'all'; // 現在のフィルター

// ==========================================================
// データ操作（localStorage）
// ==========================================================

/**
 * localStorageからTodoデータを読み込む
 * @returns {Array} Todoの配列
 */
function loadTodos() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('データの読み込みに失敗:', e);
    return [];
  }
}

/**
 * localStorageにTodoデータを保存する
 */
function saveTodos() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
    // サーバーにもTodoデータを同期
    syncTodosToServer();
  } catch (e) {
    console.error('データの保存に失敗:', e);
  }
}

/**
 * Todoデータをサーバーに同期する
 * サーバーが通知スケジュールに使用するため
 */
function syncTodosToServer() {
  fetch(`${SERVER_URL}/api/save-todos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ todos })
  }).catch(err => {
    // サーバーが起動していない場合は無視（オフライン対応）
    console.warn('サーバー同期に失敗（オフラインの可能性）:', err.message);
  });
}

/**
 * 新しいTodoを追加する
 * @param {Object} todoData - Todoの入力データ
 */
function addTodo(todoData) {
  const todo = {
    id: Date.now(),                              // ユニークID（タイムスタンプ）
    title: todoData.title,                       // タイトル（必須）
    memo: todoData.memo || '',                   // メモ（任意）
    dueDate: todoData.dueDate || '',             // 期限日
    notifyTime: todoData.notifyTime || '',       // 通知時間
    priority: todoData.priority || '中',          // 優先度（低/中/高）
    completed: false,                            // 完了状態
    createdAt: new Date().toISOString()          // 作成日時
  };
  todos.push(todo);
  saveTodos();
  return todo;
}

/**
 * Todoを更新する
 * @param {number} id - 更新対象のID
 * @param {Object} updateData - 更新データ
 */
function updateTodo(id, updateData) {
  const index = todos.findIndex(t => t.id === id);
  if (index !== -1) {
    todos[index] = { ...todos[index], ...updateData };
    saveTodos();
  }
}

/**
 * Todoを削除する
 * @param {number} id - 削除対象のID
 */
function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  saveTodos();
}

/**
 * Todoの完了状態を切り替える
 * @param {number} id - 対象のID
 */
function toggleComplete(id) {
  const todo = todos.find(t => t.id === id);
  if (todo) {
    todo.completed = !todo.completed;
    saveTodos();
  }
}

// ==========================================================
// 日付ユーティリティ
// ==========================================================

/**
 * 今日の日付文字列を取得（YYYY-MM-DD形式）
 * @returns {string}
 */
function getTodayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 日付を表示用にフォーマット（M/D形式）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 日付を詳細表示用にフォーマット（YYYY年M月D日形式）
 * @param {string} dateStr - YYYY-MM-DD形式の日付
 * @returns {string}
 */
function formatDateFull(dateStr) {
  if (!dateStr) return '未設定';
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 通知時間を表示用にフォーマット
 * @param {string} notifyTime - datetime-local形式
 * @returns {string}
 */
function formatNotifyTime(notifyTime) {
  if (!notifyTime) return '未設定';
  const d = new Date(notifyTime);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 期限切れかどうかを判定
 * @param {string} dueDate - 期限日
 * @returns {boolean}
 */
function isOverdue(dueDate) {
  if (!dueDate) return false;
  const today = new Date(getTodayString());
  const due = new Date(dueDate);
  return due < today;
}

/**
 * 今日が期限かどうかを判定
 * @param {string} dueDate - 期限日
 * @returns {boolean}
 */
function isDueToday(dueDate) {
  return dueDate === getTodayString();
}

// ==========================================================
// ソート・フィルター
// ==========================================================

/**
 * Todoリストをソートする（期限の近い順、未完了優先）
 * @param {Array} list - Todoの配列
 * @returns {Array}
 */
function sortTodos(list) {
  return [...list].sort((a, b) => {
    // 未完了を先に表示
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    
    // 期限なしは後ろに
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && !b.dueDate) return -1;
    
    // 期限の近い順
    if (a.dueDate && b.dueDate) {
      return new Date(a.dueDate) - new Date(b.dueDate);
    }
    
    // 優先度順（高 > 中 > 低）
    const order = { '高': 0, '中': 1, '低': 2 };
    return (order[a.priority] || 1) - (order[b.priority] || 1);
  });
}

/**
 * フィルターに基づいてTodoを絞り込む
 * @param {string} filter - フィルター種別
 * @returns {Array}
 */
function filterTodos(filter) {
  switch (filter) {
    case 'active':
      return todos.filter(t => !t.completed);
    case 'completed':
      return todos.filter(t => t.completed);
    case 'today':
      return todos.filter(t => isDueToday(t.dueDate));
    case 'overdue':
      return todos.filter(t => isOverdue(t.dueDate) && !t.completed);
    default:
      return [...todos];
  }
}

// ==========================================================
// UI描画（index.html用）
// ==========================================================

/**
 * 今日のTodoセクションを描画する
 */
function renderTodayTodos() {
  const container = document.getElementById('today-todos');
  if (!container) return;

  const todayTodos = todos.filter(t => isDueToday(t.dueDate) && !t.completed);
  
  if (todayTodos.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">✨</div>
        <p>今日のタスクはありません</p>
      </div>
    `;
    return;
  }

  container.innerHTML = todayTodos.map(todo => createTodoCardHTML(todo)).join('');
}

/**
 * Todo一覧を描画する
 */
function renderTodoList() {
  const container = document.getElementById('todo-list');
  if (!container) return;

  const filtered = filterTodos(currentFilter);
  const sorted = sortTodos(filtered);

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>タスクがありません</p>
      </div>
    `;
    return;
  }

  container.innerHTML = sorted.map(todo => createTodoCardHTML(todo)).join('');
}

/**
 * TodoカードのHTMLを生成する
 * @param {Object} todo - Todoオブジェクト
 * @returns {string}
 */
function createTodoCardHTML(todo) {
  const overdueClass = isOverdue(todo.dueDate) && !todo.completed ? 'overdue' : '';
  const completedClass = todo.completed ? 'completed' : '';
  const priorityClass = todo.priority === '高' ? 'high' : todo.priority === '中' ? 'medium' : 'low';
  const priorityLabel = todo.priority;

  return `
    <div class="todo-card ${completedClass} ${overdueClass}" data-id="${todo.id}">
      <input 
        type="checkbox" 
        class="todo-checkbox" 
        ${todo.completed ? 'checked' : ''}
        onclick="event.stopPropagation(); handleToggle(${todo.id})"
        id="checkbox-${todo.id}"
      >
      <div class="todo-content" onclick="showDetail(${todo.id})">
        <div class="todo-title">${escapeHTML(todo.title)}</div>
        <div class="todo-meta">
          ${todo.dueDate ? `<span class="todo-due">📅 ${formatDate(todo.dueDate)}</span>` : ''}
          <span class="priority-badge ${priorityClass}">${priorityLabel}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * HTMLエスケープ処理
 * @param {string} str - エスケープする文字列
 * @returns {string}
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * メイン画面全体を再描画する
 */
function renderAll() {
  renderTodayTodos();
  renderTodoList();
}

// ==========================================================
// イベントハンドラー
// ==========================================================

/**
 * 完了チェック切り替え
 * @param {number} id - TodoのID
 */
function handleToggle(id) {
  toggleComplete(id);
  renderAll();
}

/**
 * フィルタータブ切り替え
 * @param {string} filter - フィルター名
 */
function setFilter(filter) {
  currentFilter = filter;
  
  // タブのアクティブ状態を更新
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.filter === filter);
  });
  
  renderTodoList();
}

// ==========================================================
// モーダル管理
// ==========================================================

/**
 * モーダルを開く
 * @param {string} modalId - モーダルのID
 */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    // bodyのスクロールを停止
    document.body.style.overflow = 'hidden';
  }
}

/**
 * モーダルを閉じる
 * @param {string} modalId - モーダルのID
 */
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

/**
 * Todo追加モーダルを開く
 */
function openAddModal() {
  // フォームをリセット
  const form = document.getElementById('add-form');
  if (form) form.reset();
  openModal('add-modal');
}

/**
 * Todo追加フォームの送信処理
 * @param {Event} event - フォームイベント
 */
function handleAddSubmit(event) {
  event.preventDefault();
  
  const title = document.getElementById('add-title').value.trim();
  if (!title) return;

  addTodo({
    title: title,
    memo: document.getElementById('add-memo').value.trim(),
    dueDate: document.getElementById('add-dueDate').value,
    notifyTime: document.getElementById('add-notifyTime').value,
    priority: document.getElementById('add-priority').value
  });

  closeModal('add-modal');
  renderAll();
}

/**
 * Todo詳細モーダルを表示する
 * @param {number} id - TodoのID
 */
function showDetail(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  const priorityClass = todo.priority === '高' ? 'high' : todo.priority === '中' ? 'medium' : 'low';
  
  const content = document.getElementById('detail-content');
  if (content) {
    content.innerHTML = `
      <div class="detail-item">
        <div class="detail-label">タイトル</div>
        <div class="detail-value">${escapeHTML(todo.title)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">メモ</div>
        <div class="detail-value">${todo.memo ? escapeHTML(todo.memo) : '未設定'}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">期限</div>
        <div class="detail-value">${formatDateFull(todo.dueDate)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">通知時間</div>
        <div class="detail-value">${formatNotifyTime(todo.notifyTime)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">優先度</div>
        <div class="detail-value"><span class="priority-badge ${priorityClass}">${todo.priority}</span></div>
      </div>
      <div class="detail-item">
        <div class="detail-label">状態</div>
        <div class="detail-value">${todo.completed ? '✅ 完了' : '⬜ 未完了'}</div>
      </div>
      <div class="btn-group">
        <button class="btn btn-secondary" onclick="openEditModal(${todo.id})">✏️ 編集</button>
        <button class="btn btn-primary" onclick="handleToggle(${todo.id}); closeModal('detail-modal'); renderAll();">
          ${todo.completed ? '⬜ 未完了に戻す' : '✅ 完了にする'}
        </button>
      </div>
      <div class="btn-group">
        <button class="btn btn-danger" onclick="handleDelete(${todo.id})">🗑️ 削除</button>
      </div>
    `;
  }

  openModal('detail-modal');
}

/**
 * Todo削除処理
 * @param {number} id - TodoのID
 */
function handleDelete(id) {
  if (confirm('このTodoを削除しますか？')) {
    deleteTodo(id);
    closeModal('detail-modal');
    renderAll();
  }
}

/**
 * 編集モーダルを開く
 * @param {number} id - TodoのID
 */
function openEditModal(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;

  editingId = id;

  // フォームに現在の値をセット
  document.getElementById('edit-title').value = todo.title;
  document.getElementById('edit-memo').value = todo.memo || '';
  document.getElementById('edit-dueDate').value = todo.dueDate || '';
  document.getElementById('edit-notifyTime').value = todo.notifyTime || '';
  document.getElementById('edit-priority').value = todo.priority;

  closeModal('detail-modal');
  openModal('edit-modal');
}

/**
 * Todo編集フォームの送信処理
 * @param {Event} event - フォームイベント
 */
function handleEditSubmit(event) {
  event.preventDefault();

  const title = document.getElementById('edit-title').value.trim();
  if (!title || !editingId) return;

  updateTodo(editingId, {
    title: title,
    memo: document.getElementById('edit-memo').value.trim(),
    dueDate: document.getElementById('edit-dueDate').value,
    notifyTime: document.getElementById('edit-notifyTime').value,
    priority: document.getElementById('edit-priority').value
  });

  editingId = null;
  closeModal('edit-modal');
  renderAll();
}

// ==========================================================
// 通知機能
// ==========================================================

/**
 * ブラウザ通知の許可をリクエストする
 */
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/**
 * ブラウザ通知を送信する
 * @param {string} title - 通知タイトル
 * @param {string} body - 通知本文
 */
function sendNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body: body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png'
    });
  }
}

/**
 * 通知済みIDセットを取得する
 * @returns {Set}
 */
function getNotifiedIds() {
  try {
    const data = localStorage.getItem(NOTIFIED_KEY);
    return data ? new Set(JSON.parse(data)) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * 通知済みIDを保存する
 * @param {Set} ids - 通知済みIDのセット
 */
function saveNotifiedIds(ids) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...ids]));
}

/**
 * Todoの通知時間をチェックし、一致したら通知を送信する
 * 1分ごとに呼び出される
 */
function checkNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = new Date();
  // 現在時刻を分単位で取得（秒は無視）
  const currentMinute = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const notifiedIds = getNotifiedIds();

  todos.forEach(todo => {
    // 完了済み・通知時間未設定・通知済みはスキップ
    if (todo.completed || !todo.notifyTime || notifiedIds.has(`notify-${todo.id}`)) return;

    // notifyTimeをdatetime-local形式と比較
    if (todo.notifyTime === currentMinute) {
      sendNotification('🔔 Todo通知', `「${todo.title}」のタスクの時間です`);
      notifiedIds.add(`notify-${todo.id}`);
    }
  });

  saveNotifiedIds(notifiedIds);
}

/**
 * 毎日朝9時の今日のTodo通知をチェック
 */
function checkMorningNotification() {
  const now = new Date();
  
  // 9:00かどうかを確認
  if (now.getHours() !== 9 || now.getMinutes() !== 0) return;

  // 今日すでに朝通知済みかチェック
  const notifiedIds = getNotifiedIds();
  const todayKey = `morning-${getTodayString()}`;
  if (notifiedIds.has(todayKey)) return;

  // 今日が期限のTodoを取得
  const todayTodos = todos.filter(t => isDueToday(t.dueDate) && !t.completed);
  
  // todoが無い場合は通知しない
  if (todayTodos.length === 0) return;

  // 通知本文を構築
  const todoList = todayTodos.map(t => `・${t.title}`).join('\n');
  sendNotification('🔔 今日のTodo', todoList);

  // 通知済みとして記録
  notifiedIds.add(todayKey);
  saveNotifiedIds(notifiedIds);
}

/**
 * 定期的な通知チェックを開始する
 */
function startNotificationCheck() {
  // 初回チェック
  checkNotifications();
  checkMorningNotification();

  // 1分ごとにチェック
  setInterval(() => {
    checkNotifications();
    checkMorningNotification();
  }, CHECK_INTERVAL);
}

// ==========================================================
// カレンダー機能
// ==========================================================

// カレンダーの現在表示月
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth(); // 0-indexed

/**
 * カレンダーを描画する
 */
function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const monthLabel = document.getElementById('calendar-month');
  if (!grid || !monthLabel) return;

  // 月ラベルの更新
  monthLabel.textContent = `${calendarYear}年${calendarMonth + 1}月`;

  // 曜日ヘッダー
  const dayHeaders = ['日', '月', '火', '水', '木', '金', '土'];
  let html = dayHeaders.map(d => `<div class="calendar-day-header">${d}</div>`).join('');

  // 月の初日と最終日を取得
  const firstDay = new Date(calendarYear, calendarMonth, 1);
  const lastDay = new Date(calendarYear, calendarMonth + 1, 0);
  const startDayOfWeek = firstDay.getDay();

  // 前月の日を埋める
  const prevLastDay = new Date(calendarYear, calendarMonth, 0);
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const day = prevLastDay.getDate() - i;
    const dateStr = formatDateStr(calendarYear, calendarMonth - 1, day);
    html += createCalendarDayHTML(day, dateStr, true);
  }

  // 当月の日
  const today = getTodayString();
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const dateStr = formatDateStr(calendarYear, calendarMonth, day);
    const isToday = dateStr === today;
    html += createCalendarDayHTML(day, dateStr, false, isToday);
  }

  // 次月の日を埋める（6行分に調整）
  const totalCells = startDayOfWeek + lastDay.getDate();
  const remainingCells = Math.ceil(totalCells / 7) * 7 - totalCells;
  for (let day = 1; day <= remainingCells; day++) {
    const dateStr = formatDateStr(calendarYear, calendarMonth + 1, day);
    html += createCalendarDayHTML(day, dateStr, true);
  }

  grid.innerHTML = html;
}

/**
 * 日付文字列をYYYY-MM-DD形式で生成
 * @param {number} year - 年
 * @param {number} month - 月（0-indexed）
 * @param {number} day - 日
 * @returns {string}
 */
function formatDateStr(year, month, day) {
  const d = new Date(year, month, day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * カレンダーの1日分のHTMLを生成
 * @param {number} day - 日
 * @param {string} dateStr - 日付文字列
 * @param {boolean} isOtherMonth - 他の月かどうか
 * @param {boasync function subscribePush() {
  try {
    // 診断用
    console.log('[Push] 登録処理を開始...');

    // 通知許可を確認
    if (!('Notification' in window)) {
      alert('❌ このブラウザは通知に対応していないか、PWAとしてインストールされていません。\n\niPhoneの場合は「ホーム画面に追加」してから起動してください。');
      return;
    }

    const permission = await Notification.requestPermission();
    console.log('[Push] 通知許可ステータス:', permission);

    if (permission !== 'granted') {
      alert('⚠️ 通知が許可されませんでした。ブラウザの設定から通知を許可してください。');
      updatePushUI(false);
      return;
    }

    // Service Workerの準備を待つ
    console.log('[Push] Service Workerの準備を待機中...');
    const registration = await navigator.serviceWorker.ready;

    // 既存のサブスクリプションを確認
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      console.log('[Push] 新しいサブスクリプションを作成します...');
      // サーバーからVAPID公開鍵を取得
      const response = await fetch(`${SERVER_URL}/api/vapid-public-key`);
      if (!response.ok) throw new Error('サーバーから鍵を取得できませんでした');
      
      const { publicKey } = await response.json();
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      // プッシュ通知を購読
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
      });
    }

    // サーバーにサブスクリプションを登録
    const subRes = await fetch(`${SERVER_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    if (!subRes.ok) throw new Error('サーバーへの登録に失敗しました');

    pushSubscription = subscription;
    alert('✅ プッシュ通知が有効になりました！');
    updatePushUI(true);

    // Todoデータもサーバーに同期
    syncTodosToServer();

  } catch (error) {
    console.error('[Push] 登録失敗:', error);
    alert(`❌ エラーが発生しました:\n${error.message}\n\nサーバー設定や接続環境を確認してください。`);
    updatePushUI(false);
  }
}day-detail-content');
  const title = document.getElementById('day-detail-title');
  
  if (!panel || !title) return;

  title.textContent = formatDateFull(dateStr) + ' のTodo';

  if (dayTodos.length === 0) {
    panel.innerHTML = `
      <div class="empty-state">
        <div class="icon">📅</div>
        <p>この日のタスクはありません</p>
      </div>
    `;
  } else {
    panel.innerHTML = dayTodos.map(todo => createTodoCardHTML(todo)).join('');
  }

  openModal('day-detail-modal');
}

// ==========================================================
// Service Worker登録 & プッシュ通知
// ==========================================================

// プッシュ通知のサブスクリプションを保持
let pushSubscription = null;

/**
 * Service Workerを登録する
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then((registration) => {
        console.log('[App] Service Worker登録成功:', registration.scope);
      })
      .catch((error) => {
        console.error('[App] Service Worker登録失敗:', error);
      });
  }
}

/**
 * プッシュ通知を購読（登録）する
 * サーバーからVAPID公開鍵を取得し、ブラウザのPush APIで購読を作成し、
 * サーバーにサブスクリプションを送信する
 */
async function subscribePush() {
  try {
    // 通知許可を確認
    if (!('Notification' in window)) {
      console.warn('[Push] このブラウザは通知に対応していません');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[Push] 通知が許可されませんでした');
      updatePushUI(false);
      return;
    }

    // Service Workerの準備を待つ
    const registration = await navigator.serviceWorker.ready;

    // 既存のサブスクリプションを確認
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // サーバーからVAPID公開鍵を取得
      const response = await fetch(`${SERVER_URL}/api/vapid-public-key`);
      const { publicKey } = await response.json();

      // Base64をUint8Arrayに変換
      const applicationServerKey = urlBase64ToUint8Array(publicKey);

      // プッシュ通知を購読
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey
      });

      console.log('[Push] 新しいサブスクリプションを作成');
    } else {
      console.log('[Push] 既存のサブスクリプションを使用');
    }

    // サーバーにサブスクリプションを登録
    await fetch(`${SERVER_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });

    pushSubscription = subscription;
    console.log('[Push] プッシュ通知の登録が完了しました');
    updatePushUI(true);

    // Todoデータもサーバーに同期
    syncTodosToServer();

  } catch (error) {
    console.error('[Push] プッシュ通知の登録に失敗:', error);
    updatePushUI(false);
  }
}

/**
 * プッシュ通知の購読を解除する
 */
async function unsubscribePush() {
  try {
    if (pushSubscription) {
      // サーバーから削除
      await fetch(`${SERVER_URL}/api/unsubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: pushSubscription.endpoint })
      });

      // ブラウザの購読を解除
      await pushSubscription.unsubscribe();
      pushSubscription = null;

      console.log('[Push] プッシュ通知を解除しました');
      updatePushUI(false);
    }
  } catch (error) {
    console.error('[Push] 購読解除に失敗:', error);
  }
}

/**
 * テスト通知を送信する
 */
async function sendTestNotification() {
  try {
    const res = await fetch(`${SERVER_URL}/api/test-notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      console.log('[Push] テスト通知を送信しました');
    } else {
      console.warn('[Push] テスト通知の送信に失敗:', data.error);
      alert('テスト通知の送信に失敗しました: ' + (data.error || '不明なエラー'));
    }
  } catch (error) {
    console.error('[Push] テスト通知エラー:', error);
    alert('サーバーに接続できません。サーバーが起動しているか確認してください。');
  }
}

/**
 * プッシュ通知UIの状態を更新する
 * @param {boolean} isSubscribed - 購読中かどうか
 */
function updatePushUI(isSubscribed) {
  const enableBtn = document.getElementById('push-enable-btn');
  const disableBtn = document.getElementById('push-disable-btn');
  const testBtn = document.getElementById('push-test-btn');
  const status = document.getElementById('push-status');

  if (enableBtn) enableBtn.style.display = isSubscribed ? 'none' : 'inline-flex';
  if (disableBtn) disableBtn.style.display = isSubscribed ? 'inline-flex' : 'none';
  if (testBtn) testBtn.style.display = isSubscribed ? 'inline-flex' : 'none';
  if (status) {
    status.textContent = isSubscribed ? '✅ プッシュ通知: ON' : '❌ プッシュ通知: OFF';
    status.className = `push-status ${isSubscribed ? 'active' : 'inactive'}`;
  }
}

/**
 * プッシュ通知の現在の状態を確認
 */
async function checkPushSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] このブラウザはプッシュ通知に対応していません');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      pushSubscription = subscription;
      updatePushUI(true);
    } else {
      updatePushUI(false);
    }
  } catch (error) {
    console.error('[Push] 状態確認エラー:', error);
    updatePushUI(false);
  }
}

/**
 * Base64 URL文字列をUint8Arrayに変換する
 * Web Push APIのapplicationServerKeyに必要
 * @param {string} base64String - Base64 URL形式の文字列
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ==========================================================
// 初期化
// ==========================================================

/**
 * アプリの初期化処理
 */
function initApp() {
  // localStorageからTodoを読み込み
  todos = loadTodos();

  // 通知許可のリクエスト
  requestNotificationPermission();

  // Service Worker登録
  registerServiceWorker();

  // プッシュ通知の状態確認（少し遅延させてSW登録を待つ）
  setTimeout(() => {
    checkPushSubscription();
  }, 1000);

  // ページ固有の初期化
  const page = document.body.dataset.page;
  
  if (page === 'index') {
    // フィルタータブのイベント設定
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => setFilter(tab.dataset.filter));
    });

    // 追加フォームのイベント設定
    const addForm = document.getElementById('add-form');
    if (addForm) addForm.addEventListener('submit', handleAddSubmit);

    // 編集フォームのイベント設定
    const editForm = document.getElementById('edit-form');
    if (editForm) editForm.addEventListener('submit', handleEditSubmit);

    // メイン画面を描画
    renderAll();
  } else if (page === 'calendar') {
    // カレンダーを描画
    renderCalendar();
  }

  // 通知チェック開始
  startNotificationCheck();
}

// DOMが読み込まれたら初期化
document.addEventListener('DOMContentLoaded', initApp);
