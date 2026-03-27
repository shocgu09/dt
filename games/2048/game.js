/* ===== 2048 자동차 버전 - DT Club ===== */

var TILE_MAP = {
  2: '🚲', 4: '🛴', 8: '🚗', 16: '🚙', 32: '🚐',
  64: '🏎️', 128: '🚕', 256: '🚌', 512: '🚂', 1024: '✈️', 2048: '🚀'
};

var SIZE = 4;
var board = [];
var score = 0;
var bestScore = parseInt(localStorage.getItem('dt2048best') || '0');
var gameOver = false;
var won = false;
var db = null;
var currentUser = null;

// Firebase 초기화
try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  firebase.auth().onAuthStateChanged(function(user) {
    currentUser = user;
    loadRanking();
  });
} catch(e) { console.log('Firebase 미연결'); }

// 테마
function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme');
  var next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('dt-theme', next);
  document.getElementById('themeToggle').textContent = next === 'light' ? '☀️' : '🌙';
}
(function() {
  var saved = localStorage.getItem('dt-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  var btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = saved === 'light' ? '☀️' : '🌙';
})();

// 게임 초기화
function init() {
  board = Array.from({ length: SIZE }, function() { return Array(SIZE).fill(0); });
  score = 0;
  gameOver = false;
  won = false;
  document.getElementById('gameOverlay').style.display = 'none';
  addRandomTile();
  addRandomTile();
  render();
  updateScore();
}

function addRandomTile() {
  var empty = [];
  for (var r = 0; r < SIZE; r++)
    for (var c = 0; c < SIZE; c++)
      if (board[r][c] === 0) empty.push({ r: r, c: c });
  if (!empty.length) return;
  var cell = empty[Math.floor(Math.random() * empty.length)];
  board[cell.r][cell.c] = Math.random() < 0.9 ? 2 : 4;
  return cell;
}

function render(newCell) {
  var el = document.getElementById('board');
  var html = '';
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      var val = board[r][c];
      var cls = 'tile';
      if (val) cls += ' tile-' + val;
      if (newCell && newCell.r === r && newCell.c === c) cls += ' new';
      var content = val ? (TILE_MAP[val] || val) : '';
      html += '<div class="' + cls + '">' + content + '</div>';
    }
  }
  el.innerHTML = html;
}

function updateScore() {
  document.getElementById('score').textContent = score;
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('dt2048best', bestScore);
  }
  document.getElementById('bestScore').textContent = bestScore;
}

// 이동 로직
function slide(row) {
  var arr = row.filter(function(v) { return v !== 0; });
  var merged = [];
  for (var i = 0; i < arr.length; i++) {
    if (i + 1 < arr.length && arr[i] === arr[i + 1]) {
      merged.push(arr[i] * 2);
      score += arr[i] * 2;
      if (arr[i] * 2 === 2048 && !won) { won = true; }
      i++;
    } else {
      merged.push(arr[i]);
    }
  }
  while (merged.length < SIZE) merged.push(0);
  return merged;
}

function move(direction) {
  if (gameOver) return;
  var moved = false;
  var oldBoard = JSON.stringify(board);

  if (direction === 'left') {
    for (var r = 0; r < SIZE; r++) board[r] = slide(board[r]);
  } else if (direction === 'right') {
    for (var r = 0; r < SIZE; r++) board[r] = slide(board[r].reverse()).reverse();
  } else if (direction === 'up') {
    for (var c = 0; c < SIZE; c++) {
      var col = [board[0][c], board[1][c], board[2][c], board[3][c]];
      var slid = slide(col);
      for (var r = 0; r < SIZE; r++) board[r][c] = slid[r];
    }
  } else if (direction === 'down') {
    for (var c = 0; c < SIZE; c++) {
      var col = [board[3][c], board[2][c], board[1][c], board[0][c]];
      var slid = slide(col);
      for (var r = 0; r < SIZE; r++) board[SIZE - 1 - r][c] = slid[r];
    }
  }

  if (JSON.stringify(board) !== oldBoard) {
    moved = true;
    var newCell = addRandomTile();
    render(newCell);
    updateScore();

    // 합쳐진 타일 애니메이션
    setTimeout(function() {
      document.querySelectorAll('.tile.new').forEach(function(el) { el.classList.remove('new'); });
    }, 200);

    if (won && !gameOver) {
      showOverlay('🚀 승리!', '점수: ' + score);
      saveScore();
    } else if (isGameOver()) {
      gameOver = true;
      showOverlay('게임 오버', '최종 점수: ' + score);
      saveScore();
    }
  }
}

function isGameOver() {
  for (var r = 0; r < SIZE; r++)
    for (var c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) return false;
      if (c + 1 < SIZE && board[r][c] === board[r][c + 1]) return false;
      if (r + 1 < SIZE && board[r][c] === board[r + 1][c]) return false;
    }
  return true;
}

function showOverlay(title, text) {
  document.getElementById('overlayTitle').textContent = title;
  document.getElementById('overlayScore').textContent = text;
  document.getElementById('gameOverlay').style.display = 'flex';
}

function restartGame() {
  init();
}

// 키보드 입력
document.addEventListener('keydown', function(e) {
  var map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) {
    e.preventDefault();
    move(map[e.key]);
  }
});

// 스와이프 입력
(function() {
  var startX, startY;
  var boardEl = document.getElementById('board');

  boardEl.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  boardEl.addEventListener('touchend', function(e) {
    if (!startX || !startY) return;
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);
    if (Math.max(absDx, absDy) < 30) return; // 최소 이동 거리

    if (absDx > absDy) {
      move(dx > 0 ? 'right' : 'left');
    } else {
      move(dy > 0 ? 'down' : 'up');
    }
    startX = startY = null;
  }, { passive: true });
})();

// Firebase 랭킹
function saveScore() {
  if (!db || !currentUser || score === 0) return;
  var uid = currentUser.uid;
  var docRef = db.collection('game_scores').doc(uid);
  docRef.get().then(function(doc) {
    var name = currentUser.displayName || currentUser.email?.split('@')[0] || '익명';
    if (doc.exists) {
      if (score > (doc.data().score || 0)) {
        docRef.update({ score: score, name: name, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
    } else {
      docRef.set({ uid: uid, score: score, name: name, createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    loadRanking();
  }).catch(function(e) { console.log('점수 저장 실패:', e); });
}

function loadRanking() {
  if (!db) return;
  db.collection('game_scores').orderBy('score', 'desc').limit(10).get().then(function(snap) {
    var listEl = document.getElementById('rankingList');
    if (snap.empty) {
      listEl.innerHTML = '<div class="ranking-loading">아직 기록이 없습니다. 첫 번째 랭커가 되어보세요!</div>';
      return;
    }
    var html = '';
    var rank = 1;
    var medals = ['🥇', '🥈', '🥉'];
    snap.forEach(function(doc) {
      var d = doc.data();
      var isMine = currentUser && d.uid === currentUser.uid;
      var medal = rank <= 3 ? medals[rank - 1] : rank;
      html += '<div class="ranking-row' + (isMine ? ' mine' : '') + '">'
        + '<span class="rank-num">' + medal + '</span>'
        + '<span class="rank-name">' + (d.name || '익명') + (isMine ? ' (나)' : '') + '</span>'
        + '<span class="rank-score">' + (d.score || 0).toLocaleString() + '점</span>'
        + '</div>';
      rank++;
    });
    listEl.innerHTML = html;
  }).catch(function() {
    document.getElementById('rankingList').innerHTML = '<div class="ranking-loading">랭킹을 불러올 수 없습니다</div>';
  });
}

// 게임 시작
init();
document.getElementById('bestScore').textContent = bestScore;
