/* ===== CAR BRANDS ===== */
const W = 'https://upload.wikimedia.org/wikipedia/commons/thumb/';
const WE = 'https://upload.wikimedia.org/wikipedia/en/thumb/';
const CAR_BRANDS = [
  { name: '현대',       logo: W+'4/44/Hyundai_Motor_Company_logo.svg/120px-Hyundai_Motor_Company_logo.svg.png' },
  { name: '기아',       logo: W+'b/b6/KIA_logo3.svg/120px-KIA_logo3.svg.png' },
  { name: '제네시스',   logo: WE+'8/83/Genesis_division_emblem.svg/120px-Genesis_division_emblem.svg.png' },
  { name: 'BMW',        logo: W+'4/44/BMW.svg/120px-BMW.svg.png' },
  { name: '벤츠',       logo: W+'9/90/Mercedes-Logo.svg/120px-Mercedes-Logo.svg.png' },
  { name: '아우디',     logo: W+'9/92/Audi-Logo_2016.svg/120px-Audi-Logo_2016.svg.png' },
  { name: '폭스바겐',   logo: W+'6/6d/Volkswagen_logo_2019.svg/120px-Volkswagen_logo_2019.svg.png' },
  { name: '포르쉐',     logo: WE+'c/c2/Porsche_Logo_2024.png/120px-Porsche_Logo_2024.png' },
  { name: '테슬라',     logo: W+'b/bd/Tesla_Motors.svg/120px-Tesla_Motors.svg.png' },
  { name: '볼보',       logo: W+'5/54/Volvo_logo.svg/120px-Volvo_logo.svg.png' },
  { name: '토요타',     logo: W+'9/9d/Toyota_carlogo.svg/120px-Toyota_carlogo.svg.png' },
  { name: '혼다',       logo: W+'3/38/Honda.svg/120px-Honda.svg.png' },
  { name: '렉서스',     logo: W+'7/75/Lexus.svg/120px-Lexus.svg.png' },
  { name: '닛산',       logo: W+'2/23/Nissan_2020_logo.svg/120px-Nissan_2020_logo.svg.png' },
  { name: '인피니티',   logo: W+'c/c3/Infiniti_logo.svg/120px-Infiniti_logo.svg.png' },
  { name: '마쓰다',     logo: W+'3/3f/Mazda_logo.svg/120px-Mazda_logo.svg.png' },
  { name: '스바루',     logo: W+'c/ca/Subaru_logo_%28transparent%29.svg/120px-Subaru_logo_%28transparent%29.svg.png' },
  { name: '페라리',     logo: W+'9/9b/Ferrari_wordmark.svg/120px-Ferrari_wordmark.svg.png' },
  { name: '람보르기니', logo: W+'3/3a/Lamborghini_-_logo_wordmark%2Bpayoff_%28Italy%2C_1963-%29.svg/120px-Lamborghini_-_logo_wordmark%2Bpayoff_%28Italy%2C_1963-%29.svg.png' },
  { name: '맥라렌',     logo: W+'e/ed/McLaren_Automotive_logo.svg/120px-McLaren_Automotive_logo.svg.png' },
  { name: '마세라티',   logo: W+'7/78/Maserati_logo_2.svg/120px-Maserati_logo_2.svg.png' },
  { name: '알파로메오', logo: WE+'2/2a/Alfa_Romeo_logo.png/120px-Alfa_Romeo_logo.png' },
  { name: '롤스로이스', logo: W+'5/52/Rolls-Royce_Motor_Cars_logo.svg/120px-Rolls-Royce_Motor_Cars_logo.svg.png' },
  { name: '벤틀리',     logo: WE+'e/e4/Bentley_logo_2.svg/120px-Bentley_logo_2.svg.png' },
  { name: '재규어',     logo: W+'5/50/Jaguar_2024.svg/120px-Jaguar_2024.svg.png' },
  { name: '랜드로버',   logo: W+'c/c2/Land_Rover_2023.svg/120px-Land_Rover_2023.svg.png' },
  { name: 'MINI',       logo: W+'e/e9/MINI_logo.svg/120px-MINI_logo.svg.png' },
  { name: '포드',       logo: W+'a/a0/Ford_Motor_Company_Logo.svg/120px-Ford_Motor_Company_Logo.svg.png' },
  { name: '쉐보레',     logo: W+'5/55/Chevrolet_simple_logo.svg/120px-Chevrolet_simple_logo.svg.png' },
  { name: '지프',       logo: W+'9/92/Jeep_wordmark.svg/120px-Jeep_wordmark.svg.png' },
  { name: '캐딜락',     logo: W+'f/fc/Cadillac_Wordmark.svg/120px-Cadillac_Wordmark.svg.png' },
  { name: '기타',       logo: null },
];

function getCarBrandLogo(brandName) {
  const found = CAR_BRANDS.find(b => b.name === brandName);
  return found?.logo || null;
}

function brandLogoHtml(brandName, size = 20) {
  const logo = getCarBrandLogo(brandName);
  if (logo) {
    return `<img src="${logo}" alt="${brandName}" style="width:${size}px;height:${size}px;object-fit:contain;border-radius:3px;flex-shrink:0" onerror="this.outerHTML='<span style=\\'font-size:${Math.round(size*0.8)}px\\'>🚘</span>'">`;
  }
  return `<span style="font-size:${Math.round(size * 0.8)}px">🚘</span>`;
}

function renderBrandSelector(selectedBrand = '') {
  const el = document.getElementById('brandSelector');
  if (!el) return;
  el.innerHTML = CAR_BRANDS.map(b => `
    <button type="button" class="brand-btn ${selectedBrand === b.name ? 'selected' : ''}" onclick="selectBrand('${b.name}')">
      ${b.logo ? `<img src="${b.logo}" alt="${b.name}" onerror="this.style.display='none'">` : '<span class="brand-emoji">🚗</span>'}
      <span>${b.name}</span>
    </button>
  `).join('');
  const customInput = document.getElementById('carBrandCustom');
  if (selectedBrand === '기타') {
    customInput.style.display = 'block';
  } else {
    customInput.style.display = 'none';
  }
}

function selectBrand(name) {
  document.getElementById('carBrand').value = name;
  renderBrandSelector(name);
  if (name === '기타') {
    document.getElementById('carBrandCustom').focus();
  }
}

/* ===== STATE ===== */
const state = {
  members: [],
  events: [],
  gallery: [],
  users: [],           // users 컬렉션 캐시 (투표 칩 표시용)
  db: null,
  auth: null,
  currentPage: 'home',
  currentUser: null,   // Firebase Auth user
  currentUserRole: null, // 'superadmin' | 'admin' | 'member'
  currentUserId: null,   // Firestore users 문서 ID (= auth uid)
  memberFilter: 'all',
  memberSearch: '',
  eventFilter: 'all',
  openEventComments: new Set(),
  eventCommentUnsubs: {},
  eventCommentData: {},
  dms: [],
  _dmUnsub: null,
  _dmMsgUnsub: null,
  _activeDMConvId: null,
  _activeDMOtherUid: null,
  _pushSubscription: null,
  isGuest: false,
};

/* ===== PUSH NOTIFICATION CONFIG ===== */
const VAPID_PUBLIC_KEY = 'BKwd57WtNgaA_SPFMaKdlVMQd_-VMDspL0P8n32PXdaFW2NKDn1MOZi3vCkCAnu2v0yzwurjxoPt3zzmom90FVM';
const PUSH_WORKER_URL = 'https://dt-push.shocguna.workers.dev';

/* ===== FIREBASE INIT ===== */
function initFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    if (e.code !== 'app/duplicate-app') throw e;
  }
  state.db = firebase.firestore();
  state.auth = firebase.auth();
}

/* ===== AUTH ===== */
function initAuth() {
  state.auth.onAuthStateChanged(async (user) => {
    if (user) {
      // ── 게스트(익명) 로그인 ──
      if (user.isAnonymous) {
        state.currentUser = user;
        state.currentUserId = user.uid;
        state.currentUserRole = 'guest';
        state.isGuest = true;
        showApp();
        return;
      }

      // ── 일반 로그인 ──
      state.isGuest = false;

      // 이메일 미인증 계정 차단 (회원가입 진행 중이면 스킵)
      if (!user.emailVerified) {
        if (state.isSigningUp) return;
        await state.auth.signOut();
        var errEl = document.getElementById('authLoginError') || document.getElementById('loginError');
        if (errEl) errEl.textContent = '이메일 인증이 완료되지 않았습니다. 받은 편지함을 확인해 주세요.';
        return;
      }

      state.currentUser = user;
      state.currentUserId = user.uid;

      // signup()이 문서를 쓸 때까지 최대 3초 대기 (race condition 방지)
      let userDoc;
      for (let i = 0; i < 6; i++) {
        userDoc = await state.db.collection('users').doc(user.uid).get();
        if (userDoc.exists) break;
        await new Promise(r => setTimeout(r, 500));
      }

      if (userDoc.exists) {
        const data = userDoc.data();
        state.currentUserRole = data.role;
        // 마지막 접속 시간 갱신
        state.db.collection('users').doc(user.uid).update({ lastSeen: new Date().toISOString() }).catch(() => {});
      } else {
        if (state.isSigningUp) {
          // 회원가입 직후 race condition - 역할만 임시 설정
          state.currentUserRole = 'member';
        } else {
          // 강퇴된 계정 - Auth도 삭제 후 로그아웃
          try { await user.delete(); } catch(e) {}
          await state.auth.signOut();
          alert('삭제된 계정입니다.');
          return;
        }
      }
      showApp();
      // 실시간 강퇴 감지: 관리자가 users 문서 삭제 시 즉시 로그아웃
      if (state._banListener) state._banListener();
      state._banListener = state.db.collection('users').doc(user.uid).onSnapshot(snap => {
        if (!snap.exists) {
          state.auth.signOut();
          alert('계정이 삭제되었습니다.');
        }
      });
    } else {
      if (state._banListener) { state._banListener(); state._banListener = null; }
      state.currentUser = null;
      state.currentUserRole = null;
      state.currentUserId = null;
      state.isGuest = false;
      state.subscribed = false;
      // 자동 게스트 로그인 (로그인 화면 없이 바로 홈)
      state.auth.signInAnonymously().catch(function() {});
    }
  });
}

function updateNavUserName() {
  state.db.collection('users').doc(state.currentUserId).get().then(doc => {
    if (!doc.exists) return;
    const { name, title } = doc.data();
    const el = document.getElementById('navUserName');
    if (!el) return;
    el.innerHTML = escapeHtml(name) + (title ? titleBadge(title) : '');
  });
}

function showApp() {
  var ls = document.getElementById('loginScreen'); if (ls) ls.classList.add('hidden');
  const isGuest = state.isGuest;

  // 게스트/회원 전용 UI 토글
  document.querySelectorAll('.guest-only').forEach(el => el.classList.toggle('hidden', !isGuest));
  document.querySelectorAll('.member-only').forEach(el => el.classList.toggle('hidden', isGuest));

  if (!isGuest) {
    // 네비바 사용자 정보 표시
    updateNavUserName();
  } else {
    const el = document.getElementById('navUserName');
    if (el) el.innerHTML = '게스트';
  }

  // 관리자 전용 UI (superadmin 포함)
  const isAdmin = state.currentUserRole === 'admin' || state.currentUserRole === 'superadmin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !isAdmin);
  });
  document.getElementById('navAdminBadge').classList.toggle('hidden', !isAdmin);
  if (!isGuest) applyRoleUI();

  // 인증 완료 후 Firestore 구독 시작 (최초 1회만)
  if (!state.subscribed) {
    state.subscribed = true;
    subscribeAll();
    if (!isGuest) {
      initDMs();
      initPushNotifications();
      // 공지 팝업 체크
      checkAndShowNotice();
      // 회원 프로필 미등록 시 안내 토스트
      state.db.collection('members').where('createdBy', '==', state.currentUserId).limit(1).get().then(snap => {
        if (snap.empty) showToast('👋 환영합니다! 회원 탭에서 프로필을 등록해주세요.', 6000);
      });
    }
  }
}

function maskName(name) {
  if (!name) return '';
  if (name.length <= 1) return '*';
  return name[0] + '*'.repeat(name.length - 1);
}

function displayName(name) {
  return state.isGuest ? maskName(name) : name;
}

async function guestLogin() {
  try { await state.auth.signInAnonymously(); }
  catch (e) { alert('게스트 로그인 실패: ' + e.message); }
}

function guestToLogin() {
  openModal('authModal');
  switchAuthTab('login');
}

function showToast(msg, duration = 3000) {
  const existing = document.getElementById('appToast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'appToast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 400);
  }, duration);
}

function showLoginScreen() {
  // 구 로그인 페이지 삭제됨 → authModal로 대체
  if (typeof guestToLogin === 'function') guestToLogin();
}

function applyRoleUI() {
  // 관리자만 회원/이벤트 추가·수정·삭제 가능
  // 렌더링 함수에서 isAdmin 체크하여 처리
}

async function login(email, password, keep) {
  var persistence = keep
    ? firebase.auth.Auth.Persistence.LOCAL
    : firebase.auth.Auth.Persistence.SESSION;
  await state.auth.setPersistence(persistence);
  await state.auth.signInWithEmailAndPassword(email, password);
}

async function signup(name, email, password) {
  state.isSigningUp = true;
  try {
    // 블랙리스트 체크
    const blackSnap = await state.db.collection('blacklist').where('email', '==', email.toLowerCase()).limit(1).get();
    if (!blackSnap.empty) throw Object.assign(new Error('가입이 제한된 이메일입니다. 운영진에게 문의하세요.'), { code: 'auth/blacklisted' });
    const cred = await state.auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    // 최초 가입자(admin) 판별: 읽기 실패 시 member로 폴백
    let role = 'member';
    try {
      const usersSnap = await state.db.collection('users').get();
      const others = usersSnap.docs.filter(d => d.id !== cred.user.uid);
      if (others.length === 0) role = 'admin';
    } catch (e) {}
    await state.db.collection('users').doc(cred.user.uid).set({
      name, email, role,
      createdAt: new Date().toISOString().slice(0, 10),
    });
    // 인증 메일 발송 후 로그아웃 (인증 전 앱 진입 차단)
    await cred.user.sendEmailVerification();
    await state.auth.signOut();
  } finally {
    state.isSigningUp = false;
  }
}

async function logout() {
  await unregisterPushSubscription();
  await state.auth.signOut();
}

async function resendVerificationEmail() {
  var emailEl = document.getElementById('authLoginEmail') || document.getElementById('loginEmail');
  var passEl = document.getElementById('authLoginPassword') || document.getElementById('loginPassword');
  var errEl = document.getElementById('authLoginError') || document.getElementById('loginError');
  var email = emailEl ? emailEl.value.trim() : '';
  var password = passEl ? passEl.value : '';
  if (!email || !password) {
    if (errEl) { errEl.style.color = ''; errEl.textContent = '이메일과 비밀번호를 입력 후 재전송 버튼을 눌러주세요.'; }
    return;
  }
  try {
    var cred = await state.auth.signInWithEmailAndPassword(email, password);
    if (cred.user.emailVerified) {
      if (errEl) { errEl.style.color = ''; errEl.textContent = '이미 인증된 계정입니다. 로그인을 진행해 주세요.'; }
      await state.auth.signOut();
      return;
    }
    await cred.user.sendEmailVerification();
    await state.auth.signOut();
    if (errEl) { errEl.style.color = 'var(--driver)'; errEl.textContent = '✅ 인증 메일을 재전송했습니다. 스팸함도 확인해 주세요.'; }
  } catch (e) {
    if (errEl) { errEl.style.color = ''; errEl.textContent = authErrMsg(e.code); }
  }
}

// ===== 인증 모달 =====
function switchAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach(function(b) { b.classList.toggle('active', b.dataset.authTab === tab); });
  document.getElementById('authLoginPane').style.display = tab === 'login' ? '' : 'none';
  document.getElementById('authSignupPane').style.display = tab === 'signup' ? '' : 'none';
  document.getElementById('authLoginError').textContent = '';
  document.getElementById('authSignupError').textContent = '';
}

async function authModalLogin() {
  var email = document.getElementById('authLoginEmail').value.trim();
  var password = document.getElementById('authLoginPassword').value;
  var keep = document.getElementById('authKeepLogin').checked;
  var errEl = document.getElementById('authLoginError');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = '이메일과 비밀번호를 입력하세요.'; return; }
  try {
    await login(email, password, keep);
    closeModal('authModal');
  } catch (e) {
    errEl.textContent = authErrMsg(e.code);
  }
}

async function authModalSignup() {
  var name = document.getElementById('authSignupName').value.trim();
  var email = document.getElementById('authSignupEmail').value.trim();
  var pw = document.getElementById('authSignupPassword').value;
  var pw2 = document.getElementById('authSignupPasswordConfirm').value;
  var errEl = document.getElementById('authSignupError');
  errEl.textContent = '';
  if (!name || !email || !pw) { errEl.textContent = '모든 항목을 입력하세요.'; return; }
  if (pw !== pw2) { errEl.textContent = '비밀번호가 일치하지 않습니다.'; return; }
  if (pw.length < 6) { errEl.textContent = '비밀번호는 6자 이상이어야 합니다.'; return; }
  try {
    await signup(name, email, pw);
    errEl.style.color = 'var(--driver)';
    errEl.textContent = '✅ 인증 메일을 보냈습니다. 이메일을 확인해 주세요!';
    document.getElementById('authSignupName').value = '';
    document.getElementById('authSignupEmail').value = '';
    document.getElementById('authSignupPassword').value = '';
    document.getElementById('authSignupPasswordConfirm').value = '';
  } catch (e) {
    errEl.style.color = '';
    errEl.textContent = authErrMsg(e.code);
  }
}

async function authModalResend() {
  var email = document.getElementById('authLoginEmail').value.trim();
  var password = document.getElementById('authLoginPassword').value;
  var errEl = document.getElementById('authLoginError');
  if (!email || !password) { errEl.textContent = '이메일과 비밀번호를 입력 후 재전송 버튼을 눌러주세요.'; return; }
  try {
    var cred = await state.auth.signInWithEmailAndPassword(email, password);
    if (cred.user.emailVerified) { errEl.textContent = '이미 인증된 계정입니다.'; await state.auth.signOut(); return; }
    await cred.user.sendEmailVerification();
    await state.auth.signOut();
    errEl.style.color = 'var(--driver)';
    errEl.textContent = '✅ 인증 메일을 재전송했습니다.';
  } catch (e) { errEl.textContent = authErrMsg(e.code); }
}

async function withdraw() {
  const uid = state.currentUserId;
  const authUser = state.auth?.currentUser;
  if (!uid || !authUser) {
    alert('로그인 정보를 확인할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요.');
    return;
  }
  const confirmed = confirm('정말 탈퇴하시겠습니까?\n탈퇴 시 계정이 완전히 삭제되며 되돌릴 수 없습니다.');
  if (!confirmed) return;

  try {
    // 1. 내 회원 프로필 삭제 (members 컬렉션)
    const myMembers = await state.db.collection('members').where('createdBy', '==', uid).get();
    for (const doc of myMembers.docs) await doc.ref.delete();
    // 3. 내가 작성한 이벤트 삭제 (events 컬렉션)
    const myEvents = await state.db.collection('events').where('createdBy', '==', uid).get();
    for (const doc of myEvents.docs) await doc.ref.delete();
    // 3-1. 이벤트 투표에서 내 uid 제거
    const allEvents = await state.db.collection('events').get();
    const voteBatch = state.db.batch();
    const FieldValue = firebase.firestore.FieldValue;
    allEvents.docs.forEach(doc => {
      const data = doc.data();
      const votes = data.votes || {};
      const quizAnswers = data.quizAnswers || {};
      const inVotes = [...(votes.attending || []), ...(votes.maybe || []), ...(votes.absent || [])].includes(uid);
      const inQuiz = uid in quizAnswers;
      if (inVotes || inQuiz) {
        const update = {};
        if (inVotes) {
          update['votes.attending'] = FieldValue.arrayRemove(uid);
          update['votes.maybe'] = FieldValue.arrayRemove(uid);
          update['votes.absent'] = FieldValue.arrayRemove(uid);
        }
        if (inQuiz) update[`quizAnswers.${uid}`] = FieldValue.delete();
        voteBatch.update(doc.ref, update);
      }
    });
    await voteBatch.commit();
    // 3-2. 갤러리 댓글에서 내가 쓴 댓글 삭제
    const allGallery = await state.db.collection('gallery').get();
    for (const gDoc of allGallery.docs) {
      const myComments = await gDoc.ref.collection('comments').where('authorUid', '==', uid).get();
      const commentBatch = state.db.batch();
      myComments.docs.forEach(c => commentBatch.delete(c.ref));
      if (!myComments.empty) await commentBatch.commit();
    }
    // 3-3. 내가 올린 갤러리 게시물 삭제
    const myGallery = await state.db.collection('gallery').where('createdBy', '==', uid).get();
    for (const doc of myGallery.docs) await doc.ref.delete();
    // 4. Firestore users 문서 삭제
    await state.db.collection('users').doc(uid).delete();
    // 5. Firebase Auth 계정 삭제
    await authUser.delete();
    alert('탈퇴가 완료되었습니다.');
  } catch (e) {
    if (e.code === 'auth/requires-recent-login') {
      const pw = prompt('보안 확인을 위해 비밀번호를 다시 입력해주세요:');
      if (pw) {
        try {
          const cred = firebase.auth.EmailAuthProvider.credential(authUser.email, pw);
          await authUser.reauthenticateWithCredential(cred);
          // 재인증 후 전체 데이터 정리 재시도
          await withdraw();
        } catch (e2) {
          alert('탈퇴 실패: 비밀번호가 올바르지 않습니다.');
        }
      }
    } else {
      alert('탈퇴 중 오류가 발생했습니다: ' + e.message);
    }
  }
}

/* ===== ADMIN: 계정 생성 (관리자가 직접 생성) ===== */
async function createAccount(name, email, password, role) {
  // Firebase Admin SDK 없이는 다른 계정을 직접 생성 불가
  // 대신: 임시 auth로 계정 생성 후 현재 세션 유지
  const currentUser = state.currentUser;
  const secondaryApp = firebase.initializeApp(firebaseConfig, 'secondary');
  const secondaryAuth = secondaryApp.auth();
  try {
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await state.db.collection('users').doc(cred.user.uid).set({
      name, email, role,
      createdAt: new Date().toISOString().slice(0, 10),
    });
    await secondaryAuth.signOut();
  } finally {
    await secondaryApp.delete();
  }
}

/* ===== ADMIN: 역할 변경 / 계정 삭제 ===== */
async function updateUserRole(uid, role) {
  if (state.currentUserRole !== 'superadmin') {
    alert('역할 변경은 슈퍼관리자만 가능합니다.');
    return;
  }
  try {
    await state.db.collection('users').doc(uid).update({ role });
    renderAdmin();
  } catch (e) {
    alert('역할 변경 실패: ' + e.message);
  }
}

async function updateUserTitle(uid, title) {
  if (state.currentUserRole !== 'superadmin') return;
  try {
    await state.db.collection('users').doc(uid).update({ title: title || '' });
    renderAdmin();
    // 본인 칭호 변경 시 네비바도 갱신
    if (uid === state.currentUserId) updateNavUserName();
  } catch (e) {
    alert('칭호 변경 실패: ' + e.message);
  }
}

// 칭호는 자유 입력 (관리자가 직접 텍스트 입력)
function titleBadge(title) {
  if (!title) return '';
  return `<span style="color:#a78bfa;font-size:.75rem;font-weight:700;background:rgba(167,139,250,.15);border:1px solid rgba(167,139,250,.35);padding:1px 7px;border-radius:0;margin-left:5px">${escapeHtml(title)}</span>`;
}
function userTitle(uid) {
  return state.users.find(u => u.uid === uid)?.title || '';
}

async function deleteUserAccount(uid) {
  if (!confirm('정말 영구 삭제하시겠습니까?\n모든 데이터가 즉시 삭제되며 복구할 수 없습니다.')) return;
  try {
    const FieldValue = firebase.firestore.FieldValue;

    // 1. 회원 프로필 삭제
    const myMembers = await state.db.collection('members').where('createdBy', '==', uid).get();
    for (const doc of myMembers.docs) await doc.ref.delete();

    // 2. 투표 데이터 제거
    const allEvents = await state.db.collection('events').get();
    const voteBatch = state.db.batch();
    allEvents.docs.forEach(doc => {
      const data = doc.data();
      const votes = data.votes || {};
      const quizAnswers = data.quizAnswers || {};
      const inVotes = [...(votes.attending || []), ...(votes.maybe || []), ...(votes.absent || [])].includes(uid);
      const inQuiz = uid in quizAnswers;
      if (inVotes || inQuiz) {
        const update = {};
        if (inVotes) {
          update['votes.attending'] = FieldValue.arrayRemove(uid);
          update['votes.maybe'] = FieldValue.arrayRemove(uid);
          update['votes.absent'] = FieldValue.arrayRemove(uid);
        }
        if (inQuiz) update[`quizAnswers.${uid}`] = FieldValue.delete();
        voteBatch.update(doc.ref, update);
      }
    });
    await voteBatch.commit();

    // 3. 갤러리 댓글 삭제
    const allGallery = await state.db.collection('gallery').get();
    for (const gDoc of allGallery.docs) {
      const myComments = await gDoc.ref.collection('comments').where('authorUid', '==', uid).get();
      if (!myComments.empty) {
        const cb = state.db.batch();
        myComments.docs.forEach(c => cb.delete(c.ref));
        await cb.commit();
      }
    }

    // 4. 갤러리 게시물 삭제
    const myGallery = await state.db.collection('gallery').where('createdBy', '==', uid).get();
    for (const doc of myGallery.docs) await doc.ref.delete();

    // 5. 이벤트 삭제
    const myEvents = await state.db.collection('events').where('createdBy', '==', uid).get();
    for (const doc of myEvents.docs) await doc.ref.delete();

    // 6. 블랙리스트 등록
    const userSnap = await state.db.collection('users').doc(uid).get();
    const email = userSnap.data()?.email;
    if (email) {
      await state.db.collection('blacklist').add({
        email: email.toLowerCase(),
        reason: '관리자 강퇴',
        addedAt: new Date().toISOString(),
        addedBy: state.currentUserId,
      });
    }

    // 7. users 문서 즉시 삭제 (onSnapshot이 감지해서 해당 유저 즉시 로그아웃됨)
    await state.db.collection('users').doc(uid).delete();

    alert('강퇴 처리가 완료됐습니다.');
    renderAdmin();
  } catch (e) {
    alert('오류: ' + e.message);
  }
}

/* ===== REALTIME LISTENERS ===== */
// members 컬렉션의 프로필 이미지를 users 캐시에 동기화
function syncUserImages() {
  if (!state.users?.length || !state.members?.length) return;
  state.users.forEach(u => {
    const member = state.members.find(m => m.createdBy === u.uid);
    u.image = member?.image || null;
    u.gender = member?.gender || u.gender || 'male';
  });
}

function subscribeAll() {
  state.db.collection('members').orderBy('joinDate', 'desc').onSnapshot(snap => {
    state.members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    syncUserImages();
    renderCurrentPage();
  });

  state.db.collection('events').orderBy('date', 'asc').onSnapshot(snap => {
    state.events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentPage();
  });

  state.db.collection('gallery').orderBy('date', 'desc').onSnapshot(snap => {
    state.gallery = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCurrentPage();
  });

  // users 캐시 (투표 칩 표시용)
  state.db.collection('users').onSnapshot(snap => {
    state.users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    syncUserImages();
  });
}

/* ===== SEED DATA (최초 1회) ===== */
async function maybeSeed() {
  const snap = await state.db.collection('members').limit(1).get();
  if (!snap.empty) return; // 이미 데이터 있으면 skip

  const today = new Date().toISOString().slice(0, 10);
  const nextSat = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (6 - d.getDay() + 7) % 7 || 7);
    return d.toISOString().slice(0, 10);
  })();
  const in4 = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);

  const members = [
    { name: '김민준', nickname: '민준', role: 'driver', phone: '010-1234-5678', joinDate: '2026-03-01', bio: 'BMW 3시리즈 오너. 와인딩 코스 전문가입니다. 드라이브 동아리 4기 회장.', image: null, car: { brand: 'BMW', model: '330i', year: 2023, color: '알파인 화이트', desc: 'M스포츠 패키지 장착. 와인딩에서 진가를 발휘하는 차입니다.', image: null } },
    { name: '박서연', nickname: '서연', role: 'driver', phone: '010-2345-6789', joinDate: '2026-03-01', bio: '현대 아이오닉6 타고 조용히 드라이브 즐기는 걸 좋아해요.', image: null, car: { brand: '현대', model: '아이오닉6', year: 2024, color: '세빌 블랙', desc: '전기차로 조용하고 부드러운 주행감이 매력. 1회 충전 600km!', image: null } },
    { name: '이도현', nickname: '도현', role: 'passenger', phone: '010-3456-7890', joinDate: '2026-03-05', bio: '조수석 전문가입니다 ㅋㅋ 음악 선곡은 제가 책임집니다.', image: null, car: null },
    { name: '최지우', nickname: '지우', role: 'driver', phone: '010-4567-8901', joinDate: '2026-03-03', bio: '벤츠 A클래스 오너. 감성 카페 투어 전문.', image: null, car: { brand: 'Mercedes-Benz', model: 'A200', year: 2022, color: '코스모스 블랙', desc: '도심에서도 고속도로에서도 어디서든 빛나는 차입니다.', image: null } },
    { name: '정예린', nickname: '예린', role: 'passenger', phone: '010-5678-9012', joinDate: '2026-03-07', bio: '드라이브하면서 차 덕후 언니오빠들한테 배우는 중입니다!', image: null, car: null },
  ];

  const batch = state.db.batch();
  const idMap = {};
  members.forEach((m, i) => {
    const ref = state.db.collection('members').doc();
    idMap[i] = ref.id;
    batch.set(ref, m);
  });
  await batch.commit();

  const events = [
    {
      title: '3월 개화 드라이브 🌸', type: 'regular', date: nextSat, time: '14:00',
      location: '서울 올림픽공원 주차장',
      desc: '4기 첫 정모! 벚꽃 핀 도로를 따라 드라이브 후 카페 투어 예정입니다. 팀 매칭 후 목적지 이동, 맛집 저녁 식사까지!',
      createdAt: today,
      votes: { attending: [idMap[0], idMap[3]], maybe: [idMap[2]], absent: [idMap[4]] },
    },
    {
      title: '셀프 세차 번개 🚿', type: 'lightning', date: in4, time: '11:00',
      location: '은평구 셀프 세차장',
      desc: '주말에 가볍게 세차하고 카페 한 잔 어떠세요? 운전자 분들 특히 환영!',
      createdAt: today,
      votes: { attending: [idMap[1]], maybe: [idMap[0]], absent: [] },
    },
  ];

  const batch2 = state.db.batch();
  events.forEach(ev => {
    const ref = state.db.collection('events').doc();
    batch2.set(ref, ev);
  });
  await batch2.commit();
}

/* ===== ROUTING ===== */
function goPage(name, pushState = true) {
  if (name === 'anon' && state.isGuest) {
    alert('로그인 후 이용 가능합니다.');
    if (typeof guestToLogin === 'function') guestToLogin();
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .bottom-nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.querySelectorAll(`[data-page="${name}"]`).forEach(b => b.classList.add('active'));
  state.currentPage = name;
  window.scrollTo(0, 0);
  if (pushState) history.pushState({ page: name }, '', '/' + (name === 'home' ? '' : name));
  renderCurrentPage();
}

window.addEventListener('popstate', (e) => {
  const page = e.state?.page || 'home';
  goPage(page, false);
});

function renderCurrentPage() {
  renderPage(state.currentPage);
}

function renderPage(name) {
  if (name === 'home') renderHome();
  else if (name === 'members') renderMembers();
  else if (name === 'cars') renderCars();
  else if (name === 'events') renderEvents();
  else if (name === 'gallery') renderGallery();
  else if (name === 'admin') renderAdmin();
  else if (name === 'anon') renderAnon();
}

/* ===== NOTICE POPUP ===== */
let _noticeQueue = [];
let _noticeQueueIdx = 0;
let _noticeDragSrcId = null;

async function checkAndShowNotice() {
  try {
    const snap = await state.db.collection('notices').get();
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    all.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    const now = new Date();
    _noticeQueue = all.filter(n => {
      if (!n.expiresAt) return false;
      if (new Date(n.expiresAt) <= now) return false;
      const skipKey = 'noticeSkip_' + n.id + '_' + (n.updatedAt || 'v1');
      return localStorage.getItem(skipKey) !== 'true';
    });
    _noticeQueueIdx = 0;
    if (_noticeQueue.length > 0) showNoticePopup(_noticeQueue[0]);
  } catch(e) {}
}

function showNoticePopup(n) {
  document.getElementById('noticePopupTitle').textContent = n.title || '';
  const sub = document.getElementById('noticePopupSubtitle');
  sub.textContent = n.subtitle || '';
  sub.style.display = n.subtitle ? '' : 'none';
  document.getElementById('noticePopupContent').textContent = n.content || '';
  document.getElementById('noticeSkipToday').checked = false;
  const counter = document.getElementById('noticeCounter');
  if (_noticeQueue.length > 1) {
    counter.textContent = `${_noticeQueueIdx + 1} / ${_noticeQueue.length}`;
    counter.style.display = '';
  } else {
    counter.style.display = 'none';
  }
  document.getElementById('noticePopup').style.display = 'flex';
}

function closeNoticePopup() {
  const n = _noticeQueue[_noticeQueueIdx];
  if (n && document.getElementById('noticeSkipToday').checked) {
    localStorage.setItem('noticeSkip_' + n.id + '_' + (n.updatedAt || 'v1'), 'true');
  }
  _noticeQueueIdx++;
  if (_noticeQueueIdx < _noticeQueue.length) {
    showNoticePopup(_noticeQueue[_noticeQueueIdx]);
  } else {
    document.getElementById('noticePopup').style.display = 'none';
  }
}

/* ===== NOTICE ADMIN ===== */
async function renderAdminNotice() {
  const list = document.getElementById('noticeList');
  if (!list) return;
  try {
    const snap = await state.db.collection('notices').get();
    if (snap.empty) {
      list.innerHTML = '<div class="empty-state" style="padding:20px 0;font-size:.88rem">등록된 공지가 없습니다</div>';
      return;
    }
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    list.innerHTML = docs.map(n => `
        <div class="notice-list-item" draggable="true" data-id="${n.id}"
          ondragstart="onNoticeDragStart(event,'${n.id}')"
          ondragend="onNoticeDragEnd(event)"
          ondragover="onNoticeDragOver(event)"
          ondrop="onNoticeDrop(event,'${n.id}')">
          <span class="notice-drag-handle" title="드래그하여 순서 변경">⠿</span>
          <div class="notice-list-info">
            ${(() => {
              if (!n.expiresAt) return '<span class="notice-list-badge off">미설정</span>';
              const exp = new Date(n.expiresAt);
              const isActive = exp > new Date();
              const fmt = exp.toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
              return `<span class="notice-list-badge ${isActive ? 'on' : 'off'}" title="${n.expiresAt}">${isActive ? '~' : '만료 '}${fmt}</span>`;
            })()}
            <span class="notice-list-title">${escapeHtml(n.title)}</span>
          </div>
          <div class="notice-list-actions">
            <button class="btn btn-sm btn-outline" onclick="openNoticeModal('${n.id}')">수정</button>
            <button class="btn btn-sm btn-danger" onclick="deleteNotice('${n.id}')">삭제</button>
          </div>
        </div>`).join('');
    initNoticeTouchDrag();
  } catch(e) {
    list.innerHTML = '<div class="empty-state">불러오기 실패</div>';
  }
}

function onNoticeDragStart(e, id) {
  _noticeDragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.target.classList.add('dragging'), 0);
}

function onNoticeDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('#noticeList .notice-list-item').forEach(el => el.classList.remove('drag-over'));
}

function onNoticeDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (e.currentTarget.dataset.id === _noticeDragSrcId) return;
  document.querySelectorAll('#noticeList .notice-list-item').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
}

async function onNoticeDrop(e, id) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (_noticeDragSrcId === id) return;

  const list = document.getElementById('noticeList');
  const items = [...list.querySelectorAll('.notice-list-item')];
  const srcEl = items.find(el => el.dataset.id === _noticeDragSrcId);
  const tgtEl = e.currentTarget;

  const srcIdx = items.indexOf(srcEl);
  const tgtIdx = items.indexOf(tgtEl);
  if (srcIdx < tgtIdx) tgtEl.after(srcEl);
  else tgtEl.before(srcEl);

  const newOrder = [...list.querySelectorAll('.notice-list-item')].map(el => el.dataset.id);
  await saveNoticeOrder(newOrder);
}

function initNoticeTouchDrag() {
  const list = document.getElementById('noticeList');
  if (!list) return;
  let dragEl = null, clone = null, startY = 0, offsetY = 0;

  list.querySelectorAll('.notice-drag-handle').forEach(handle => {
    handle.addEventListener('touchstart', e => {
      dragEl = handle.closest('.notice-list-item');
      const touch = e.touches[0];
      const rect = dragEl.getBoundingClientRect();
      offsetY = touch.clientY - rect.top;
      startY = touch.clientY;

      clone = dragEl.cloneNode(true);
      clone.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:.85;z-index:9999;pointer-events:none;background:var(--bg3);border:1.5px solid var(--primary);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.4)`;
      document.body.appendChild(clone);
      dragEl.style.opacity = '0.3';
      e.preventDefault();
    }, { passive: false });
  });

  list.addEventListener('touchmove', e => {
    if (!dragEl || !clone) return;
    const touch = e.touches[0];
    clone.style.top = (touch.clientY - offsetY) + 'px';

    // 현재 손가락 아래 아이템 찾기
    clone.style.display = 'none';
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    clone.style.display = '';
    const target = el?.closest('.notice-list-item');
    if (target && target !== dragEl) {
      list.querySelectorAll('.notice-list-item').forEach(i => i.classList.remove('drag-over'));
      target.classList.add('drag-over');
      const items = [...list.querySelectorAll('.notice-list-item')];
      const si = items.indexOf(dragEl), ti = items.indexOf(target);
      if (si < ti) target.after(dragEl);
      else target.before(dragEl);
    }
    e.preventDefault();
  }, { passive: false });

  list.addEventListener('touchend', async () => {
    if (!dragEl) return;
    dragEl.style.opacity = '';
    list.querySelectorAll('.notice-list-item').forEach(i => i.classList.remove('drag-over'));
    clone?.remove();
    clone = null;
    const newOrder = [...list.querySelectorAll('.notice-list-item')].map(el => el.dataset.id);
    await saveNoticeOrder(newOrder);
    dragEl = null;
  });
}

async function saveNoticeOrder(orderedIds) {
  const batch = state.db.batch();
  orderedIds.forEach((id, idx) => {
    batch.update(state.db.collection('notices').doc(id), { order: idx });
  });
  await batch.commit();
}

function openNoticeModal(id) {
  document.getElementById('noticeEditId').value = id || '';
  document.getElementById('noticeEditTitle').value = '';
  document.getElementById('noticeEditSubtitle').value = '';
  document.getElementById('noticeEditContent').value = '';
  document.getElementById('noticeExpiresDate').value = '';
  document.getElementById('noticeEditModalTitle').textContent = id ? '공지 수정' : '공지 추가';
  if (id) {
    state.db.collection('notices').doc(id).get().then(doc => {
      if (!doc.exists) return;
      const n = doc.data();
      document.getElementById('noticeEditTitle').value = n.title || '';
      document.getElementById('noticeEditSubtitle').value = n.subtitle || '';
      document.getElementById('noticeEditContent').value = n.content || '';
      if (n.expiresAt) {
        document.getElementById('noticeExpiresDate').value = n.expiresAt.slice(0, 10);
      }
    });
  }
  openModal('noticeEditModal');
}

async function saveNotice() {
  const title = document.getElementById('noticeEditTitle').value.trim();
  if (!title) { alert('제목을 입력해주세요.'); return; }
  const expDate = document.getElementById('noticeExpiresDate').value;
  if (!expDate) { alert('마감 기한 날짜를 설정해주세요.'); return; }
  const expiresAt = `${expDate}T23:59`;
  const id = document.getElementById('noticeEditId').value;
  const now = new Date().toISOString().slice(0, 16);
  const data = {
    title,
    subtitle: document.getElementById('noticeEditSubtitle').value.trim(),
    content: document.getElementById('noticeEditContent').value.trim(),
    expiresAt,
    updatedAt: now,
  };
  try {
    if (id) {
      await state.db.collection('notices').doc(id).update(data);
    } else {
      data.createdAt = now;
      await state.db.collection('notices').add(data);
    }
    closeModal('noticeEditModal');
    showToast('✅ 공지가 저장되었습니다.');
    renderAdminNotice();
  } catch(e) { alert('저장 실패: ' + e.message); }
}

async function deleteNotice(id) {
  if (!confirm('이 공지를 삭제할까요?')) return;
  try {
    await state.db.collection('notices').doc(id).delete();
    showToast('🗑 공지가 삭제되었습니다.');
    renderAdminNotice();
  } catch(e) { alert('삭제 실패: ' + e.message); }
}

function previewNotice() {
  const title = document.getElementById('noticeEditTitle').value.trim();
  if (!title) { alert('제목을 입력해주세요.'); return; }
  _noticeQueue = [{ id: '__preview__', title, subtitle: document.getElementById('noticeEditSubtitle').value.trim(), content: document.getElementById('noticeEditContent').value.trim(), updatedAt: '__preview__' }];
  _noticeQueueIdx = 0;
  showNoticePopup(_noticeQueue[0]);
}

/* ===== ADMIN PAGE ===== */
function formatLastSeen(iso) {
  if (!iso) return '기록 없음';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

async function renderAdminBlacklist() {
  const list = document.getElementById('blacklistItems');
  if (!list) return;
  try {
    const snap = await state.db.collection('blacklist').orderBy('addedAt', 'desc').get();
    if (snap.empty) {
      list.innerHTML = '<div class="empty-state">블랙리스트가 없습니다</div>';
      return;
    }
    list.innerHTML = snap.docs.map(doc => {
      const b = doc.data();
      const date = b.addedAt ? b.addedAt.slice(0, 10) : '';
      return `
        <div class="user-item">
          <div class="user-item-info">
            <div class="user-item-name">${escapeHtml(b.email)}</div>
            <div class="user-item-email">${escapeHtml(b.reason || '')} · ${date}</div>
          </div>
          <div class="user-item-actions">
            <button class="btn btn-sm btn-outline" onclick="removeFromBlacklist('${doc.id}')">해제</button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-state">불러오기 실패</div>';
  }
}

async function addToBlacklist() {
  const email = document.getElementById('blacklistEmail').value.trim().toLowerCase();
  const reason = document.getElementById('blacklistReason').value.trim();
  if (!email) { alert('이메일을 입력해주세요.'); return; }
  try {
    const existing = await state.db.collection('blacklist').where('email', '==', email).limit(1).get();
    if (!existing.empty) { alert('이미 블랙리스트에 등록된 이메일입니다.'); return; }
    await state.db.collection('blacklist').add({
      email,
      reason: reason || '수동 등록',
      addedAt: new Date().toISOString(),
      addedBy: state.currentUserId,
    });
    document.getElementById('blacklistEmail').value = '';
    document.getElementById('blacklistReason').value = '';
    showToast('✅ 블랙리스트에 추가됐습니다.');
    renderAdminBlacklist();
  } catch (e) {
    alert('오류: ' + e.message);
  }
}

async function removeFromBlacklist(id) {
  if (!confirm('블랙리스트에서 해제할까요?')) return;
  try {
    await state.db.collection('blacklist').doc(id).delete();
    showToast('✅ 블랙리스트에서 해제됐습니다.');
    renderAdminBlacklist();
  } catch (e) {
    alert('오류: ' + e.message);
  }
}

async function renderAdmin() {
  if (state.currentUserRole !== 'admin' && state.currentUserRole !== 'superadmin') return;
  renderAdminNotice();
  renderAdminBlacklist();
  renderAdminYouTube();
  const snap = await state.db.collection('users').orderBy('createdAt', 'asc').get();
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const list = document.getElementById('userList');
  if (!users.length) {
    list.innerHTML = '<div class="empty-state">등록된 계정이 없습니다</div>';
    return;
  }
  const isSuperAdmin = state.currentUserRole === 'superadmin';
  const isAdminRole = r => r === 'admin' || r === 'superadmin';
  list.innerHTML = users.map(u => `
    <div class="user-item">
      <div class="user-item-info">
        <div class="user-item-name">
          ${escapeHtml(u.name)}
          ${u.title ? titleBadge(u.title) : ''}
          ${u.uid === state.currentUserId ? '<span style="color:var(--primary-light);font-size:.76rem;margin-left:4px">(나)</span>' : ''}
          ${u.role === 'superadmin' ? '<span style="color:#f59e0b;font-size:.76rem;font-weight:700;margin-left:4px">슈퍼관리자</span>' : ''}
        </div>
        <div class="user-item-email">${escapeHtml(u.email)}</div>
        ${isSuperAdmin ? `<div class="user-item-lastseen">마지막 접속: ${formatLastSeen(u.lastSeen)}</div>` : ''}
      </div>
      <div class="user-item-actions">
        ${isSuperAdmin ? `<input class="role-select" style="min-width:80px;text-align:center" value="${escapeHtml(u.title || '')}" placeholder="칭호 입력" onchange="updateUserTitle('${u.uid}', this.value.trim())" onkeydown="if(event.key==='Enter'){this.blur()}">` : ''}
        ${u.role === 'superadmin' ? `
          <span style="font-size:.82rem;color:#f59e0b;padding:6px 10px">슈퍼관리자</span>
        ` : isSuperAdmin ? `
          <select class="role-select" onchange="updateUserRole('${u.uid}', this.value)" ${u.uid === state.currentUserId ? 'disabled' : ''}>
            <option value="member" ${u.role === 'member' ? 'selected' : ''}>일반 회원</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자</option>
          </select>
        ` : `
          <span style="font-size:.82rem;color:var(--text2);padding:6px 10px">${u.role === 'admin' ? '관리자' : '일반 회원'}</span>
        `}
        ${u.uid !== state.currentUserId && u.role !== 'superadmin' && (isSuperAdmin || u.role === 'member') ? `
          <button class="btn btn-sm btn-danger" onclick="deleteUserAccount('${u.uid}')">강퇴</button>` : ''}
      </div>
    </div>`).join('');
}

/* ===== BROADCAST DM ===== */
async function broadcastDM() {
  const text = document.getElementById('broadcastDMText').value.trim();
  if (!text) return;
  const uid = state.currentUserId;
  if (!uid) return;

  const status = document.getElementById('broadcastDMStatus');
  const btn = document.querySelector('[onclick="broadcastDM()"]');
  btn.disabled = true;
  status.textContent = '발송 중…';

  const FieldValue = firebase.firestore.FieldValue;
  // 본인 제외 전체 유저 목록
  const targets = state.users.filter(u => u.uid !== uid);
  let sent = 0;
  for (const target of targets) {
    const convId = [uid, target.uid].sort().join('_');
    const convRef = state.db.collection('dms').doc(convId);
    try {
      const convSnap = await convRef.get();
      if (!convSnap.exists) {
        await convRef.set({
          participants: [uid, target.uid],
          lastMessage: text,
          lastAt: FieldValue.serverTimestamp(),
          unread: { [uid]: 0, [target.uid]: 1 }
        });
      } else {
        await convRef.update({
          lastMessage: text,
          lastAt: FieldValue.serverTimestamp(),
          [`unread.${target.uid}`]: FieldValue.increment(1),
          [`unread.${uid}`]: 0
        });
      }
      await convRef.collection('messages').add({
        senderId: uid,
        text,
        createdAt: FieldValue.serverTimestamp()
      });
      sent++;
      status.textContent = `발송 중… (${sent}/${targets.length})`;
    } catch(e) {
      console.error('DM 발송 실패:', target.uid, e);
    }
  }
  document.getElementById('broadcastDMText').value = '';
  btn.disabled = false;
  status.textContent = `✅ ${sent}명에게 발송 완료`;
  setTimeout(() => { status.textContent = ''; }, 4000);
}

/* ===== HOME ===== */
function renderHome() {
  // 홈에서도 익명글 구독 시작 (아직 안 되어 있으면)
  if (!_anonUnsub && state.currentUserId) {
    _anonUnsub = state.db.collection('anon_posts').orderBy('createdAt', 'desc').limit(100)
      .onSnapshot(function(snap) {
        _anonPosts = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
        if (state.currentPage === 'anon') _renderAnonList();
        _updateHomeAnonList();
      }, function(err) { console.error('익명 게시판 구독 오류:', err); });
  }
  const { members, events } = state;
  document.getElementById('stat-total').textContent = members.length;
  document.getElementById('stat-drivers').textContent = members.filter(m => m.role === 'driver').length;
  document.getElementById('stat-passengers').textContent = members.filter(m => m.role === 'passenger').length;
  document.getElementById('stat-events').textContent = events.length;

  const recentEl = document.getElementById('home-recent-events');
  const sorted = [...events].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3);
  recentEl.innerHTML = sorted.length
    ? sorted.map(ev => `
        <div class="home-list-item" onclick="goPage('events')">
          <span class="item-icon">${ev.type === 'lightning' ? '⚡' : ev.type === 'quiz' ? '🧩' : '🗓'}</span>
          <div class="item-info">
            <div class="item-title">${escapeHtml(ev.title)}</div>
            <div class="item-sub">${ev.type === 'quiz' ? (ev.voteDeadline ? `⏰ 마감 ${ev.voteDeadline.replace('T', ' ')}` : '퀴즈') : `${formatDate(ev.date)} ${ev.time || ''} ${ev.location ? '· ' + ev.location : ''}`}</div>
          </div>
        </div>`)
      .join('')
    : '<div class="empty-state">이벤트가 없습니다</div>';

  // 홈 익명글 리스트
  _updateHomeAnonList();

  // 날씨 로드
  loadWeather();

  // YouTube 쇼츠 로드
  loadYouTubeShorts();
}

var _ytLoaded = false;
function loadYouTubeShorts() {
  if (_ytLoaded || !state.db) return;
  _ytLoaded = true;
  // Firestore에서 채널 목록 조회
  state.db.collection('youtube_channels').get().then(function(snap) {
    var channelIds = snap.docs.map(function(d) { return d.id; });
    if (!channelIds.length) return;
    return fetch('https://dt-youtube.shocguna.workers.dev/api/videos?max=6&channels=' + channelIds.join(','));
  }).then(function(r) { return r ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.videos || !data.videos.length) return;
      data.videos = data.videos.slice(0, 12);
      var videos = data.videos.filter(function(v) { return !v.isShort; });
      var shorts = data.videos.filter(function(v) { return v.isShort; });
      var html = '';
      function renderYtSection(title, list, isShort) {
        html += '<div style="font-size:.85rem;font-weight:700;color:var(--text2);margin:' + (html ? '16px' : '0') + ' 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)">' + title + '</div>';
        html += '<div class="youtube-shorts">';
        list.forEach(function(v) {
          var url = isShort ? 'https://www.youtube.com/shorts/' + v.id : 'https://www.youtube.com/watch?v=' + v.id;
          html += '<a href="' + url + '" target="_blank" class="youtube-short-card">'
            + '<img class="youtube-short-thumb" src="' + v.thumbnail + '" alt="" loading="lazy">'
            + '<div class="youtube-short-title">' + escapeHtml(v.channelTitle || '') + '</div>'
            + '<div class="youtube-short-title" style="color:var(--text3)">' + escapeHtml(v.title) + '</div>'
            + '</a>';
        });
        html += '</div>';
      }
      if (videos.length) renderYtSection('▶️ 동영상', videos, false);
      if (shorts.length) renderYtSection('🎬 Shorts', shorts, true);
      document.getElementById('youtubeShorts').innerHTML = html;
      document.getElementById('youtubeSection').style.display = '';
    })
    .catch(function() {});
}

// YouTube 채널 관리 (관리자)
async function renderAdminYouTube() {
  var listEl = document.getElementById('ytChannelList');
  if (!listEl) return;
  try {
    var snap = await state.db.collection('youtube_channels').get();
    if (snap.empty) {
      listEl.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text3);font-size:.82rem">등록된 채널이 없습니다</div>';
      return;
    }
    var html = '';
    snap.forEach(function(doc) {
      var d = doc.data();
      html += '<div class="user-item">'
        + '<img src="' + (d.thumbnail || '') + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'">'
        + '<div class="user-item-info">'
        + '<div class="user-item-name">' + escapeHtml(d.title || doc.id) + '</div>'
        + '<div class="user-item-email">구독자 ' + (d.subscribers || '?') + '명 · @' + escapeHtml(d.handle || '') + '</div>'
        + '</div>'
        + '<button class="btn btn-sm" style="background:var(--accent);color:#fff;border:none;font-size:.75rem" onclick="removeYouTubeChannel(\'' + doc.id + '\')">삭제</button>'
        + '</div>';
    });
    listEl.innerHTML = html;
  } catch(e) { listEl.innerHTML = '<div style="color:var(--accent);font-size:.82rem">로드 실패</div>'; }
}

async function addYouTubeChannel() {
  var input = document.getElementById('ytChannelHandle');
  var handle = input.value.trim().replace('@', '');
  if (!handle) { alert('채널 핸들을 입력하세요.'); return; }
  try {
    var resp = await fetch('https://dt-youtube.shocguna.workers.dev/api/channel?handle=' + encodeURIComponent(handle));
    var data = await resp.json();
    if (data.error) { alert('채널을 찾을 수 없습니다: ' + data.error); return; }
    // Firestore에 저장 (채널 ID를 문서 ID로 사용)
    await state.db.collection('youtube_channels').doc(data.channelId).set({
      title: data.title,
      handle: handle,
      thumbnail: data.thumbnail || '',
      subscribers: data.subscribers || '0',
      addedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    input.value = '';
    alert(data.title + ' 채널이 추가되었습니다!');
    renderAdminYouTube();
    _ytLoaded = false; // 홈 새로고침 시 다시 로드
  } catch(e) { alert('채널 추가 실패: ' + e.message); }
}

async function removeYouTubeChannel(channelId) {
  if (!confirm('이 채널을 삭제하시겠습니까?')) return;
  try {
    await state.db.collection('youtube_channels').doc(channelId).delete();
    renderAdminYouTube();
    _ytLoaded = false;
  } catch(e) { alert('삭제 실패: ' + e.message); }
}

var _weatherLoaded = false;
function loadWeather() {
  if (_weatherLoaded) return;
  var card = document.getElementById('weatherCard');
  if (!card) return;

  if (!navigator.geolocation) return;
  var _renderWeather = function(data, locName) {
    _weatherLoaded = true;
    card.style.display = '';
    document.getElementById('weatherEmoji').textContent = data.skyEmoji || '☀️';
    document.getElementById('weatherTemp').textContent = data.temp + '°C';
    document.getElementById('weatherDesc').textContent = data.sky || '맑음';
    if (locName) document.getElementById('weatherLocation').textContent = '📍 ' + locName;
  };

  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = pos.coords.latitude, lng = pos.coords.longitude;

    // 역지오코딩으로 위치명 가져오기
    var _locName = '';
    var _setLoc = function() {
      if (typeof kakao !== 'undefined' && kakao.maps) {
        var doGeo = function() {
          var geocoder = new kakao.maps.services.Geocoder();
          geocoder.coord2RegionCode(lng, lat, function(result, status) {
            if (status === kakao.maps.services.Status.OK && result[0]) {
              _locName = result[0].region_1depth_name + ' ' + result[0].region_2depth_name;
              var el = document.getElementById('weatherLocation');
              if (el) el.textContent = '📍 ' + _locName;
            }
          });
        };
        if (_gasMapLoaded) doGeo();
        else kakao.maps.load(function() { _gasMapLoaded = true; doGeo(); });
      }
    };
    _setLoc();

    fetch('https://dt-weather.shocguna.workers.dev/api/weather?lat=' + lat + '&lng=' + lng)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) { console.error('날씨 오류:', data.error); return; }
        _renderWeather(data, _locName);
        document.getElementById('weatherPop').textContent = '💧 ' + data.pop + '%';
        document.getElementById('weatherWind').textContent = '💨 ' + data.wind + 'm/s';

        // 드라이브 지수
        var score = data.driveScore || 3;
        var stars = '';
        for (var i = 0; i < 5; i++) stars += i < score ? '★' : '☆';
        document.getElementById('driveStars').textContent = stars;
        document.getElementById('driveLabel').textContent = data.driveLabel || '';

        // 드리프트 예보
        var driftEl = document.getElementById('driftAlert');
        if (data.rainDays && data.rainDays.length > 0) {
          var nextRain = data.rainDays[0];
          var m = nextRain.substring(4, 6), d = nextRain.substring(6, 8);
          driftEl.textContent = '🏎️💨 ' + parseInt(m) + '/' + parseInt(d) + ' 비/눈 예보! 공짜 드리프트 데이!';
          driftEl.style.display = '';
        }
      })
      .catch(function(e) { console.error('날씨 로드 실패:', e); });
  }, function() {
    // 위치 거부 시 서울 기본값
    fetch('https://dt-weather.shocguna.workers.dev/api/weather?lat=37.5665&lng=126.978')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) return;
        _renderWeather(data, '서울');
        document.getElementById('weatherPop').textContent = '💧 ' + data.pop + '%';
        document.getElementById('weatherWind').textContent = '💨 ' + data.wind + 'm/s';
        var score = data.driveScore || 3;
        var stars = '';
        for (var i = 0; i < 5; i++) stars += i < score ? '★' : '☆';
        document.getElementById('driveStars').textContent = stars;
        document.getElementById('driveLabel').textContent = data.driveLabel || '';
        var driftEl = document.getElementById('driftAlert');
        if (data.rainDays && data.rainDays.length > 0) {
          var nextRain = data.rainDays[0];
          var m = nextRain.substring(4, 6), d = nextRain.substring(6, 8);
          driftEl.textContent = '🏎️💨 ' + parseInt(m) + '/' + parseInt(d) + ' 비/눈 예보! 공짜 드리프트 데이!';
          driftEl.style.display = '';
        }
      })
      .catch(function() {});
  });
}

/* ===== MEMBERS ===== */
function updateAddMemberBtn() {
  const btn = document.getElementById('btnAddMember');
  if (!btn) return;
  const alreadyRegistered = state.members.some(m => m.createdBy === state.currentUserId);
  btn.disabled = alreadyRegistered;
  btn.title = alreadyRegistered ? '이미 회원 등록이 완료되었습니다.' : '';
  btn.textContent = alreadyRegistered ? '✅ 등록 완료' : '+ 회원 등록';
}

function renderMembers() {
  updateAddMemberBtn();
  const g = state.isGuest;
  // 게스트: 회원 등록 버튼 숨기기
  const addBtn = document.getElementById('btnAddMember');
  if (addBtn) addBtn.style.display = g ? 'none' : '';

  const { memberFilter, memberSearch } = state;
  const members = state.members.filter(m => {
    const matchRole = memberFilter === 'all' || m.role === memberFilter;
    const q = memberSearch.toLowerCase();
    const matchSearch = !q || m.name.toLowerCase().includes(q) || (m.nickname || '').toLowerCase().includes(q);
    return matchRole && matchSearch;
  });

  const grid = document.getElementById('membersGrid');
  if (!members.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:40px">조건에 맞는 회원이 없습니다</div>';
    return;
  }
  grid.innerHTML = members.map(m => `
    <div class="member-card" onclick="openMemberDetail('${m.id}')">
      <div class="member-card-top">
        <div class="member-avatar">${avatarEl(m)}</div>
        <div class="member-info">
          <div class="member-name">${escapeHtml(displayName(m.name))}${titleBadge(userTitle(m.createdBy))}${!g && m.createdBy === state.currentUserId ? ' <span style="color:var(--primary-light);font-size:.75rem;font-weight:600">나</span>' : ''}</div>
          <div class="member-nick">${escapeHtml(m.nickname || '-')}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
            <span class="role-badge ${m.role}">${m.role === 'driver' ? '🚗 운전자' : '💺 동승자'}</span>
            <span class="gender-badge ${m.gender || 'male'}">${m.gender === 'female' ? '♀ 여' : '♂ 남'}</span>
          </div>
        </div>
      </div>
      <div class="member-card-body">
        <div class="member-bio">${escapeHtml(m.bio || '소개 없음')}</div>
        ${m.car ? `<div class="member-car-tag">${brandLogoHtml(m.car.brand, 18)} ${escapeHtml(m.car.brand)} ${escapeHtml(m.car.model)}</div>` : ''}
      </div>
      <div class="member-card-footer">
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openMemberDetail('${m.id}')">상세보기</button>
        ${g ? '' : (() => {
          const dmUid = m.createdBy || state.users.find(u => u.name === m.name)?.uid;
          return dmUid && dmUid !== state.currentUserId
            ? `<button class="btn btn-sm btn-outline" title="DM 보내기" onclick="event.stopPropagation();openDMChat('${dmUid}')">💬 DM</button>`
            : '';
        })()}
        ${!g && m.createdBy === state.currentUserId ? `<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openEditMember('${m.id}')">수정</button>` : ''}
        ${!g && canEdit(m) ? `<button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="event.stopPropagation();deleteMember('${m.id}')">삭제</button>` : ''}
      </div>
    </div>`).join('');
}

function openMemberDetail(id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  const g = state.isGuest;
  document.getElementById('detailModalTitle').textContent = `${displayName(m.name)} 회원 정보`;
  document.getElementById('memberDetailBody').innerHTML = `
    <div class="detail-hero">
      <div class="detail-avatar">${avatarEl(m)}</div>
      <div class="detail-info-main">
        <h2>${escapeHtml(displayName(m.name))}${titleBadge(userTitle(m.createdBy))}</h2>
        <div class="nick">${m.nickname ? `"${escapeHtml(m.nickname)}"` : ''}</div>
        <div class="detail-meta">
          <span class="role-badge ${m.role}">${m.role === 'driver' ? '🚗 운전자' : '💺 동승자'}</span>
          <span class="gender-badge ${m.gender || 'male'}">${m.gender === 'female' ? '♀ 여' : '♂ 남'}</span>
        </div>
        <div style="font-size:.88rem;color:var(--text2)">${escapeHtml(m.bio || '')}</div>
      </div>
    </div>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">연락처</div><div class="info-value">${g ? '***-****-****' : (m.phone ? m.phone.slice(0, -4) + '****' : '-')}</div></div>
      <div class="info-item"><div class="info-label">가입일</div><div class="info-value">${m.joinDate || '-'}</div></div>
    </div>
    ${m.car ? `
      <div class="detail-section">
        <h4>내 차</h4>
        <div class="detail-car">
          <div class="detail-car-img${m.car.image ? '' : ' no-img'}">${m.car.image ? `<img src="${m.car.image}" alt="차량">` : '🚗'}</div>
          <div class="detail-car-info">
            <div class="detail-car-name">${escapeHtml(m.car.brand)} ${escapeHtml(m.car.model)}</div>
            <div class="detail-car-sub">${escapeHtml(m.car.year || '')} · ${escapeHtml(m.car.color || '')}</div>
            <div class="detail-car-desc">${escapeHtml(m.car.desc || '')}</div>
          </div>
        </div>
      </div>` : ''}
    ${g ? `<div class="guest-cta-box"><p>회원 가입하면 DM, 이벤트 참여 등 모든 기능을 이용할 수 있습니다.</p><button class="btn btn-primary" onclick="guestToLogin();closeModal('memberDetailModal')">회원가입하기</button></div>` : ''}
    ${(!g && (m.createdBy === state.currentUserId || canEdit(m))) ? `
    <div class="detail-actions">
      ${m.createdBy === state.currentUserId ? `<button class="btn btn-outline" onclick="openEditMember('${m.id}');closeModal('memberDetailModal')">수정</button>` : ''}
      ${canEdit(m) ? `<button class="btn btn-danger" onclick="deleteMember('${m.id}');closeModal('memberDetailModal')">삭제</button>` : ''}
    </div>` : ''}
    `;
  openModal('memberDetailModal');
}

async function openMyProfile() {
  // users 컬렉션에서 계정 정보 불러오기
  const doc = await state.db.collection('users').doc(state.currentUserId).get();
  const data = doc.exists ? doc.data() : {};
  document.getElementById('accountName').value = data.name || '';
  document.getElementById('accountEmail').value = state.currentUser?.email || '';
  document.getElementById('accountPassword').value = '';
  openModal('myAccountModal');
}

async function saveMyAccount(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = '저장 중...';
  try {
    const name = document.getElementById('accountName').value.trim();
    const password = document.getElementById('accountPassword').value;
    const passwordConfirm = document.getElementById('accountPasswordConfirm').value;
    if (password && password !== passwordConfirm) {
      alert('비밀번호가 일치하지 않습니다.');
      btn.disabled = false; btn.textContent = '저장';
      return;
    }
    // Firestore 이름 업데이트
    await state.db.collection('users').doc(state.currentUserId).update({ name });
    // Auth displayName 업데이트
    await state.currentUser.updateProfile({ displayName: name });
    // members 프로필 이름도 동기화
    const memberSnap = await state.db.collection('members').where('createdBy', '==', state.currentUserId).get();
    if (!memberSnap.empty) await memberSnap.docs[0].ref.update({ name });
    // 비밀번호 변경 (입력한 경우만)
    if (password) await state.currentUser.updatePassword(password);
    // 네비바 이름 갱신
    document.getElementById('navUserName').textContent = name;
    closeModal('myAccountModal');
    alert('저장되었습니다.');
  } catch (err) {
    if (err.code === 'auth/requires-recent-login') {
      alert('비밀번호 변경은 보안을 위해 재로그인 후 다시 시도해주세요.');
    } else {
      alert('저장 오류: ' + err.message);
    }
  } finally {
    btn.disabled = false; btn.textContent = '저장';
  }
}

function openAddMember() {
  document.getElementById('memberModalTitle').textContent = '회원 등록';
  document.getElementById('memberForm').reset();
  document.getElementById('memberId').value = '';
  document.getElementById('memberImagePreview').innerHTML = '';
  document.getElementById('carImagePreview').innerHTML = '';
  document.getElementById('memberImage')._croppedData = null; document.getElementById('memberImage')._deleted = false;
  document.getElementById('carImage')._croppedData = null; document.getElementById('carImage')._deleted = false;
  document.getElementById('btnWithdrawInModal').style.display = 'none';
  // 회원가입 시 입력한 이름 자동 채우기 (수정 불가)
  const myUser = state.users.find(u => u.uid === state.currentUserId);
  const nameEl = document.getElementById('memberName');
  nameEl.value = myUser?.name || '';
  nameEl.readOnly = true;
  toggleCarSection('driver');
  renderBrandSelector('');
  openModal('memberModal');
}

function openEditMember(id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  document.getElementById('memberModalTitle').textContent = '회원 수정';
  document.getElementById('btnWithdrawInModal').style.display = 'none';
  document.getElementById('memberId').value = m.id;
  const nameEl = document.getElementById('memberName');
  nameEl.value = m.name;
  // 내 프로필은 이름 수정 불가 (내 정보에서만 변경 가능)
  nameEl.readOnly = m.createdBy === state.currentUserId;
  document.getElementById('memberNickname').value = m.nickname || '';
  document.getElementById('memberRole').value = m.role;
  document.getElementById('memberGender').value = m.gender || 'male';
  document.getElementById('memberPhone').value = m.phone || '';
  document.getElementById('memberBio').value = m.bio || '';
  toggleCarSection(m.role);
  if (m.car) {
    const knownBrand = CAR_BRANDS.find(b => b.name === m.car.brand);
    const selectedKey = knownBrand ? m.car.brand : (m.car.brand ? '기타' : '');
    document.getElementById('carBrand').value = selectedKey;
    renderBrandSelector(selectedKey);
    if (!knownBrand && m.car.brand) {
      document.getElementById('carBrandCustom').value = m.car.brand;
    }
    document.getElementById('carModel').value = m.car.model || '';
    document.getElementById('carYear').value = m.car.year || '';
    document.getElementById('carColor').value = m.car.color || '';
    document.getElementById('carDesc').value = m.car.desc || '';
  }
  document.getElementById('memberImagePreview').innerHTML = m.image ? profilePreviewHtml(m.image, false) : '';
  document.getElementById('carImagePreview').innerHTML = m.car?.image ? carPreviewHtml(m.car.image, false) : '';
  // 삭제 플래그 초기화
  document.getElementById('memberImage')._deleted = false;
  document.getElementById('carImage')._deleted = false;
  openModal('memberModal');
}

async function saveMember(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = '저장 중...';

  try {
    const id = document.getElementById('memberId').value;
    const role = document.getElementById('memberRole').value;
    const existing = id ? state.members.find(x => x.id === id) : null;

    const memberEl = document.getElementById('memberImage');
    const carEl = document.getElementById('carImage');

    let memberImg = memberEl._deleted ? null : (memberEl._croppedData || existing?.image || null);
    let carImg = carEl._deleted ? null : (carEl._croppedData || existing?.car?.image || null);

    const data = {
      name: document.getElementById('memberName').value.trim(),
      nickname: document.getElementById('memberNickname').value.trim(),
      role,
      gender: document.getElementById('memberGender').value,
      phone: document.getElementById('memberPhone').value.trim(),
      bio: document.getElementById('memberBio').value.trim(),
      joinDate: existing?.joinDate || new Date().toISOString().slice(0, 10),
      createdBy: existing?.createdBy || state.currentUserId,
      image: memberImg,
      car: role === 'driver' ? {
        brand: (() => { const b = document.getElementById('carBrand').value.trim(); return b === '기타' ? (document.getElementById('carBrandCustom').value.trim() || '기타') : b; })(),
        model: document.getElementById('carModel').value.trim(),
        year: parseInt(document.getElementById('carYear').value) || null,
        color: document.getElementById('carColor').value.trim(),
        desc: document.getElementById('carDesc').value.trim(),
        image: carImg,
      } : null,
    };

    if (id) {
      await state.db.collection('members').doc(id).set(data, { merge: true });
    } else {
      await state.db.collection('members').doc(state.currentUserId).set(data);
    }

    closeModal('memberModal');
  } catch (err) {
    console.error(err);
    alert('저장 중 오류가 발생했습니다: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '저장';
  }
}

async function deleteMember(id) {
  if (!confirm('정말 삭제할까요?')) return;
  try {
    await state.db.collection('members').doc(id).delete();
    // 이벤트 투표에서도 제거
    const snap = await state.db.collection('events').get();
    const batch = state.db.batch();
    const FieldValue = firebase.firestore.FieldValue;
    snap.docs.forEach(doc => {
      const votes = doc.data().votes || {};
      if ([...(votes.attending || []), ...(votes.maybe || []), ...(votes.absent || [])].includes(id)) {
        batch.update(doc.ref, {
          'votes.attending': FieldValue.arrayRemove(id),
          'votes.maybe': FieldValue.arrayRemove(id),
          'votes.absent': FieldValue.arrayRemove(id),
        });
      }
    });
    await batch.commit();
    closeModal('memberDetailModal');
    renderMembers();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

function toggleCarSection(role) {
  document.getElementById('carSection').style.display = role === 'driver' ? 'block' : 'none';
}

/* ===== CARS ===== */
/* ===== GALLERY ===== */
let currentGalleryId = null;
let commentUnsubscribe = null;

function renderGallery() {
  const isAdmin = state.currentUserRole === 'admin' || state.currentUserRole === 'superadmin';
  const btn = document.getElementById('btnAddGallery');
  if (btn) btn.classList.toggle('hidden', !isAdmin);

  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  if (!state.gallery.length) {
    grid.innerHTML = '<div class="empty-state" style="text-align:center;padding:60px;grid-column:1/-1">등록된 활동이 없습니다.</div>';
    return;
  }
  grid.innerHTML = state.gallery.map(g => {
    const author = state.users.find(u => u.uid === g.createdBy);
    const authorName = displayName(author?.name || '');
    return `
    <div class="gallery-card" onclick="openGalleryDetail('${g.id}')">
      <div class="gallery-card-img">
        ${g.photo ? `<img src="${g.photo}" alt="${g.title}">` : '<div class="gallery-no-img">📷</div>'}
      </div>
      <div class="gallery-card-body">
        <div class="gallery-card-title">${escapeHtml(g.title)}</div>
        <div class="gallery-card-date">${formatDate(g.date)}${authorName ? ` · ${escapeHtml(authorName)}${titleBadge(author?.title)}` : ''}</div>
        ${g.desc ? `<div class="gallery-card-desc">${linkify(g.desc)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function openGalleryDetail(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  const isAdmin = state.currentUserRole === 'admin' || state.currentUserRole === 'superadmin';
  currentGalleryId = id;

  document.getElementById('galleryDetailTitle').textContent = g.title;
  document.getElementById('galleryDetailMeta').textContent = `📅 ${formatDate(g.date)}`;
  document.getElementById('galleryDetailDesc').innerHTML = linkify(g.desc || '');
  document.getElementById('galleryDetailPhoto').innerHTML = g.photo
    ? `<img src="${g.photo}" style="width:100%;max-height:340px;object-fit:cover;border-radius:12px;cursor:zoom-in" onclick="openLightbox('${g.photo}')">`
    : '';
  document.getElementById('commentInput').value = '';
  // 게스트: 댓글 입력폼 숨기기
  const commentWrap = document.querySelector('.comment-input-wrap');
  if (commentWrap) commentWrap.style.display = state.isGuest ? 'none' : '';

  document.getElementById('galleryDetailFooter').innerHTML = isAdmin ? `
    <button class="btn btn-sm btn-outline" onclick="openEditGallery('${id}')">수정</button>
    <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="deleteGallery('${id}')">삭제</button>
  ` : '';

  // 댓글 실시간 구독
  if (commentUnsubscribe) commentUnsubscribe();
  commentUnsubscribe = state.db.collection('gallery').doc(id)
    .collection('comments').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      const comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderComments(comments, id);
    });

  openModal('galleryDetailModal');
}

function renderComments(comments, galleryId) {
  const isAdmin = state.currentUserRole === 'admin' || state.currentUserRole === 'superadmin';
  const uid = state.currentUserId;
  const list = document.getElementById('commentList');
  if (!list) return;
  if (!comments.length) {
    list.innerHTML = '<div class="comment-empty">첫 댓글을 남겨보세요 💬</div>';
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(c.authorName)}${titleBadge(userTitle(c.authorUid))}</span>
        <span class="comment-time">${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('ko') : ''}</span>
        ${(c.authorUid === uid || isAdmin) ? `<button class="comment-del" onclick="deleteComment('${galleryId}','${c.id}')">✕</button>` : ''}
      </div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
    </div>`).join('');
}

async function submitComment() {
  const input = document.getElementById('commentInput');
  const text = input.value.trim();
  if (!text || !currentGalleryId) return;
  const user = state.users.find(u => u.uid === state.currentUserId);
  await state.db.collection('gallery').doc(currentGalleryId).collection('comments').add({
    text,
    authorUid: state.currentUserId,
    authorName: user?.name || state.currentUser?.displayName || '익명',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  input.value = '';
}

async function deleteComment(galleryId, commentId) {
  if (!confirm('댓글을 삭제할까요?')) return;
  await state.db.collection('gallery').doc(galleryId).collection('comments').doc(commentId).delete();
}

/* ===== EVENT COMMENTS ===== */
function toggleEventComments(evId) {
  const section = document.getElementById(`ev-comments-${evId}`);
  if (!section) return;
  const isOpen = state.openEventComments.has(evId);
  if (isOpen) {
    state.openEventComments.delete(evId);
    if (state.eventCommentUnsubs[evId]) { state.eventCommentUnsubs[evId](); delete state.eventCommentUnsubs[evId]; }
    section.style.display = 'none';
    const btn = document.getElementById(`ev-comment-btn-${evId}`);
    if (btn) btn.classList.remove('active');
  } else {
    state.openEventComments.add(evId);
    section.style.display = 'block';
    const btn = document.getElementById(`ev-comment-btn-${evId}`);
    if (btn) btn.classList.add('active');
    subscribeEventComments(evId);
  }
}

function subscribeEventComments(evId) {
  if (state.eventCommentUnsubs[evId]) return;
  state.eventCommentUnsubs[evId] = state.db.collection('events').doc(evId)
    .collection('comments').orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      state.eventCommentData[evId] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderEventCommentList(evId);
    });
}

function renderEventCommentList(evId) {
  const list = document.getElementById(`ev-comment-list-${evId}`);
  if (!list) return;
  const comments = state.eventCommentData[evId] || [];
  const isAdminUser = state.currentUserRole === 'admin' || state.currentUserRole === 'superadmin';
  const uid = state.currentUserId;
  if (!comments.length) {
    list.innerHTML = '<div class="comment-empty">첫 댓글을 남겨보세요 💬</div>';
    return;
  }
  list.innerHTML = comments.map(c => `
    <div class="comment-item">
      <div class="comment-meta">
        <span class="comment-author">${escapeHtml(c.authorName)}${titleBadge(userTitle(c.authorUid))}</span>
        <span class="comment-time">${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('ko') : ''}</span>
        ${(c.authorUid === uid || isAdminUser) ? `<button class="comment-del" onclick="deleteEventComment('${evId}','${c.id}')">✕</button>` : ''}
      </div>
      <div class="comment-text">${escapeHtml(c.text)}</div>
    </div>`).join('');
  // update button label with count
  const btn = document.getElementById(`ev-comment-btn-${evId}`);
  if (btn) btn.textContent = `💬 댓글 ${comments.length > 0 ? comments.length : ''}`.trim();
}

function restoreOpenEventComments() {
  state.openEventComments.forEach(evId => {
    const section = document.getElementById(`ev-comments-${evId}`);
    if (section) {
      section.style.display = 'block';
      const btn = document.getElementById(`ev-comment-btn-${evId}`);
      if (btn) btn.classList.add('active');
      if (state.eventCommentData[evId]) renderEventCommentList(evId);
      subscribeEventComments(evId);
    }
  });
}

async function submitEventComment(evId) {
  const input = document.getElementById(`ev-comment-input-${evId}`);
  const text = input?.value.trim();
  if (!text) return;
  const user = state.users.find(u => u.uid === state.currentUserId);
  await state.db.collection('events').doc(evId).collection('comments').add({
    text,
    authorUid: state.currentUserId,
    authorName: user?.name || state.currentUser?.displayName || '익명',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  if (input) input.value = '';
}

async function deleteEventComment(evId, commentId) {
  if (!confirm('댓글을 삭제할까요?')) return;
  await state.db.collection('events').doc(evId).collection('comments').doc(commentId).delete();
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('active');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('active');
}

function openAddGallery() {
  document.getElementById('galleryFormTitle').textContent = '모임 추가';
  document.getElementById('galleryForm').reset();
  document.getElementById('galleryId').value = '';
  document.getElementById('galleryPhotoPreview').innerHTML = '';
  openModal('galleryFormModal');
}

function openEditGallery(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  document.getElementById('galleryFormTitle').textContent = '모임 수정';
  document.getElementById('galleryId').value = g.id;
  document.getElementById('galleryTitle').value = g.title;
  document.getElementById('galleryDate').value = g.date;
  document.getElementById('galleryDesc').value = g.desc || '';
  document.getElementById('galleryPhotoPreview').innerHTML = g.photo
    ? `<div class="preview-photo-wrap"><img src="${g.photo}" class="preview-photo"><button type="button" class="preview-photo-del" onclick="document.getElementById('galleryPhotoPreview').innerHTML='';window._clearPhoto=true">✕</button></div>`
    : '';
  window._clearPhoto = false;
  closeModal('galleryDetailModal');
  openModal('galleryFormModal');
}

async function saveGallery(e) {
  e.preventDefault();
  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true; btn.textContent = '저장 중...';
  try {
    const id = document.getElementById('galleryId').value;
    const existing = id ? state.gallery.find(x => x.id === id) : null;
    // 크롭된 갤러리 사진 (첫 번째)
    const croppedWraps = document.getElementById('galleryPhotoPreview').querySelectorAll('[data-cropped]');
    const firstCropped = croppedWraps[0]?.dataset.cropped || null;
    let photo = firstCropped || existing?.photo || null;
    if (window._clearPhoto) photo = null;
    const data = {
      title: document.getElementById('galleryTitle').value.trim(),
      date: document.getElementById('galleryDate').value,
      desc: document.getElementById('galleryDesc').value.trim(),
      photo,
      createdBy: existing?.createdBy || state.currentUserId,
      createdAt: existing?.createdAt || new Date().toISOString().slice(0, 10),
    };
    if (id) await state.db.collection('gallery').doc(id).update(data);
    else await state.db.collection('gallery').add(data);
    closeModal('galleryFormModal');
  } catch(err) {
    alert('저장 실패: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = '저장';
    window._clearPhoto = false;
  }
}

async function deleteGallery(id) {
  if (!confirm('이 모임을 삭제할까요?')) return;
  try {
    await state.db.collection('gallery').doc(id).delete();
    closeModal('galleryDetailModal');
    renderGallery();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

function renderCars() {
  const drivers = state.members.filter(m => m.role === 'driver' && m.car);
  const grid = document.getElementById('carsGrid');
  if (!drivers.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:40px">등록된 차량이 없습니다.</div>';
    return;
  }
  grid.innerHTML = drivers.map(m => `
    <div class="car-card" onclick="openMemberDetail('${m.id}')">
      <div class="car-card-img">${m.car.image ? `<img src="${m.car.image}" alt="${escapeHtml(m.car.model)}">` : '🚗'}</div>
      <div class="car-card-body">
        <div class="car-name" style="display:flex;align-items:center;gap:6px">${brandLogoHtml(m.car.brand, 20)} ${escapeHtml(m.car.brand)} ${escapeHtml(m.car.model)}</div>
        <div class="car-year-color">${escapeHtml(m.car.year || '')} ${m.car.year && m.car.color ? '·' : ''} ${escapeHtml(m.car.color || '')}</div>
        <div class="car-desc">${escapeHtml(m.car.desc || '설명 없음')}</div>
        <div class="car-owner">
          <div class="car-owner-avatar">${avatarEl(m)}</div>
          <div>
            <div class="car-owner-name">${escapeHtml(displayName(m.name))}${titleBadge(userTitle(m.createdBy))}</div>
            <div style="font-size:.76rem;color:var(--text3)">오너</div>
          </div>
        </div>
      </div>
    </div>`).join('');
}

/* ===== EVENTS ===== */
function renderEvents() {
  // 게스트: 이벤트 만들기 버튼 숨기기
  const addEvBtn = document.getElementById('btnAddEvent');
  if (addEvBtn) addEvBtn.style.display = state.isGuest ? 'none' : '';

  const today = new Date().toISOString().slice(0, 10);
  const { eventFilter } = state;
  const events = state.events.filter(ev => {
    if (eventFilter === 'lightning') return ev.type === 'lightning';
    if (eventFilter === 'regular') return ev.type === 'regular';
    if (eventFilter === 'quiz') return ev.type === 'quiz';
    if (eventFilter === 'upcoming') return ev.date >= today;
    return true;
  });

  const list = document.getElementById('eventsList');
  if (!events.length) {
    list.innerHTML = '<div class="empty-state" style="text-align:center;padding:40px">이벤트가 없습니다.</div>';
    return;
  }

  list.innerHTML = events.map(ev => {
    if (ev.type === 'quiz') return renderQuizCard(ev, today);
    const votes = ev.votes || { attending: [], maybe: [], absent: [] };
    const total = votes.attending.length + votes.maybe.length + votes.absent.length;
    const aW = total ? (votes.attending.length / total * 100).toFixed(1) : 0;
    const mW = total ? (votes.maybe.length / total * 100).toFixed(1) : 0;
    const bW = total ? (votes.absent.length / total * 100).toFixed(1) : 0;
    const isPast = ev.date < today;
    return `
      <div class="event-card">
        <div class="event-card-header">
          <span class="event-type-badge ${ev.type}">${ev.type === 'lightning' ? '⚡ 번개' : '🗓 정모'}</span>
          <div class="event-title">${escapeHtml(ev.title)}</div>
          ${isPast ? '<span style="font-size:.78rem;color:var(--text3);background:var(--bg3);padding:3px 10px;border-radius:10px;white-space:nowrap">종료됨</span>' : ''}
        </div>
        ${(() => {
          const author = state.users.find(u => u.uid === ev.createdBy);
          const isMe = ev.createdBy === state.currentUserId;
          const name = displayName(author?.name || '알 수 없음');
          return `<div style="font-size:.78rem;color:var(--text3);margin-bottom:6px">✍️ ${escapeHtml(name)}${titleBadge(author?.title)}${isMe ? ' <span style="color:var(--primary-light);font-weight:600">(나)</span>' : ''}</div>`;
        })()}
        <div class="event-meta">
          <span class="event-meta-item">📅 ${formatDate(ev.date)}</span>
          ${ev.time ? `<span class="event-meta-item">🕐 ${ev.time}</span>` : ''}
          ${ev.location ? `<span class="event-meta-item">📍 ${escapeHtml(ev.location)}</span>` : ''}
          ${ev.fee ? `<span class="event-meta-item">💰 ${escapeHtml(ev.fee)}</span>` : ''}
          ${ev.voteDeadline ? `<span class="event-meta-item ${new Date(ev.voteDeadline) < new Date() ? 'deadline-over' : 'deadline-active'}">⏰ 투표마감 ${ev.voteDeadline.replace('T', ' ')}</span>` : ''}
        </div>
        ${ev.desc ? `
          <div class="event-desc-wrap">
            <div class="event-desc collapsed" id="desc-${ev.id}">${linkify(ev.desc)}</div>
            <button class="desc-toggle" onclick="toggleDesc('${ev.id}')">더 보기 ▼</button>
          </div>` : ''}
        ${(() => {
          const uid = state.currentUserId;
          const closed = ev.voteDeadline && new Date(ev.voteDeadline) < new Date();
          const myVote = votes.attending.includes(uid) ? 'attending'
            : votes.maybe.includes(uid) ? 'maybe'
            : votes.absent.includes(uid) ? 'absent' : null;
          if (state.isGuest) return `
            <div style="font-size:.85rem;color:var(--text3);margin-bottom:8px;padding:12px;background:var(--bg3);border-radius:8px;text-align:center">🔒 투표 현황은 회원만 볼 수 있습니다</div>`;
          if (closed) return `
            <div class="event-votes">
              <div class="vote-count attending">✅ 참여 <span class="num">${votes.attending.length}</span></div>
              <div class="vote-count maybe">🕐 늦참 <span class="num">${votes.maybe.length}</span></div>
              <div class="vote-count absent">❌ 불참 <span class="num">${votes.absent.length}</span></div>
            </div>
            ${total > 0 ? `<div class="vote-progress"><div class="vote-bar-attend" style="width:${aW}%"></div><div class="vote-bar-maybe" style="width:${mW}%"></div><div class="vote-bar-absent" style="width:${bW}%"></div></div>` : ''}
            <div style="font-size:.8rem;color:var(--text3);margin-bottom:8px">🔒 투표 마감됨</div>`;
          return `
            <div class="event-votes">
              <button class="vote-count attending ${myVote === 'attending' ? 'voted' : ''}" onclick="castVote('${ev.id}','attending')">✅ 참여 <span class="num">${votes.attending.length}</span></button>
              <button class="vote-count maybe ${myVote === 'maybe' ? 'voted' : ''}" onclick="castVote('${ev.id}','maybe')">🕐 늦참 <span class="num">${votes.maybe.length}</span></button>
              <button class="vote-count absent ${myVote === 'absent' ? 'voted' : ''}" onclick="castVote('${ev.id}','absent')">❌ 불참 <span class="num">${votes.absent.length}</span></button>
            </div>
            ${total > 0 ? `<div class="vote-progress"><div class="vote-bar-attend" style="width:${aW}%"></div><div class="vote-bar-maybe" style="width:${mW}%"></div><div class="vote-bar-absent" style="width:${bW}%"></div></div>` : ''}`;
        })()}
        ${state.isGuest ? '' : renderReactions(ev)}
        <div class="event-actions">
          ${state.isGuest ? '' : `<button class="btn btn-sm btn-outline" onclick="openVoteModal('${ev.id}')">📊 투표 현황</button>`}
          ${state.isGuest ? '' : `<button class="btn btn-sm btn-outline" id="ev-comment-btn-${ev.id}" onclick="toggleEventComments('${ev.id}')">💬 댓글</button>`}
          ${!state.isGuest && canEdit(ev) ? `
            <button class="btn btn-sm btn-outline" onclick="openEditEvent('${ev.id}')">수정</button>
            <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="deleteEvent('${ev.id}')">삭제</button>
          ` : ''}
        </div>
        ${state.isGuest ? '' : `<div class="event-comments-section" id="ev-comments-${ev.id}" style="display:none">
          <div class="ev-comment-list" id="ev-comment-list-${ev.id}"></div>
          <div class="ev-comment-form">
            <input class="ev-comment-input" id="ev-comment-input-${ev.id}" placeholder="댓글을 입력하세요..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitEventComment('${ev.id}')}">
            <button class="btn btn-sm btn-primary" onclick="submitEventComment('${ev.id}')">등록</button>
          </div>
        </div>`}
      </div>`;
  }).join('');
  restoreOpenEventComments();
}

function openAddEvent() {
  document.getElementById('eventModalTitle').textContent = '이벤트 만들기';
  document.getElementById('eventForm').reset();
  document.getElementById('eventId').value = '';
  document.getElementById('eventTimeHour').value = '';
  document.getElementById('eventTimeMin').value = '';
  document.getElementById('voteDeadlineDate').value = '';
  document.getElementById('voteDeadlineHour').value = '';
  document.getElementById('voteDeadlineMin').value = '';
  onEventTypeChange('lightning');
  resetQuizFields();
  openModal('eventModal');
}

function openEditEvent(id) {
  const ev = state.events.find(x => x.id === id);
  if (!ev) return;
  document.getElementById('eventModalTitle').textContent = '이벤트 수정';
  document.getElementById('eventId').value = ev.id;
  document.getElementById('eventTitle').value = ev.title;
  document.getElementById('eventType').value = ev.type;
  document.getElementById('eventDate').value = ev.date;
  const timeParts = (ev.time || '').split(':');
  document.getElementById('eventTimeHour').value = timeParts[0] || '';
  document.getElementById('eventTimeMin').value = timeParts[1] || '';
  document.getElementById('eventLocation').value = ev.location || '';
  document.getElementById('eventFee').value = ev.fee || '';
  const dlParts = (ev.voteDeadline || '').split('T');
  document.getElementById('voteDeadlineDate').value = dlParts[0] || '';
  const dlTime = (dlParts[1] || '').split(':');
  document.getElementById('voteDeadlineHour').value = dlTime[0] || '';
  document.getElementById('voteDeadlineMin').value = dlTime[1] || '';
  document.getElementById('eventDesc').value = ev.desc || '';
  onEventTypeChange(ev.type);
  if (ev.type === 'quiz') {
    resetQuizFields();
    const options = ev.quizOptions || ['', ''];
    const list = document.getElementById('quizOptionsList');
    list.innerHTML = '';
    options.forEach((opt, i) => {
      const row = document.createElement('div');
      row.className = 'quiz-option-row';
      row.innerHTML = `<input type="text" class="quiz-option-input" placeholder="보기 ${i+1}" value="${opt.replace(/"/g, '&quot;')}" /><button type="button" class="quiz-option-del" onclick="removeQuizOption(this)" ${options.length <= 2 ? 'style="display:none"' : ''}>✕</button>`;
      list.appendChild(row);
    });
    updateQuizAnswerSelect();
    document.getElementById('quizAnswer').value = ev.quizAnswer ?? 0;
  }
  openModal('eventModal');
}

async function saveEvent(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = '저장 중...';
  try {
    const id = document.getElementById('eventId').value;
    const existing = id ? state.events.find(x => x.id === id) : null;
    const type = document.getElementById('eventType').value;
    const data = {
      title: document.getElementById('eventTitle').value.trim(),
      type,
      date: document.getElementById('eventDate').value,
      time: (() => { const h = document.getElementById('eventTimeHour').value; const m = document.getElementById('eventTimeMin').value; return h && m ? `${h}:${m}` : ''; })(),
      location: document.getElementById('eventLocation').value.trim(),
      fee: document.getElementById('eventFee').value.trim(),
      voteDeadline: (() => {
        const d = document.getElementById('voteDeadlineDate').value;
        const h = document.getElementById('voteDeadlineHour').value;
        const m = document.getElementById('voteDeadlineMin').value;
        return d && h && m ? `${d}T${h}:${m}` : '';
      })(),
      desc: document.getElementById('eventDesc').value.trim(),
      createdAt: existing?.createdAt || new Date().toISOString().slice(0, 10),
      createdBy: existing?.createdBy || state.currentUserId,
      votes: existing?.votes || { attending: [], maybe: [], absent: [] },
    };
    if (type === 'quiz') {
      const options = Array.from(document.querySelectorAll('.quiz-option-input')).map(i => i.value.trim()).filter(v => v);
      if (options.length < 2) { alert('보기를 최소 2개 입력해주세요.'); submitBtn.disabled = false; submitBtn.textContent = '저장'; return; }
      data.quizOptions = options;
      data.quizAnswer = parseInt(document.getElementById('quizAnswer').value, 10);
      data.quizAnswers = existing?.quizAnswers || {};
      data.quizRevealed = existing?.quizRevealed || false;
      data.quizWinner = existing?.quizWinner || null;
    }
    if (id) {
      await state.db.collection('events').doc(id).set(data, { merge: true });
    } else {
      await state.db.collection('events').add(data);
    }
    closeModal('eventModal');
  } catch (err) {
    alert('저장 오류: ' + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '저장';
  }
}

async function deleteEvent(id) {
  if (!confirm('이벤트를 삭제할까요?')) return;
  try {
    await state.db.collection('events').doc(id).delete();
    renderEvents();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

/* ===== VOTE MODAL ===== */
function openVoteModal(evId) {
  const ev = state.events.find(x => x.id === evId);
  if (!ev) return;
  const votes = ev.votes || { attending: [], maybe: [], absent: [] };
  const uid = state.currentUserId;
  document.getElementById('voteModalTitle').textContent = ev.title;

  function chip(id) {
    // Auth UID 기준으로 users에서 먼저 찾고, 없으면 members에서 찾기
    const u = state.users.find(x => x.uid === id);
    const m = state.members.find(x => x.id === id);
    const person = u || m;
    if (!person) return '';
    const name = person.name || '알 수 없음';
    const fakeM = { name, image: person.image || null, gender: person.gender || 'male' };
    return `<div class="vote-person"><div class="mini-avatar">${avatarEl(fakeM)}</div>${name}</div>`;
  }

  const myVote = votes.attending.includes(uid) ? 'attending'
    : votes.maybe.includes(uid) ? 'maybe'
    : votes.absent.includes(uid) ? 'absent' : null;
  const deadlinePassed = ev.voteDeadline && new Date(ev.voteDeadline) < new Date();

  document.getElementById('voteModalBody').innerHTML = `
    ${ev.fee ? `<div style="background:var(--bg3);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:.9rem">💰 참가비: <strong>${ev.fee}</strong></div>` : ''}
    ${ev.voteDeadline ? `<div style="background:var(--bg3);border-radius:10px;padding:10px 14px;margin-bottom:14px;font-size:.9rem">⏰ 투표 마감: <strong>${ev.voteDeadline.replace('T',' ')}</strong>${deadlinePassed ? ' <span style="color:var(--accent);font-size:.82rem">· 마감됨</span>' : ''}</div>` : ''}
    <div class="vote-section">
      <h4>✅ 참여 (${votes.attending.length}명)</h4>
      <div class="vote-people">${votes.attending.map(chip).join('') || '<span style="color:var(--text3);font-size:.84rem">없음</span>'}</div>
    </div>
    <div class="vote-section">
      <h4>🕐 늦참 (${votes.maybe.length}명)</h4>
      <div class="vote-people">${votes.maybe.map(chip).join('') || '<span style="color:var(--text3);font-size:.84rem">없음</span>'}</div>
    </div>
    <div class="vote-section">
      <h4>❌ 불참 (${votes.absent.length}명)</h4>
      <div class="vote-people">${votes.absent.map(chip).join('') || '<span style="color:var(--text3);font-size:.84rem">없음</span>'}</div>
    </div>`;
  openModal('voteModal');
}

/* ===== QUIZ ANSWERS MODAL (작성자 전용) ===== */
function openQuizAnswersModal(evId) {
  const ev = state.events.find(x => x.id === evId);
  if (!ev) return;
  if (ev.createdBy !== state.currentUserId) return;

  const quizAnswers = ev.quizAnswers || {};
  const options = ev.quizOptions || [];
  const labels = ['A', 'B', 'C', 'D'];
  const correctIdx = ev.quizAnswer ?? -1;
  const totalAnswers = Object.keys(quizAnswers).length;

  function chip(uid) {
    const u = state.users.find(x => x.uid === uid);
    if (!u) return '';
    return `<div class="vote-person"><div class="mini-avatar">${avatarEl({ name: u.name, image: u.image || null, gender: u.gender || 'male' })}</div>${escapeHtml(u.name)}${titleBadge(u.title)}</div>`;
  }

  const sectionsHtml = options.map((opt, i) => {
    const voters = Object.entries(quizAnswers).filter(([, v]) => v === i).map(([uid]) => uid);
    const isCorrect = i === correctIdx;
    const pct = totalAnswers > 0 ? Math.round(voters.length / totalAnswers * 100) : 0;
    return `
      <div class="vote-section" style="${isCorrect && ev.quizRevealed ? 'border-left:3px solid #4ade80;padding-left:10px' : ''}">
        <h4>${labels[i]}. ${escapeHtml(opt)} ${isCorrect && ev.quizRevealed ? '<span style="color:#4ade80;font-size:.78rem">✓ 정답</span>' : ''} <span style="color:var(--text3);font-size:.82rem;font-weight:400">${voters.length}명 · ${pct}%</span></h4>
        <div class="vote-people">${voters.map(chip).join('') || '<span style="color:var(--text3);font-size:.84rem">없음</span>'}</div>
      </div>`;
  }).join('');

  document.getElementById('voteModalTitle').textContent = `📊 응답 현황 — ${ev.title}`;
  document.getElementById('voteModalBody').innerHTML = `
    <div style="font-size:.84rem;color:var(--text3);margin-bottom:14px">총 ${totalAnswers}명 응답</div>
    ${sectionsHtml}`;
  openModal('voteModal');
}

const _quizSelection = {};

function selectQuizOption(evId, idx) {
  _quizSelection[evId] = idx;
  const container = document.getElementById('quiz-opts-' + evId);
  if (!container) return;
  container.querySelectorAll('.quiz-opt-btn').forEach(btn => btn.classList.remove('selecting'));
  container.querySelectorAll('.quiz-opt-btn')[idx]?.classList.add('selecting');
  const confirmBtn = document.getElementById('quiz-confirm-' + evId);
  if (confirmBtn) confirmBtn.style.display = '';
}

async function confirmQuizAnswer(evId) {
  const idx = _quizSelection[evId];
  if (idx === undefined) return;
  const confirmBtn = document.getElementById('quiz-confirm-' + evId);
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = '제출 중...'; }
  await castQuizAnswer(evId, idx);
  delete _quizSelection[evId];
}

async function castVote(evId, status) {
  const uid = state.currentUserId;
  if (!uid) { alert('로그인이 필요합니다.'); return; }
  try {
    const FieldValue = firebase.firestore.FieldValue;
    const ref = state.db.collection('events').doc(evId);
    const ev = state.events.find(e => e.id === evId);
    const votes = ev?.votes || { attending: [], maybe: [], absent: [] };
    const alreadyVoted = votes[status]?.includes(uid);
    await ref.update({
      'votes.attending': FieldValue.arrayRemove(uid),
      'votes.maybe': FieldValue.arrayRemove(uid),
      'votes.absent': FieldValue.arrayRemove(uid),
    });
    if (!alreadyVoted) {
      await ref.update({ [`votes.${status}`]: FieldValue.arrayUnion(uid) });
    }
  } catch (e) {
    alert('투표 실패: ' + e.message);
  }
}

const REACTION_EMOJIS = ['👍','❤️','😂','😮','🔥','😢'];

async function reactToEvent(evId, emoji) {
  const uid = state.currentUserId;
  if (!uid) return;
  try {
    const FieldValue = firebase.firestore.FieldValue;
    const ref = state.db.collection('events').doc(evId);
    const ev = state.events.find(e => e.id === evId);
    const current = (ev?.reactions || {})[uid];
    if (current === emoji) {
      // 같은 이모지 → 취소
      await ref.update({ [`reactions.${uid}`]: FieldValue.delete() });
    } else {
      // 다른 이모지 또는 새로 반응 → 변경
      await ref.update({ [`reactions.${uid}`]: emoji });
    }
  } catch (e) {
    alert('반응 실패: ' + e.message);
  }
}

function renderReactions(ev) {
  const reactions = ev.reactions || {};
  const myReaction = reactions[state.currentUserId];
  // 이모지별 카운트 집계
  const counts = {};
  REACTION_EMOJIS.forEach(e => { counts[e] = 0; });
  Object.values(reactions).forEach(e => { if (counts[e] !== undefined) counts[e]++; });
  const buttons = REACTION_EMOJIS.map(e => {
    const cnt = counts[e];
    const active = myReaction === e;
    return `<button class="reaction-btn${active ? ' active' : ''}" onclick="reactToEvent('${ev.id}','${e}')">${e}${cnt > 0 ? ` <span class="reaction-cnt">${cnt}</span>` : ''}</button>`;
  }).join('');
  return `<div class="reaction-bar">${buttons}</div>`;
}

/* ===== QUIZ ===== */
function onEventTypeChange(type) {
  const isQuiz = type === 'quiz';
  document.getElementById('quizFields').style.display = isQuiz ? 'block' : 'none';
  document.getElementById('eventDateTimeRow').style.display = isQuiz ? 'none' : '';
  document.getElementById('eventLocationRow').style.display = isQuiz ? 'none' : '';
  document.getElementById('eventFeeGroup').style.display = isQuiz ? 'none' : '';
  document.getElementById('eventDate').required = !isQuiz;
}

function resetQuizFields() {
  const list = document.getElementById('quizOptionsList');
  list.innerHTML = `
    <div class="quiz-option-row"><input type="text" class="quiz-option-input" placeholder="보기 1" /><button type="button" class="quiz-option-del" onclick="removeQuizOption(this)" style="display:none">✕</button></div>
    <div class="quiz-option-row"><input type="text" class="quiz-option-input" placeholder="보기 2" /><button type="button" class="quiz-option-del" onclick="removeQuizOption(this)" style="display:none">✕</button></div>`;
  updateQuizAnswerSelect();
}

function addQuizOption() {
  const list = document.getElementById('quizOptionsList');
  const rows = list.querySelectorAll('.quiz-option-row');
  if (rows.length >= 4) return;
  const idx = rows.length + 1;
  const row = document.createElement('div');
  row.className = 'quiz-option-row';
  row.innerHTML = `<input type="text" class="quiz-option-input" placeholder="보기 ${idx}" /><button type="button" class="quiz-option-del" onclick="removeQuizOption(this)">✕</button>`;
  list.appendChild(row);
  // show del buttons if > 2
  list.querySelectorAll('.quiz-option-del').forEach(b => b.style.display = list.querySelectorAll('.quiz-option-row').length > 2 ? '' : 'none');
  if (rows.length + 1 >= 4) document.getElementById('btnAddQuizOption').style.display = 'none';
  updateQuizAnswerSelect();
}

function removeQuizOption(btn) {
  const list = document.getElementById('quizOptionsList');
  const rows = list.querySelectorAll('.quiz-option-row');
  if (rows.length <= 2) return;
  btn.closest('.quiz-option-row').remove();
  // re-label placeholders
  list.querySelectorAll('.quiz-option-input').forEach((inp, i) => inp.placeholder = `보기 ${i+1}`);
  list.querySelectorAll('.quiz-option-del').forEach(b => b.style.display = list.querySelectorAll('.quiz-option-row').length > 2 ? '' : 'none');
  document.getElementById('btnAddQuizOption').style.display = '';
  updateQuizAnswerSelect();
}

function updateQuizAnswerSelect() {
  const list = document.getElementById('quizOptionsList');
  const count = list.querySelectorAll('.quiz-option-row').length;
  const sel = document.getElementById('quizAnswer');
  const prev = sel.value;
  sel.innerHTML = Array.from({ length: count }, (_, i) => `<option value="${i}">보기 ${i+1}</option>`).join('');
  if (prev < count) sel.value = prev;
}

function renderQuizCard(ev, today) {
  const uid = state.currentUserId;
  const isAdmin = state.currentUserRole === 'admin' || state.currentUserRole === 'superadmin';
  const deadline = ev.voteDeadline ? new Date(ev.voteDeadline) : null;
  const deadlinePassed = deadline && deadline < new Date();
  const isPast = deadline ? deadlinePassed : ev.date < today;
  const options = ev.quizOptions || [];
  const quizAnswers = ev.quizAnswers || {};
  const myAnswer = quizAnswers[uid] !== undefined ? quizAnswers[uid] : null;
  const totalAnswers = Object.keys(quizAnswers).length;
  const revealed = ev.quizRevealed;
  const correctIdx = ev.quizAnswer ?? -1;
  const labels = ['A', 'B', 'C', 'D'];
  const author = state.users.find(u => u.uid === ev.createdBy);
  const isMe = ev.createdBy === uid;
  const authorName = displayName(author?.name || '알 수 없음');

  let winnerHtml = '';
  if (revealed && ev.quizWinner) {
    const winner = state.users.find(u => u.uid === ev.quizWinner) || state.members.find(m => m.id === ev.quizWinner);
    winnerHtml = `<div class="quiz-winner-banner">🏆 당첨자: <strong>${escapeHtml(winner?.name || '알 수 없음')}</strong></div>`;
  } else if (revealed && !ev.quizWinner) {
    winnerHtml = `<div class="quiz-winner-banner" style="background:rgba(255,107,107,.13);border-color:rgba(255,107,107,.3);color:#ff9898">😢 정답자 없음 — 추첨 불가</div>`;
  }

  const canVote = !state.isGuest && !deadlinePassed && !revealed && myAnswer === null;
  const optionsHtml = options.map((opt, i) => {
    let cls = 'quiz-opt-btn';
    if (revealed) {
      if (i === correctIdx) cls += ' correct';
      else if (myAnswer === i) cls += ' wrong';
    } else {
      if (myAnswer === i) cls += ' selected';
    }
    const disabled = canVote ? '' : 'disabled';
    const countAnswered = Object.values(quizAnswers).filter(v => v === i).length;
    const pct = totalAnswers > 0 ? Math.round(countAnswered / totalAnswers * 100) : 0;
    return `
      <button class="${cls}" onclick="${canVote ? `selectQuizOption('${ev.id}', ${i})` : ''}" ${disabled}>
        <span class="quiz-opt-label">${labels[i]}</span>
        <span class="quiz-opt-text">${escapeHtml(opt)}</span>
        ${revealed ? `<span class="quiz-opt-pct">${pct}%</span>` : (myAnswer !== null ? `<span class="quiz-opt-pct">${pct}%</span>` : '')}
      </button>`;
  }).join('');

  const adminActions = canEdit(ev) ? `
    ${!revealed && deadlinePassed ? `<button class="btn btn-sm btn-primary" onclick="revealQuizAndDraw('${ev.id}')">🎲 정답 공개 및 추첨</button>` : ''}
    <button class="btn btn-sm btn-outline" onclick="openEditEvent('${ev.id}')">수정</button>
    <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="deleteEvent('${ev.id}')">삭제</button>` : '';

  return `
    <div class="event-card quiz-card">
      <div class="event-card-header">
        <span class="event-type-badge quiz">🧩 퀴즈</span>
        <div class="event-title">${escapeHtml(ev.title)}</div>
        ${isPast ? '<span style="font-size:.78rem;color:var(--text3);background:var(--bg3);padding:3px 10px;border-radius:10px;white-space:nowrap">종료됨</span>' : ''}
      </div>
      <div style="font-size:.78rem;color:var(--text3);margin-bottom:6px">✍️ ${escapeHtml(authorName)}${titleBadge(author?.title)}${isMe ? ' <span style="color:var(--primary-light);font-weight:600">(나)</span>' : ''}</div>
      <div class="event-meta">
        <span class="event-meta-item">📅 ${formatDate(ev.date)}</span>
        ${deadline ? `<span class="event-meta-item ${deadlinePassed ? 'deadline-over' : 'deadline-active'}">⏰ 마감 ${ev.voteDeadline.replace('T', ' ')}</span>` : ''}
      </div>
      ${ev.desc ? `<div style="font-size:.88rem;color:var(--text2);margin-bottom:10px">${linkify(ev.desc)}</div>` : ''}
      <div class="quiz-options" id="quiz-opts-${ev.id}">${optionsHtml}</div>
      ${canVote ? `<button class="btn btn-sm btn-primary vote-confirm-btn" id="quiz-confirm-${ev.id}" style="display:none;margin-bottom:8px" onclick="confirmQuizAnswer('${ev.id}')">답변 제출</button>` : ''}
      <div style="font-size:.78rem;color:var(--text3);margin:6px 0 8px">${myAnswer !== null ? `✅ 답변 완료 (${labels[myAnswer]})` : deadlinePassed ? '⏰ 마감됨' : '👆 정답을 고르고 제출하세요'} · 참여 ${totalAnswers}명</div>
      ${winnerHtml}
      ${state.isGuest ? '' : renderReactions(ev)}
      <div class="event-actions">
        ${!state.isGuest && isMe ? `<button class="btn btn-sm btn-outline" onclick="openQuizAnswersModal('${ev.id}')">📊 응답 현황</button>` : ''}
        ${state.isGuest ? '' : `<button class="btn btn-sm btn-outline" id="ev-comment-btn-${ev.id}" onclick="toggleEventComments('${ev.id}')">💬 댓글</button>`}
        ${state.isGuest ? '' : adminActions}
      </div>
      ${state.isGuest ? '' : `<div class="event-comments-section" id="ev-comments-${ev.id}" style="display:none">
        <div class="ev-comment-list" id="ev-comment-list-${ev.id}"></div>
        <div class="ev-comment-form">
          <input class="ev-comment-input" id="ev-comment-input-${ev.id}" placeholder="댓글을 입력하세요..." onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submitEventComment('${ev.id}')}">
          <button class="btn btn-sm btn-primary" onclick="submitEventComment('${ev.id}')">등록</button>
        </div>
      </div>`}
    </div>`;
}

async function castQuizAnswer(evId, optionIdx) {
  const uid = state.currentUserId;
  if (!uid) { alert('로그인이 필요합니다.'); return; }
  const ev = state.events.find(e => e.id === evId);
  if (!ev) return;
  const quizAnswers = ev.quizAnswers || {};
  if (quizAnswers[uid] !== undefined) return; // already answered
  if (ev.voteDeadline && new Date(ev.voteDeadline) < new Date()) return;
  try {
    await state.db.collection('events').doc(evId).update({
      [`quizAnswers.${uid}`]: optionIdx,
    });
  } catch (err) {
    alert('오류: ' + err.message);
  }
}

async function revealQuizAndDraw(evId) {
  if (!confirm('정답을 공개하고 정답자 중 무작위로 당첨자를 추첨할까요?')) return;
  const ev = state.events.find(e => e.id === evId);
  if (!ev) return;
  const correctIdx = ev.quizAnswer ?? -1;
  const quizAnswers = ev.quizAnswers || {};
  const correct = Object.entries(quizAnswers).filter(([, v]) => v === correctIdx).map(([k]) => k);
  const winner = correct.length > 0 ? correct[Math.floor(Math.random() * correct.length)] : null;
  try {
    await state.db.collection('events').doc(evId).update({
      quizRevealed: true,
      quizWinner: winner,
    });
  } catch (err) {
    alert('오류: ' + err.message);
  }
}

/* ===== DM (Direct Messages) ===== */
function initDMs() {
  const uid = state.currentUserId;
  if (!uid) return;
  if (state._dmUnsub) state._dmUnsub();
  state._dmUnsub = state.db.collection('dms')
    .where('participants', 'array-contains', uid)
    .onSnapshot(snap => {
      state.dms = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const at = a.lastAt?.toDate?.() || new Date(a.lastAt || 0);
          const bt = b.lastAt?.toDate?.() || new Date(b.lastAt || 0);
          return bt - at;
        });
      updateDMBadge();
      if (document.getElementById('dmPanel').classList.contains('open')) renderDMList();
    }, err => console.error('DM 구독 오류:', err));
}

function updateDMBadge() {
  const uid = state.currentUserId;
  const total = state.dms.reduce((sum, c) => sum + ((c.unread || {})[uid] || 0), 0);
  const label = total > 99 ? '99+' : total;
  ['dmUnreadBadge', 'dmUnreadBadgeMobile', 'dmUnreadBadgeHam'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = label;
    badge.style.display = total > 0 ? '' : 'none';
  });
  // 앱 아이콘 뱃지를 Firestore unread 수 기준으로 직접 설정
  try {
    if (total > 0) {
      if (navigator.setAppBadge) navigator.setAppBadge(total);
    } else {
      if (navigator.clearAppBadge) navigator.clearAppBadge();
      // 알림센터의 모든 알림도 제거 시도
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.getNotifications().then(notifications => notifications.forEach(n => n.close()));
        }).catch(() => {});
      }
    }
  } catch(e) {}
}

function openDMPanel() {
  document.getElementById('dmPanel').classList.add('open');
  document.getElementById('dmPanelOverlay').classList.add('open');
  renderDMList();
  // 알림 배너 표시
  if (state._showNotiBanner) showNotificationBanner();
  if (state._showIOSInstallBanner) showIOSInstallBanner();
}

function closeDMPanel() {
  document.getElementById('dmPanel').classList.remove('open');
  document.getElementById('dmPanelOverlay').classList.remove('open');
}

function renderDMList() {
  const uid = state.currentUserId;
  const list = document.getElementById('dmPanelList');
  if (!state.dms.length) {
    list.innerHTML = '<div style="padding:32px 20px;text-align:center;color:var(--text3);font-size:.88rem">대화 내역이 없습니다<br><span style="font-size:.8rem">회원 카드에서 DM을 시작하세요</span></div>';
    return;
  }
  list.innerHTML = state.dms.map(conv => {
    const otherUid = conv.participants.find(p => p !== uid);
    const other = state.users.find(u => u.uid === otherUid);
    const name = other?.name || '알 수 없음';
    const unread = (conv.unread || {})[uid] || 0;
    const lastMsg = conv.lastMessage || '';
    const lastAt = conv.lastAt ? (() => {
      const d = conv.lastAt.toDate ? conv.lastAt.toDate() : new Date(conv.lastAt);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      return isToday ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    })() : '';
    return `
      <div class="dm-conv-item" onclick="openDMChat('${otherUid}')">
        <div class="mini-avatar dm-conv-avatar">${avatarEl({ name, image: other?.image || null, gender: other?.gender || 'male' })}</div>
        <div class="dm-conv-info">
          <div class="dm-conv-name">${escapeHtml(name)}${titleBadge(other?.title)}</div>
          <div class="dm-conv-last">${escapeHtml(lastMsg.length > 28 ? lastMsg.slice(0, 28) + '…' : lastMsg)}</div>
        </div>
        <div class="dm-conv-meta">
          <div class="dm-conv-time">${lastAt}</div>
          ${unread > 0 ? `<div class="dm-unread-dot">${unread}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

async function openDMChat(otherUid) {
  const uid = state.currentUserId;
  if (!uid || otherUid === uid) return;

  const convId = [uid, otherUid].sort().join('_');
  state._activeDMConvId = convId;
  state._activeDMOtherUid = otherUid;

  // SW에 현재 보고 있는 대화방 알림 → 푸시 알림 억제
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'DM_VIEWING', convId }); } catch(e) {}

  const other = state.users.find(u => u.uid === otherUid);
  const name = other?.name || '알 수 없음';
  document.getElementById('dmChatTitle').innerHTML = `💬 ${escapeHtml(name)}${titleBadge(other?.title)}`;
  document.getElementById('dmMessages').innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:.84rem">로딩 중…</div>';

  openModal('dmChatModal');
  closeDMPanel();

  // 해당 대화의 알림센터 알림 제거
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.getNotifications({ tag: `dm-${convId}` }).then(notifications => notifications.forEach(n => n.close()));
      });
    }
  } catch(e) {}

  // 기존 대화방이면 읽음 처리 + 즉시 UI 반영
  const convRef = state.db.collection('dms').doc(convId);
  try {
    const convSnap = await convRef.get();
    if (convSnap.exists) {
      await convRef.update({ [`unread.${uid}`]: 0 });
      const localConv = state.dms.find(c => c.id === convId);
      if (localConv && localConv.unread) localConv.unread[uid] = 0;
      updateDMBadge();
    } else {
      // 대화방이 아직 없으면 빈 상태 표시
      document.getElementById('dmMessages').innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:.84rem">아직 메시지가 없습니다.<br>첫 메시지를 보내보세요!</div>';
    }
  } catch(e) {}

  // 메시지 실시간 구독 + 새 메시지 수신 시 자동 읽음 처리
  if (state._dmMsgUnsub) state._dmMsgUnsub();
  state._dmMsgUnsub = state.db.collection('dms').doc(convId).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      renderDMMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })), uid);
      // 채팅 모달이 열려있는 동안 새 메시지가 오면 즉시 읽음 처리 + UI 반영
      const modal = document.getElementById('dmChatModal');
      if (modal && modal.classList.contains('open')) {
        state.db.collection('dms').doc(convId).update({ [`unread.${uid}`]: 0 }).catch(() => {});
        const localConv = state.dms.find(c => c.id === convId);
        if (localConv && localConv.unread) localConv.unread[uid] = 0;
        updateDMBadge();
        try {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
              reg.getNotifications({ tag: `dm-${convId}` }).then(notifications => notifications.forEach(n => n.close()));
            });
          }
        } catch(e) {}
      }
    }, err => console.error('DM 메시지 구독 오류:', err));
}

function closeDMChat() {
  // SW에 대화방 닫힘 알림
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'DM_VIEWING', convId: null }); } catch(e) {}
  // 닫을 때 읽음 처리 + 즉시 UI 반영
  if (state._activeDMConvId) {
    const uid = state.currentUserId;
    const convId = state._activeDMConvId;
    state.db.collection('dms').doc(convId).update({ [`unread.${uid}`]: 0 }).catch(() => {});
    const localConv = state.dms.find(c => c.id === convId);
    if (localConv && localConv.unread) localConv.unread[uid] = 0;
    updateDMBadge();
    // 알림센터도 클리어
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(reg => {
          reg.getNotifications({ tag: `dm-${convId}` }).then(notifications => notifications.forEach(n => n.close()));
        });
      }
    } catch(e) {}
  }
  if (state._dmMsgUnsub) { state._dmMsgUnsub(); state._dmMsgUnsub = null; }
  state._activeDMConvId = null;
  state._activeDMOtherUid = null;
  closeModal('dmChatModal');
}

function isSingleEmoji(str) {
  const emojiRegex = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(\u200D(\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
  return emojiRegex.test(str) && [...str].length <= 7;
}

function renderDMMessages(msgs, myUid) {
  const container = document.getElementById('dmMessages');
  if (!msgs.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:.84rem">아직 메시지가 없습니다.<br>첫 메시지를 보내보세요!</div>';
    return;
  }
  let html = '';
  let lastDate = '';
  msgs.forEach(msg => {
    const isMe = msg.senderId === myUid;
    const d = msg.createdAt ? (msg.createdAt.toDate ? msg.createdAt.toDate() : new Date(msg.createdAt)) : new Date();
    const dateStr = d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    if (dateStr !== lastDate) {
      html += `<div class="dm-date-sep">${dateStr}</div>`;
      lastDate = dateStr;
    }
    const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    let content = '';
    if (msg.image) {
      content = `<div class="dm-bubble dm-bubble-img"><img src="${msg.image}" alt="사진" onclick="openLightbox('${msg.image}')" onerror="this.outerHTML='<div style=\\'padding:12px;color:var(--text3);font-size:.82rem\\'>⚠️ 이미지를 불러올 수 없습니다</div>'"></div>`;
      if (msg.text) content += `<div class="dm-bubble">${escapeHtml(msg.text)}</div>`;
    } else if (isSingleEmoji(msg.text)) {
      content = `<div class="dm-emoji-big">${msg.text}</div>`;
    } else {
      content = `<div class="dm-bubble">${escapeHtml(msg.text)}</div>`;
    }

    if (isMe) {
      html += `<div class="dm-msg dm-msg-me">
        ${content}
        <div class="dm-time">${time}</div>
      </div>`;
    } else {
      const sender = state.users.find(u => u.uid === msg.senderId);
      const member = state.members.find(m => m.createdBy === msg.senderId);
      const senderName = sender?.name || member?.name || '알 수 없음';
      const senderImage = member?.image || sender?.image || null;
      const avatar = avatarSmall({ name: senderName, image: senderImage, gender: member?.gender || 'male' });
      html += `<div class="dm-msg dm-msg-other dm-msg-with-avatar">
        <div class="dm-avatar-wrap">${avatar}</div>
        <div class="dm-msg-content">
          ${content}
          <div class="dm-time">${time}</div>
        </div>
      </div>`;
    }
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
  // 이미지 로드 완료 후 다시 최하단 스크롤
  container.querySelectorAll('img').forEach(function(img) {
    if (!img.complete) {
      img.onload = function() { container.scrollTop = container.scrollHeight; };
    }
  });
}

function handleDMImage(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = '';
  // 파일 크기 제한 (10MB)
  if (file.size > 10 * 1024 * 1024) { alert('10MB 이하의 이미지만 전송할 수 있습니다.'); return; }
  // 로딩 표시
  const sendBtn = document.querySelector('.dm-input-area button[onclick]');
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '전송 중…'; }
  // EXIF 보정 + 압축 사용
  compressImage(file, 600, 0.7).then(function(dataUrl) {
    sendDMMessage(dataUrl);
  }).catch(function(err) {
    alert('이미지 처리 실패: ' + (err.message || err));
  }).finally(function() {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '전송'; }
  });
}

async function sendDMMessage(imageDataUrl) {
  const input = document.getElementById('dmInput');
  const text = input.value.trim();
  if (!text && !imageDataUrl) return;
  const convId = state._activeDMConvId;
  const uid = state.currentUserId;
  const otherUid = state._activeDMOtherUid;
  if (!convId || !uid || !otherUid) return;

  input.value = '';
  const FieldValue = firebase.firestore.FieldValue;
  const convRef = state.db.collection('dms').doc(convId);
  const lastMsg = imageDataUrl ? '📷 사진' : text;

  try {
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      await convRef.set({
        participants: [uid, otherUid],
        lastMessage: lastMsg,
        lastAt: FieldValue.serverTimestamp(),
        unread: { [uid]: 0, [otherUid]: 1 }
      });
      // 새 대화방 생성 후 메시지 리스너 재설정
      if (state._dmMsgUnsub) state._dmMsgUnsub();
      state._dmMsgUnsub = convRef.collection('messages')
        .orderBy('createdAt', 'asc')
        .onSnapshot(function(snap) {
          renderDMMessages(snap.docs.map(function(d) { return { id: d.id, ...d.data() }; }), uid);
        }, function(err) { console.error('DM 메시지 구독 오류:', err); });
    } else {
      await convRef.update({
        lastMessage: lastMsg,
        lastAt: FieldValue.serverTimestamp(),
        [`unread.${otherUid}`]: FieldValue.increment(1),
        [`unread.${uid}`]: 0
      });
    }
    const msgData = {
      senderId: uid,
      text: text || '',
      createdAt: FieldValue.serverTimestamp()
    };
    if (imageDataUrl) msgData.image = imageDataUrl;
    await convRef.collection('messages').add(msgData);
    triggerPushNotification(otherUid, lastMsg, convId).catch(() => {});
  } catch (err) {
    input.value = text;
    alert('전송 실패: ' + err.message);
  }
}

/* ===== PUSH NOTIFICATIONS ===== */

function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent); }
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

async function initPushNotifications() {
  // iOS인데 PWA로 설치 안 된 경우 → 설치 안내만 (PushManager 체크보다 먼저!)
  if (isIOS() && !isStandalone()) {
    state._showIOSInstallBanner = true;
    return;
  }

  // Push API 미지원 브라우저
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return;

  if (Notification.permission === 'granted') {
    await registerPushSubscription();
  } else if (Notification.permission === 'default') {
    state._showNotiBanner = true;
    // PWA(홈 화면 설치) 실행 시 → 2초 후 자동으로 알림 허용 팝업
    if (isStandalone()) {
      setTimeout(() => requestNotificationPermission(), 2000);
    }
  }

  // SW로부터 OPEN_DM 메시지 수신 → 해당 대화 열기
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'OPEN_DM' && event.data.convId) {
      const otherUid = event.data.convId.split('_').find(id => id !== state.currentUserId);
      if (otherUid) openDMChat(otherUid);
    }
  });

  // URL 파라미터로 딥링크 처리 (?dm=convId)
  const params = new URLSearchParams(location.search);
  const dmConv = params.get('dm');
  if (dmConv) {
    const otherUid = dmConv.split('_').find(id => id !== state.currentUserId);
    if (otherUid) setTimeout(() => openDMChat(otherUid), 1000);
    history.replaceState(null, '', '/');
  }
}

async function requestNotificationPermission() {
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await registerPushSubscription();
      hideNotificationBanner();
      showToast('🔔 알림이 활성화되었습니다!');
    } else {
      showToast('알림이 차단되었습니다. 브라우저 설정에서 변경할 수 있습니다.');
    }
  } catch (err) {
    console.error('Notification permission error:', err);
  }
}

async function registerPushSubscription() {
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();

    // 기존 구독이 있으면 재사용, 없을 때만 새로 생성
    if (!sub) {
      const keyBytes = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes
      });
    }
    state._pushSubscription = sub;

    // Worker에 구독 등록 (기존 구독이어도 서버에 다시 등록 → 유저 매핑 갱신)
    const token = await state.currentUser.getIdToken();
    const resp = await fetch(PUSH_WORKER_URL + '/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        uid: state.currentUserId,
        subscription: sub.toJSON()
      })
    });
    const result = await resp.json();
    if (!resp.ok) {
      console.error('Push subscribe failed:', result);
    } else {
      console.log('Push subscription registered:', result);
    }
  } catch (err) {
    console.error('Push subscription error:', err);
  }
}

async function unregisterPushSubscription() {
  try {
    if (!state._pushSubscription || !state.currentUser) return;
    const token = await state.currentUser.getIdToken();
    await fetch(PUSH_WORKER_URL + '/api/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        uid: state.currentUserId,
        endpoint: state._pushSubscription.endpoint
      })
    });
    await state._pushSubscription.unsubscribe();
    state._pushSubscription = null;
  } catch (err) {
    console.error('Push unsubscribe error:', err);
  }
}

async function triggerPushNotification(recipientUid, text, convId) {
  if (!state.currentUser) return;
  // 발신자 이름 가져오기
  let senderName = 'DT Club';
  try {
    const userDoc = await state.db.collection('users').doc(state.currentUserId).get();
    if (userDoc.exists) senderName = userDoc.data().name || senderName;
  } catch {}

  const token = await state.currentUser.getIdToken();
  const resp = await fetch(PUSH_WORKER_URL + '/api/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({
      recipientUid,
      title: senderName,
      body: text.length > 80 ? text.substring(0, 80) + '...' : text,
      convId
    })
  });
  const result = await resp.json();
  console.log('Push send result:', result);
}

function showNotificationBanner() {
  const banner = document.getElementById('notiBanner');
  if (banner) banner.style.display = 'flex';
}
function hideNotificationBanner() {
  const banner = document.getElementById('notiBanner');
  if (banner) banner.style.display = 'none';
  state._showNotiBanner = false;
}
function showIOSInstallBanner() {
  const banner = document.getElementById('iosInstallBanner');
  if (banner) banner.style.display = 'flex';
}
function hideIOSInstallBanner() {
  const banner = document.getElementById('iosInstallBanner');
  if (banner) banner.style.display = 'none';
  state._showIOSInstallBanner = false;
}

/* ===== GAS STATION (주변 주유소 찾기) ===== */
const OPINET_WORKER_URL = 'https://dt-opinet.shocguna.workers.dev';
let _gasUserLocation = null;
let _gasMap = null;
let _gasMarkers = [];
let _gasInfoWindows = [];
let _gasMapLoaded = false;

function openGasStationModal() {
  openModal('gasStationModal');
  document.getElementById('gasDestInput').value = '';
  document.getElementById('gasDestResults').style.display = 'none';
  findGasStations();
}

function searchGasDest() {
  var query = document.getElementById('gasDestInput').value.trim();
  if (!query) return;
  var resultsEl = document.getElementById('gasDestResults');
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:.84rem">검색 중...</div>';

  if (typeof kakao === 'undefined' || !kakao.maps) {
    resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--accent);font-size:.84rem">카카오맵을 불러올 수 없습니다</div>';
    return;
  }

  var doSearch = function() {
    var ps = new kakao.maps.services.Places();
    ps.keywordSearch(query, function(data, status) {
      if (status !== kakao.maps.services.Status.OK || !data.length) {
        resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:.84rem">검색 결과가 없습니다</div>';
        return;
      }
      var html = '';
      data.slice(0, 8).forEach(function(place) {
        html += '<div class="parking-dest-item" onclick="selectGasDest(' + place.y + ',' + place.x + ',\'' + escapeHtml(place.place_name).replace(/'/g, "\\'") + '\')">';
        html += '<div class="parking-dest-name">' + escapeHtml(place.place_name) + '</div>';
        html += '<div class="parking-dest-addr">' + escapeHtml(place.address_name || '') + '</div>';
        html += '</div>';
      });
      resultsEl.innerHTML = html;
    });
  };

  if (_gasMapLoaded) { doSearch(); }
  else { kakao.maps.load(function() { _gasMapLoaded = true; doSearch(); }); }
}

function selectGasDest(lat, lng, name) {
  _gasUserLocation = { lat: lat, lng: lng };
  document.getElementById('gasDestInput').value = name;
  document.getElementById('gasDestResults').style.display = 'none';
  var addrEl = document.getElementById('gasMyAddr');
  var locEl = document.getElementById('gasMyLocation');
  if (addrEl) addrEl.textContent = name;
  if (locEl) locEl.style.display = 'block';
  _fetchGasStations();
}

function findGasStations() {
  var listEl = document.getElementById('gasStationList');
  var mapEl = document.getElementById('gasMap');
  listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">📍 위치를 확인하고 있습니다...</div>';
  mapEl.style.display = 'none';

  if (!navigator.geolocation) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--accent)">❌ 이 브라우저에서는 위치 서비스를 지원하지 않습니다.</div>';
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      _gasUserLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      // 내 위치 표시
      var locEl = document.getElementById('gasMyLocation');
      var addrEl = document.getElementById('gasMyAddr');
      if (locEl) { locEl.style.display = 'block'; }
      // 카카오 역지오코딩으로 주소 변환
      if (typeof kakao !== 'undefined' && kakao.maps) {
        var loadAndGeocode = function() {
          var geocoder = new kakao.maps.services.Geocoder();
          geocoder.coord2Address(_gasUserLocation.lng, _gasUserLocation.lat, function(result, status) {
            if (status === kakao.maps.services.Status.OK && result[0]) {
              addrEl.textContent = result[0].address.address_name;
            } else {
              addrEl.textContent = _gasUserLocation.lat.toFixed(4) + ', ' + _gasUserLocation.lng.toFixed(4);
            }
          });
        };
        if (_gasMapLoaded) { loadAndGeocode(); }
        else { kakao.maps.load(function() { _gasMapLoaded = true; loadAndGeocode(); }); }
      } else {
        if (addrEl) addrEl.textContent = _gasUserLocation.lat.toFixed(4) + ', ' + _gasUserLocation.lng.toFixed(4);
      }
      _fetchGasStations();
    },
    function(err) {
      var msg = '위치를 가져올 수 없습니다.';
      if (err.code === 1) msg = '위치 권한이 거부되었습니다.<br>브라우저 설정에서 위치 권한을 허용해주세요.';
      else if (err.code === 2) msg = '위치 정보를 사용할 수 없습니다.';
      else if (err.code === 3) msg = '위치 요청 시간이 초과되었습니다.';
      listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--accent)">❌ ' + msg + '</div>';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

async function _fetchGasStations() {
  var listEl = document.getElementById('gasStationList');
  var fuel = document.getElementById('gasFuelType').value;
  var radius = document.getElementById('gasRadius').value;
  var sort = document.getElementById('gasSort').value;

  listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">🔍 주유소를 검색하고 있습니다...</div>';

  try {
    var url = OPINET_WORKER_URL + '/api/gas?lat=' + _gasUserLocation.lat + '&lng=' + _gasUserLocation.lng + '&radius=' + radius + '&fuel=' + fuel + '&sort=' + sort;
    var res = await fetch(url);
    if (!res.ok) throw new Error('서버 오류');
    var data = await res.json();

    if (data.error) throw new Error(data.error);

    var stations = data.RESULT && data.RESULT.OIL ? data.RESULT.OIL : [];
    if (!stations.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">😢 반경 내 주유소를 찾을 수 없습니다.<br>반경을 늘려보세요.</div>';
      _renderGasMap([]);
      return;
    }

    _renderGasStations(stations, fuel);
    _renderGasMap(stations);
  } catch (err) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--accent)">❌ 주유소 검색 실패<br><span style="font-size:.8rem">' + escapeHtml(err.message) + '</span></div>';
  }
}

function _renderGasStations(stations, fuel) {
  var listEl = document.getElementById('gasStationList');
  var fuelNames = { 'B027': '휘발유', 'D047': '경유', 'K015': 'LPG', 'B034': '고급휘발유' };
  var fuelName = fuelNames[fuel] || '휘발유';
  var brandNames = {
    'SKE': 'SK에너지', 'GSC': 'GS칼텍스', 'HDO': '현대오일뱅크',
    'SOL': 'S-OIL', 'RTE': '자영알뜰', 'RTX': '고속도로알뜰',
    'NHO': '농협', 'ETC': '기타', 'E1G': 'E1', 'SKG': 'SK가스'
  };

  var html = '<div style="padding:4px 0 8px;font-size:.78rem;color:var(--text3)">총 ' + stations.length + '개 · ' + fuelName + ' 기준</div>';

  stations.forEach(function(s, i) {
    var brand = brandNames[s.POLL_DIV_CD] || s.POLL_DIV_CD || '기타';
    var price = Number(s.PRICE).toLocaleString();
    var dist = s.DISTANCE ? (Number(s.DISTANCE) / 1000).toFixed(1) + 'km' : '';
    var isSelf = s.SELF_YN === 'Y';
    var isTop = i === 0;
    var lat = s.GIS_Y_COOR;
    var lng = s.GIS_X_COOR;
    var name = s.OS_NM || '주유소';

    html += '<div class="gas-card" id="gas-card-' + i + '" onclick="gasFocusStation(' + i + ')" style="cursor:pointer">';
    html += '<div class="gas-rank' + (isTop ? ' top' : '') + '">' + (i + 1) + '</div>';
    html += '<div class="gas-info">';
    html += '<div class="gas-name">' + escapeHtml(name) + (isSelf ? '<span class="gas-self">셀프</span>' : '') + '</div>';
    html += '<div class="gas-brand">' + escapeHtml(brand) + (dist ? ' · ' + dist : '') + '</div>';
    html += '<div class="gas-detail">' + escapeHtml(s.NEW_ADR || s.VAN_ADR || '') + '</div>';
    html += '<button class="gas-nav-btn" onclick="openGasNavigation(' + lat + ',' + lng + ',\'' + escapeHtml(name).replace(/'/g, "\\'") + '\')">🗺️ 길안내</button>';
    html += '</div>';
    html += '<div class="gas-price-wrap">';
    html += '<div class="gas-price">' + price + '</div>';
    html += '<div class="gas-price-unit">원/L</div>';
    html += '</div>';
    html += '</div>';
  });

  listEl.innerHTML = html;
}

function _renderGasMap(stations) {
  var mapEl = document.getElementById('gasMap');

  function initMap() {
    mapEl.style.display = 'block';
    var center = new kakao.maps.LatLng(_gasUserLocation.lat, _gasUserLocation.lng);

    if (!_gasMap) {
      _gasMap = new kakao.maps.Map(mapEl, { center: center, level: 5 });
      // 지도 클릭 시 해당 위치 기준 주유소 재검색
      kakao.maps.event.addListener(_gasMap, 'click', function(mouseEvent) {
        var latlng = mouseEvent.latLng;
        _gasUserLocation = { lat: latlng.getLat(), lng: latlng.getLng() };
        var geocoder = new kakao.maps.services.Geocoder();
        geocoder.coord2Address(latlng.getLng(), latlng.getLat(), function(result, status) {
          var addrEl = document.getElementById('gasMyAddr');
          if (status === kakao.maps.services.Status.OK && result[0]) {
            var addr = result[0].road_address ? result[0].road_address.address_name : result[0].address.address_name;
            if (addrEl) addrEl.textContent = addr;
          } else {
            if (addrEl) addrEl.textContent = '선택한 위치';
          }
        });
        _fetchGasStations();
      });
    } else {
      _gasMap.setCenter(center);
    }

    // 기존 마커 및 인포윈도우 제거
    _gasMarkers.forEach(function(m) { m.setMap(null); });
    _gasMarkers = [];
    _gasInfoWindows = [];

    // 내 위치 마커
    var myMarker = new kakao.maps.Marker({
      position: center,
      map: _gasMap,
      image: new kakao.maps.MarkerImage(
        'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
        new kakao.maps.Size(24, 35)
      )
    });
    _gasMarkers.push(myMarker);

    var bounds = new kakao.maps.LatLngBounds();
    bounds.extend(center);

    // 주유소 마커
    stations.forEach(function(s, i) {
      var pos = new kakao.maps.LatLng(s.GIS_Y_COOR, s.GIS_X_COOR);
      bounds.extend(pos);

      var marker = new kakao.maps.Marker({ position: pos, map: _gasMap });
      _gasMarkers.push(marker);

      var price = Number(s.PRICE).toLocaleString();
      var name = s.OS_NM || '주유소';
      var isSelf = s.SELF_YN === 'Y';

      var infoContent = '<div style="padding:4px 8px;font-size:12px;white-space:nowrap;background:#fff;border-radius:4px;color:#333">'
        + '<b>' + (i + 1) + '. ' + escapeHtml(name) + '</b>' + (isSelf ? ' <span style="color:#22c55e;font-size:10px">셀프</span>' : '')
        + '<br><span style="color:#e65100;font-weight:700">' + price + '원</span>'
        + '</div>';

      var infowindow = new kakao.maps.InfoWindow({ content: infoContent, removable: true });
      _gasInfoWindows.push({ marker: marker, infowindow: infowindow, position: pos });

      kakao.maps.event.addListener(marker, 'click', function() {
        _gasInfoWindows.forEach(function(iw) { iw.infowindow.close(); });
        infowindow.open(_gasMap, marker);
        // 리스트에서 해당 카드 하이라이트
        var card = document.getElementById('gas-card-' + i);
        if (card) { card.style.background = 'rgba(124,111,255,.1)'; card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); setTimeout(function() { card.style.background = ''; }, 2000); }
      });
    });

    // 결과 있으면 bounds 맞춤, 없으면 center + 적절한 줌
    if (stations.length > 0) {
      _gasMap.setBounds(bounds);
    } else {
      _gasMap.setCenter(center);
      _gasMap.setLevel(5);
    }
    var myLocBtn = document.getElementById('gasMyLocBtn');
    if (myLocBtn) myLocBtn.style.display = 'block';
    setTimeout(function() { _gasMap.relayout(); }, 300);
  }

  // 카카오맵 SDK 로드
  if (typeof kakao !== 'undefined' && kakao.maps) {
    var doInit = function() {
      _gasMapLoaded = true;
      // 모달이 완전히 열린 후 지도 초기화
      setTimeout(initMap, 200);
    };
    if (_gasMapLoaded) {
      setTimeout(initMap, 100);
    } else {
      kakao.maps.load(doInit);
    }
  } else {
    mapEl.style.display = 'none';
  }
}

function gasFocusStation(index) {
  if (!_gasMap || !_gasInfoWindows[index]) return;
  var item = _gasInfoWindows[index];
  // 모든 인포윈도우 닫기
  _gasInfoWindows.forEach(function(iw) { iw.infowindow.close(); });
  // 해당 마커로 이동 + 인포윈도우 열기
  _gasMap.setCenter(item.position);
  _gasMap.setLevel(3);
  item.infowindow.open(_gasMap, item.marker);
  // 지도 영역으로 스크롤
  document.getElementById('gasMap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function gasGoToMyLocation() {
  if (_gasMap && _gasUserLocation) {
    var center = new kakao.maps.LatLng(_gasUserLocation.lat, _gasUserLocation.lng);
    _gasMap.setCenter(center);
    _gasMap.setLevel(4);
  }
}

function openGasNavigation(lat, lng, name) {
  var kakaoUrl = 'https://map.kakao.com/link/to/' + encodeURIComponent(name) + ',' + lat + ',' + lng;
  window.open(kakaoUrl, '_blank');
}

/* ===== ANON BOARD (익명 게시판) ===== */
let _anonPosts = [];
let _anonUnsub = null;
let _anonDetailId = null;
let _anonCommentUnsub = null;
let _boardFilter = 'all';

function renderAnon() {
  // 실시간 구독
  if (_anonUnsub) _anonUnsub();
  _anonUnsub = state.db.collection('anon_posts').orderBy('createdAt', 'desc').limit(100)
    .onSnapshot(function(snap) {
      _anonPosts = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
      _renderAnonList();
    }, function(err) { console.error('익명 게시판 구독 오류:', err); });

  // 글자 수 카운트
  var input = document.getElementById('anonInput');
  if (input) {
    input.oninput = function() {
      document.getElementById('anonCharCount').textContent = input.value.length;
    };
  }
}

function _updateHomeAnonList() {
  var homeAnonEl = document.getElementById('home-anon-list');
  if (!homeAnonEl) return;
  var recentAnon = (_anonPosts || []).slice(0, 5);
  homeAnonEl.innerHTML = recentAnon.length
    ? recentAnon.map(function(p) {
        var catBadge = p.category ? '<span class="anon-category anon-cat-' + escapeHtml(p.category) + '">' + escapeHtml(p.category) + '</span>' : '';
        var imgIcon = p.image ? '<span class="anon-has-img">📷</span>' : '';
        var d = p.createdAt ? (p.createdAt.toDate ? p.createdAt.toDate() : new Date(p.createdAt)) : new Date();
        var catIcon = p.category === '공지' ? '📢' : p.category === '활동' ? '🚗' : p.category === '건의' ? '💡' : '💬';
        return '<div class="home-list-item" onclick="goPage(\'anon\');setTimeout(function(){openAnonDetail(\'' + p.id + '\')},300)">'
          + '<span class="item-icon">' + catIcon + '</span>'
          + '<div class="item-info">'
          + '<div class="item-title">' + catBadge + escapeHtml(p.title || '제목 없음') + imgIcon + '</div>'
          + '<div class="item-sub">❤️ ' + (p.likes || 0) + ' · 💬 ' + (p.commentCount || 0) + ' · ' + _timeAgo(d) + '</div>'
          + '</div></div>';
      }).join('')
    : '<div class="empty-state">아직 게시글이 없습니다</div>';
}

function filterBoard(cat) {
  if (cat !== undefined) {
    _boardFilter = cat;
    document.querySelectorAll('[data-board-filter]').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.boardFilter === cat);
    });
  }
  _renderAnonList();
}

function _renderAnonList() {
  var listEl = document.getElementById('anonList');
  if (!_anonPosts.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">아직 게시글이 없습니다.<br>첫 글을 남겨보세요! 📋</div>';
    return;
  }

  var searchQuery = (document.getElementById('boardSearch')?.value || '').trim().toLowerCase();

  // 공지를 최상단으로 분리
  var notices = _anonPosts.filter(function(p) { return p.category === '공지'; });
  var others = _anonPosts.filter(function(p) { return p.category !== '공지'; });
  var sorted = notices.concat(others);

  // 필터 적용
  var filtered = sorted;
  if (_boardFilter !== 'all') {
    filtered = sorted.filter(function(p) { return p.category === _boardFilter; });
  }

  // 검색 적용
  if (searchQuery) {
    var searchType = (document.getElementById('boardSearchType')?.value) || 'title';
    filtered = filtered.filter(function(p) {
      var titleMatch = (p.title || '').toLowerCase().indexOf(searchQuery) !== -1;
      if (searchType === 'title') return titleMatch;
      return titleMatch || (p.text || '').toLowerCase().indexOf(searchQuery) !== -1;
    });
  }

  if (!filtered.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">검색 결과가 없습니다.</div>';
    return;
  }

  var uid = state.currentUserId;
  var isAdmin = state.currentUserRole === 'superadmin' || state.currentUserRole === 'admin';
  var html = '';

  filtered.forEach(function(post) {
    var d = post.createdAt ? (post.createdAt.toDate ? post.createdAt.toDate() : new Date(post.createdAt)) : new Date();
    var timeAgo = _timeAgo(d);
    var liked = post.likedBy && post.likedBy.indexOf(uid) !== -1;
    var likeCount = post.likes || 0;
    var commentCount = post.commentCount || 0;

    html += '<div class="anon-card" onclick="openAnonDetail(\'' + post.id + '\')">';
    var authorDisplay = (post.anonymous !== false) ? '익명' : escapeHtml(post.authorName || '알 수 없음');
    html += '<div class="anon-card-header">';
    html += '<span class="anon-avatar">' + authorDisplay + '</span>';
    html += '<span class="anon-time">' + timeAgo + '</span>';
    html += '</div>';
    var catHtml = post.category ? '<span class="anon-category anon-cat-' + escapeHtml(post.category) + '">' + escapeHtml(post.category) + '</span>' : '';
    html += '<div class="anon-title">' + catHtml + escapeHtml(post.title || '제목 없음') + (post.image ? '<span class="anon-has-img">📷</span>' : '') + '</div>';
    html += '<div class="anon-text anon-text-preview">' + escapeHtml(post.text) + '</div>';
    html += '<div class="anon-actions">';
    html += '<button class="anon-action-btn' + (liked ? ' liked' : '') + '" onclick="event.stopPropagation();toggleAnonLike(\'' + post.id + '\')">' + (liked ? '❤️' : '🤍') + ' ' + likeCount + '</button>';
    html += '<button class="anon-action-btn" onclick="event.stopPropagation();openAnonDetail(\'' + post.id + '\')">💬 ' + commentCount + '</button>';
    if (isAdmin) {
      html += '<button class="anon-delete-btn" onclick="event.stopPropagation();deleteAnon(\'' + post.id + '\')">🗑️ 삭제</button>';
    }
    html += '</div>';
    html += '</div>';
  });

  listEl.innerHTML = html;
}

function _timeAgo(date) {
  var now = new Date();
  var diff = Math.floor((now - date) / 1000);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return Math.floor(diff / 60) + '분 전';
  if (diff < 86400) return Math.floor(diff / 3600) + '시간 전';
  if (diff < 604800) return Math.floor(diff / 86400) + '일 전';
  return date.toLocaleDateString('ko-KR');
}

let _anonImageData = null;

function previewAnonImage(fileInput) {
  var file = fileInput.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { alert('10MB 이하의 이미지만 첨부할 수 있습니다.'); fileInput.value = ''; return; }
  document.getElementById('anonImageName').textContent = file.name;
  compressImage(file, 800, 0.8).then(function(dataUrl) {
    _anonImageData = dataUrl;
    document.getElementById('anonImagePreview').innerHTML = '<div style="position:relative;display:inline-block"><img src="' + dataUrl + '" style="max-width:120px;max-height:80px;border-radius:8px;border:1px solid var(--border)"><button onclick="clearAnonImage()" style="position:absolute;top:-6px;right:-6px;background:var(--accent);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:.7rem;line-height:1">✕</button></div>';
  }).catch(function() { alert('이미지 처리 실패'); fileInput.value = ''; });
}

function clearAnonImage() {
  _anonImageData = null;
  document.getElementById('anonImageInput').value = '';
  document.getElementById('anonImageName').textContent = '';
  document.getElementById('anonImagePreview').innerHTML = '';
}

async function refineWithAI() {
  var input = document.getElementById('anonInput');
  var text = input.value.trim();
  if (!text) { alert('정리할 내용을 입력해주세요.'); return; }
  var btn = document.getElementById('btnAiRefine');
  btn.disabled = true;
  btn.textContent = '⏳ 정리 중...';
  try {
    var res = await fetch('https://dt-ai.shocguna.workers.dev/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    });
    var data = await res.json();
    if (data.error) { alert('AI 정리 실패: ' + data.error); return; }
    input.value = data.refined || text;
    document.getElementById('anonCharCount').textContent = input.value.length;
  } catch (e) {
    alert('AI 정리 실패: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ AI 정리';
  }
}

async function postAnon() {
  var titleInput = document.getElementById('anonTitleInput');
  var input = document.getElementById('anonInput');
  var catSelect = document.getElementById('anonCategory');
  var title = titleInput.value.trim();
  var text = input.value.trim();
  var category = catSelect.value;
  if (!title) { alert('제목을 입력해주세요.'); return; }
  if (!text) { alert('내용을 입력해주세요.'); return; }
  if (!state.currentUserId) { alert('로그인이 필요합니다.'); return; }

  try {
    var isAnon = document.getElementById('anonAnonymous').checked;
    var authorName = '';
    if (!isAnon) {
      var member = state.members.find(function(m) { return m.createdBy === state.currentUserId; });
      authorName = member ? displayName(member.name) : (state.currentUser?.displayName || '');
    }
    var noComment = document.getElementById('anonNoComment').checked;
    var data = {
      title: title,
      text: text,
      category: category,
      anonymous: isAnon,
      authorName: isAnon ? '' : authorName,
      noComment: noComment,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: state.currentUserId,
      likes: 0,
      likedBy: [],
      commentCount: 0
    };
    if (_anonImageData) data.image = _anonImageData;
    await state.db.collection('anon_posts').add(data);
    titleInput.value = '';
    input.value = '';
    catSelect.value = '';
    document.getElementById('anonCharCount').textContent = '0';
    clearAnonImage();
  } catch (err) {
    alert('작성 실패: ' + err.message);
  }
}

var _editingPostId = null;
var _editAnonImageData = null; // null=변경없음, ''=삭제, 'data:...'=새 이미지
var _editAnonOriginalImage = null;

function openEditAnon(postId) {
  var post = _anonPosts.find(function(p) { return p.id === postId; });
  if (!post || post.createdBy !== state.currentUserId) { alert('수정 권한이 없습니다.'); return; }
  _editingPostId = postId;
  _editAnonImageData = null;
  _editAnonOriginalImage = post.image || '';
  document.getElementById('editAnonCategory').value = post.category || '';
  document.getElementById('editAnonTitle').value = post.title || '';
  document.getElementById('editAnonText').value = post.text || '';
  document.getElementById('editAnonAnonymous').checked = post.anonymous !== false;
  document.getElementById('editAnonNoComment').checked = !!post.noComment;
  document.getElementById('editAnonImageInput').value = '';
  document.getElementById('editAnonImageName').textContent = '';

  // 기존 사진 미리보기
  var previewEl = document.getElementById('editAnonImagePreview');
  if (post.image) {
    previewEl.innerHTML = '<div style="position:relative;display:inline-block"><img src="' + post.image + '" style="max-width:100%;max-height:200px;border-radius:8px"><button onclick="removeEditAnonImage()" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:.8rem">✕</button></div>';
  } else {
    previewEl.innerHTML = '';
  }
  openModal('anonEditModal');
}

function previewEditAnonImage(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { alert('5MB 이하 이미지만 가능합니다.'); input.value = ''; return; }
  document.getElementById('editAnonImageName').textContent = file.name;
  compressImage(file, 800, 0.75, function(dataUrl) {
    _editAnonImageData = dataUrl;
    var previewEl = document.getElementById('editAnonImagePreview');
    previewEl.innerHTML = '<div style="position:relative;display:inline-block"><img src="' + dataUrl + '" style="max-width:100%;max-height:200px;border-radius:8px"><button onclick="removeEditAnonImage()" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.7);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:.8rem">✕</button></div>';
  });
}

function removeEditAnonImage() {
  _editAnonImageData = ''; // 빈 문자열 = 삭제 의도
  document.getElementById('editAnonImagePreview').innerHTML = '<div style="padding:8px;color:var(--text3);font-size:.82rem">🗑️ 사진이 삭제됩니다</div>';
  document.getElementById('editAnonImageInput').value = '';
  document.getElementById('editAnonImageName').textContent = '';
}

async function submitEditAnon() {
  if (!_editingPostId) return;
  var title = document.getElementById('editAnonTitle').value.trim();
  var text = document.getElementById('editAnonText').value.trim();
  if (!title) { alert('제목을 입력해주세요.'); return; }
  if (!text) { alert('내용을 입력해주세요.'); return; }

  var isAnon = document.getElementById('editAnonAnonymous').checked;
  var authorName = '';
  if (!isAnon) {
    var member = state.members.find(function(m) { return m.createdBy === state.currentUserId; });
    authorName = member ? displayName(member.name) : (state.currentUser?.displayName || '');
  }

  try {
    var updateData = {
      title: title,
      text: text,
      category: document.getElementById('editAnonCategory').value,
      anonymous: isAnon,
      authorName: isAnon ? '' : authorName,
      noComment: document.getElementById('editAnonNoComment').checked
    };

    // 사진 처리: null=변경없음, ''=삭제, 'data:...'=새 이미지
    if (_editAnonImageData === '') {
      updateData.image = firebase.firestore.FieldValue.delete();
    } else if (_editAnonImageData && _editAnonImageData.startsWith('data:')) {
      updateData.image = _editAnonImageData;
    }

    await state.db.collection('anon_posts').doc(_editingPostId).update(updateData);
    closeModal('anonEditModal');
    closeModal('anonDetailModal');
    _editingPostId = null;
    _editAnonImageData = null;
  } catch (e) {
    alert('수정 실패: ' + e.message);
  }
}

async function deleteAnon(postId) {
  if (!confirm('이 게시글을 삭제하시겠습니까?')) return;
  try {
    // 댓글 서브컬렉션도 삭제
    var comments = await state.db.collection('anon_posts').doc(postId).collection('comments').get();
    var batch = state.db.batch();
    comments.forEach(function(doc) { batch.delete(doc.ref); });
    batch.delete(state.db.collection('anon_posts').doc(postId));
    await batch.commit();
    closeModal('anonDetailModal');
  } catch (err) {
    alert('삭제 실패: ' + err.message);
  }
}

async function toggleAnonLike(postId) {
  if (!state.currentUserId) { alert('로그인이 필요합니다.'); return; }
  var uid = state.currentUserId;
  var ref = state.db.collection('anon_posts').doc(postId);
  var FV = firebase.firestore.FieldValue;

  try {
    var snap = await ref.get();
    var likedBy = snap.data()?.likedBy || [];
    if (likedBy.indexOf(uid) !== -1) {
      await ref.update({ likes: FV.increment(-1), likedBy: FV.arrayRemove(uid) });
    } else {
      await ref.update({ likes: FV.increment(1), likedBy: FV.arrayUnion(uid) });
    }
  } catch (err) {
    console.error('좋아요 실패:', err);
  }
}

function openAnonDetail(postId) {
  if (state.isGuest) { alert('회원만 상세 보기가 가능합니다.\n로그인 후 이용해주세요.'); return; }
  _anonDetailId = postId;
  var post = _anonPosts.find(function(p) { return p.id === postId; });
  if (!post) return;

  var d = post.createdAt ? (post.createdAt.toDate ? post.createdAt.toDate() : new Date(post.createdAt)) : new Date();
  var uid = state.currentUserId;
  var liked = post.likedBy && post.likedBy.indexOf(uid) !== -1;

  var detailAuthor = (post.anonymous !== false) ? '익명' : escapeHtml(post.authorName || '알 수 없음');
  var detailCatHtml = post.category ? '<span class="anon-category anon-cat-' + escapeHtml(post.category) + '">' + escapeHtml(post.category) + '</span>' : '';
  var html = '<div style="margin-bottom:8px;font-size:.82rem;color:var(--text2)">' + detailAuthor + '</div>';
  html += '<div class="anon-title" style="font-size:1.05rem;margin-bottom:8px">' + detailCatHtml + escapeHtml(post.title || '제목 없음') + '</div>';
  html += '<div class="anon-text" style="margin-bottom:12px">' + escapeHtml(post.text) + '</div>';
  if (post.image) {
    html += '<div style="margin-bottom:12px"><img src="' + post.image + '" style="max-width:100%;border-radius:8px;cursor:pointer" onclick="openLightbox(\'' + post.image + '\')" onerror="this.outerHTML=\'<div style=padding:12px;color:var(--text3);font-size:.82rem>⚠️ 이미지를 불러올 수 없습니다</div>\'"></div>';
  }
  html += '<div style="display:flex;gap:14px;align-items:center;padding-bottom:8px;border-bottom:1px solid var(--border);flex-wrap:wrap">';
  html += '<button class="anon-action-btn' + (liked ? ' liked' : '') + '" onclick="toggleAnonLike(\'' + postId + '\');setTimeout(function(){openAnonDetail(\'' + postId + '\')},500)">' + (liked ? '❤️' : '🤍') + ' ' + (post.likes || 0) + '</button>';
  html += '<span class="anon-time">' + _timeAgo(d) + '</span>';
  var isOwner = post.createdBy === uid;
  var isAdmin = state.currentUserRole === 'superadmin' || state.currentUserRole === 'admin';
  if (isOwner) {
    html += '<button class="anon-action-btn" onclick="openEditAnon(\'' + postId + '\')" style="margin-left:auto">✏️ 수정</button>';
  }
  if (isOwner || isAdmin) {
    html += '<button class="anon-action-btn" onclick="deleteAnon(\'' + postId + '\')" style="color:#ef4444">🗑️ 삭제</button>';
  }
  html += '</div>';

  document.getElementById('anonDetailContent').innerHTML = html;
  openModal('anonDetailModal');

  // 댓글 막기 처리
  var commentSection = document.querySelector('.anon-comment-input');
  var commentHeader = document.querySelector('#anonDetailModal h4');
  if (post.noComment) {
    if (commentSection) commentSection.style.display = 'none';
    if (commentHeader) commentHeader.innerHTML = '💬 댓글이 막힌 게시글입니다';
    document.getElementById('anonCommentList').innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);font-size:.82rem">작성자가 댓글을 막았습니다.</div>';
    return;
  } else {
    if (commentSection) commentSection.style.display = '';
    if (commentHeader) commentHeader.innerHTML = '💬 댓글 <span id="anonCommentCount">0</span>';
  }

  // 댓글 실시간 구독
  if (_anonCommentUnsub) _anonCommentUnsub();
  _anonCommentUnsub = state.db.collection('anon_posts').doc(postId).collection('comments')
    .orderBy('createdAt', 'asc')
    .onSnapshot(function(snap) {
      var comments = snap.docs.map(function(d) { return { id: d.id, ...d.data() }; });
      document.getElementById('anonCommentCount').textContent = comments.length;
      _renderAnonComments(comments);
    }, function(err) { console.error('댓글 구독 오류:', err); });
}

function _renderAnonComments(comments) {
  var listEl = document.getElementById('anonCommentList');
  if (!comments.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text3);font-size:.82rem">아직 댓글이 없습니다</div>';
    return;
  }
  var isAdmin = state.currentUserRole === 'superadmin' || state.currentUserRole === 'admin';
  var html = '';
  comments.forEach(function(c) {
    var d = c.createdAt ? (c.createdAt.toDate ? c.createdAt.toDate() : new Date(c.createdAt)) : new Date();
    html += '<div class="anon-comment">';
    html += '<div class="anon-comment-header">';
    var cmtAuthor = (c.anonymous !== false) ? '익명' : escapeHtml(c.authorName || '알 수 없음');
    html += '<span class="anon-comment-name">' + cmtAuthor + '</span>';
    html += '<span class="anon-comment-time">' + _timeAgo(d);
    if (isAdmin) html += ' <button onclick="deleteAnonComment(\'' + _anonDetailId + '\',\'' + c.id + '\')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:.68rem">🗑️</button>';
    html += '</span>';
    html += '</div>';
    html += '<div class="anon-comment-text">' + escapeHtml(c.text) + '</div>';
    html += '</div>';
  });
  listEl.innerHTML = html;
}

async function postAnonComment() {
  if (!state.currentUserId) { alert('로그인이 필요합니다.'); return; }
  if (!_anonDetailId) return;
  var input = document.getElementById('anonCommentInput');
  var text = input.value.trim();
  if (!text) return;

  try {
    var cmtAnon = document.getElementById('anonCommentAnonymous').checked;
    var cmtName = '';
    if (!cmtAnon) {
      var cmtMember = state.members.find(function(m) { return m.createdBy === state.currentUserId; });
      cmtName = cmtMember ? displayName(cmtMember.name) : '';
    }
    await state.db.collection('anon_posts').doc(_anonDetailId).collection('comments').add({
      text: text,
      anonymous: cmtAnon,
      authorName: cmtAnon ? '' : cmtName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: state.currentUserId
    });
    await state.db.collection('anon_posts').doc(_anonDetailId).update({
      commentCount: firebase.firestore.FieldValue.increment(1)
    });
    input.value = '';
  } catch (err) {
    alert('댓글 작성 실패: ' + err.message);
  }
}

async function deleteAnonComment(postId, commentId) {
  if (!confirm('이 댓글을 삭제하시겠습니까?')) return;
  try {
    await state.db.collection('anon_posts').doc(postId).collection('comments').doc(commentId).delete();
    await state.db.collection('anon_posts').doc(postId).update({
      commentCount: firebase.firestore.FieldValue.increment(-1)
    });
  } catch (err) {
    alert('삭제 실패: ' + err.message);
  }
}

/* ===== TEAM DIVIDE (조 나누기) ===== */
function openTeamDivideModal() {
  var members = state.members || [];
  if (!members.length) { alert('등록된 회원이 없습니다.'); return; }

  var drivers = members.filter(function(m) { return m.role === 'driver'; });
  var passengers = members.filter(function(m) { return m.role === 'passenger'; });

  var html = '';
  members.forEach(function(m) {
    var isDriver = m.role === 'driver';
    var roleClass = isDriver ? 'team-role-driver' : 'team-role-passenger';
    var roleText = isDriver ? '운전' : '동승';
    html += '<div class="team-member-row">';
    html += '<input type="checkbox" class="team-cb" id="team-' + m.id + '" data-id="' + m.id + '" checked onchange="updateTeamCount()">';
    html += '<label for="team-' + m.id + '">' + escapeHtml(displayName(m.name)) + '</label>';
    html += '<button class="team-role-badge ' + roleClass + '" style="border:none;cursor:pointer" data-id="' + m.id + '" onclick="toggleTeamRole(this)">🚗 ' + roleText + '</button>';
    html += '</div>';
  });

  document.getElementById('teamMemberList').innerHTML = html;
  document.getElementById('teamSelectAll').checked = true;
  document.getElementById('teamResults').innerHTML = '';
  updateTeamCount();
  openModal('teamDivideModal');
}

let _teamGuestId = 0;

function addTeamGuest() {
  var nameInput = document.getElementById('teamGuestName');
  var name = nameInput.value.trim();
  if (!name) return;
  var role = document.getElementById('teamGuestRole').value;
  var isDriver = role === 'driver';
  var roleClass = isDriver ? 'team-role-driver' : 'team-role-passenger';
  var roleText = isDriver ? '운전' : '동승';
  var guestId = 'guest-' + (++_teamGuestId);

  var row = document.createElement('div');
  row.className = 'team-member-row';
  row.innerHTML = '<input type="checkbox" class="team-cb" id="team-' + guestId + '" data-id="' + guestId + '" data-guest="true" data-name="' + escapeHtml(name) + '" checked onchange="updateTeamCount()">'
    + '<label for="team-' + guestId + '">' + escapeHtml(name) + ' <span style="font-size:.68rem;color:var(--text3)">(비회원)</span></label>'
    + '<button class="team-role-badge ' + roleClass + '" style="border:none;cursor:pointer" onclick="toggleTeamRole(this)">🚗 ' + roleText + '</button>';

  document.getElementById('teamMemberList').appendChild(row);
  nameInput.value = '';
  updateTeamCount();
}

function toggleAllTeamMembers(checked) {
  document.querySelectorAll('.team-cb').forEach(function(cb) { cb.checked = checked; });
  updateTeamCount();
}

function toggleTeamRole(btn) {
  var isDriver = btn.classList.contains('team-role-driver');
  if (isDriver) {
    btn.classList.remove('team-role-driver');
    btn.classList.add('team-role-passenger');
    btn.textContent = '🧑 동승';
  } else {
    btn.classList.remove('team-role-passenger');
    btn.classList.add('team-role-driver');
    btn.textContent = '🚗 운전';
  }
  updateTeamCount();
}

function updateTeamCount() {
  var driverCount = 0;
  document.querySelectorAll('.team-cb:checked').forEach(function(cb) {
    var roleBtn = cb.closest('.team-member-row').querySelector('.team-role-badge');
    if (roleBtn && roleBtn.classList.contains('team-role-driver')) driverCount++;
  });
  document.getElementById('teamCountInfo').textContent = '운전자 ' + driverCount + '명 = ' + driverCount + '조';
}

function _shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

function divideTeams() {
  var checkboxes = document.querySelectorAll('.team-cb:checked');
  if (!checkboxes.length) { alert('참여할 회원을 선택해주세요.'); return; }

  var selectedDrivers = [];
  var selectedPassengers = [];

  checkboxes.forEach(function(cb) {
    var person;
    if (cb.dataset.guest === 'true') {
      person = { id: cb.dataset.id, name: cb.dataset.name, role: 'guest' };
    } else {
      person = state.members.find(function(m) { return m.id === cb.dataset.id; });
    }
    if (!person) return;
    var roleBtn = cb.closest('.team-member-row').querySelector('.team-role-badge');
    var isDriver = roleBtn && roleBtn.classList.contains('team-role-driver');
    if (isDriver) selectedDrivers.push(person);
    else selectedPassengers.push(person);
  });

  var teamCount = Math.max(1, selectedDrivers.length);
  if (!selectedDrivers.length) { alert('운전자를 최소 1명 이상 선택해주세요.'); return; }

  // 조 초기화
  var teams = [];
  for (var i = 0; i < teamCount; i++) {
    teams.push({ drivers: [], passengers: [] });
  }

  // 운전자 랜덤 셔플 후 각 조에 배치
  var shuffledDrivers = _shuffleArray(selectedDrivers);
  shuffledDrivers.forEach(function(d, idx) {
    teams[idx % teamCount].drivers.push(d);
  });

  // 동승자 랜덤 셔플 후 균등 배분
  var shuffledPassengers = _shuffleArray(selectedPassengers);
  shuffledPassengers.forEach(function(p, idx) {
    teams[idx % teamCount].passengers.push(p);
  });

  renderTeamResults(teams);
}

function renderTeamResults(teams) {
  var resultsEl = document.getElementById('teamResults');
  var total = 0;
  teams.forEach(function(t) { total += t.drivers.length + t.passengers.length; });

  var html = '<div style="margin-bottom:12px;font-size:.82rem;color:var(--text3)">총 ' + total + '명 → ' + teams.length + '조</div>';
  html += '<div class="team-result-grid">';

  teams.forEach(function(team, i) {
    html += '<div class="team-result-card">';
    html += '<div class="team-result-title">' + (i + 1) + '조 (' + (team.drivers.length + team.passengers.length) + '명)</div>';

    team.drivers.forEach(function(d) {
      html += '<div class="team-result-member">';
      html += '<span class="team-role-badge team-role-driver">운전</span>';
      html += '<span>' + escapeHtml(displayName(d.name)) + '</span>';
      html += '</div>';
    });

    team.passengers.forEach(function(p) {
      html += '<div class="team-result-member">';
      html += '<span class="team-role-badge team-role-passenger">동승</span>';
      html += '<span>' + escapeHtml(displayName(p.name)) + '</span>';
      html += '</div>';
    });

    html += '</div>';
  });

  html += '</div>';
  resultsEl.innerHTML = html;
}

/* ===== PARKING (주차장 찾기) ===== */
let _parkingMap = null;
let _parkingMarkers = [];
let _parkingInfoWindows = [];
let _parkingDest = null; // { lat, lng, name }

function openParkingModal() {
  openModal('parkingModal');
  document.getElementById('parkingDestInput').value = '';
  document.getElementById('parkingDestResults').style.display = 'none';
  document.getElementById('parkingList').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">🔍 도착지를 검색하거나<br>지도를 탭하여 주차장을 찾으세요</div>';
  setTimeout(function() { document.getElementById('parkingDestInput').focus(); }, 200);

  // 기본 지도 표시 (내 위치 또는 서울)
  var mapEl = document.getElementById('parkingMap');
  mapEl.style.display = 'block';

  var initMap = function(lat, lng) {
    var doInit = function() {
      var center = new kakao.maps.LatLng(lat, lng);
      if (!_parkingMap) {
        _parkingMap = new kakao.maps.Map(mapEl, { center: center, level: 5 });
        // 지도 클릭 시 해당 위치 기준 주차장 검색
        kakao.maps.event.addListener(_parkingMap, 'click', function(mouseEvent) {
          var latlng = mouseEvent.latLng;
          _parkingDest = { lat: latlng.getLat(), lng: latlng.getLng(), name: '선택한 위치' };
          // 역지오코딩으로 주소 표시
          var geocoder = new kakao.maps.services.Geocoder();
          geocoder.coord2Address(latlng.getLng(), latlng.getLat(), function(result, status) {
            if (status === kakao.maps.services.Status.OK && result[0]) {
              var addr = result[0].road_address ? result[0].road_address.address_name : result[0].address.address_name;
              _parkingDest.name = addr;
              document.getElementById('parkingDestInput').value = addr;
            }
          });
          document.getElementById('parkingDestInput').value = '선택한 위치';
          document.getElementById('parkingDestResults').style.display = 'none';
          _searchNearbyParking();
        });
      } else {
        _parkingMap.setCenter(center);
        _parkingMap.setLevel(5);
      }
      // 기존 마커 제거
      _parkingMarkers.forEach(function(m) { m.setMap(null); });
      _parkingMarkers = [];
      _parkingInfoWindows = [];
      setTimeout(function() { _parkingMap.relayout(); }, 300);
    };

    if (typeof kakao !== 'undefined' && kakao.maps) {
      if (_gasMapLoaded) { doInit(); }
      else { kakao.maps.load(function() { _gasMapLoaded = true; doInit(); }); }
    }
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      function(pos) { initMap(pos.coords.latitude, pos.coords.longitude); },
      function() { initMap(37.5665, 126.978); }
    );
  } else {
    initMap(37.5665, 126.978);
  }
}

function searchParkingDest() {
  var query = document.getElementById('parkingDestInput').value.trim();
  if (!query) return;

  var resultsEl = document.getElementById('parkingDestResults');
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:.84rem">검색 중...</div>';

  if (typeof kakao === 'undefined' || !kakao.maps) {
    resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--accent);font-size:.84rem">카카오맵을 불러올 수 없습니다</div>';
    return;
  }

  var doSearch = function() {
    var ps = new kakao.maps.services.Places();
    ps.keywordSearch(query, function(data, status) {
      if (status !== kakao.maps.services.Status.OK || !data.length) {
        resultsEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text3);font-size:.84rem">검색 결과가 없습니다</div>';
        return;
      }
      var html = '';
      data.slice(0, 8).forEach(function(place) {
        html += '<div class="parking-dest-item" onclick="selectParkingDest(' + place.y + ',' + place.x + ',\'' + escapeHtml(place.place_name).replace(/'/g, "\\'") + '\')">';
        html += '<div class="parking-dest-name">' + escapeHtml(place.place_name) + '</div>';
        html += '<div class="parking-dest-addr">' + escapeHtml(place.address_name || '') + '</div>';
        html += '</div>';
      });
      resultsEl.innerHTML = html;
    });
  };

  if (_gasMapLoaded) { doSearch(); }
  else { kakao.maps.load(function() { _gasMapLoaded = true; doSearch(); }); }
}

function selectParkingDest(lat, lng, name) {
  _parkingDest = { lat: lat, lng: lng, name: name };
  document.getElementById('parkingDestInput').value = name;
  document.getElementById('parkingDestResults').style.display = 'none';
  _searchNearbyParking();
}

function _searchNearbyParking() {
  var listEl = document.getElementById('parkingList');
  listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">🔍 주변 주차장을 검색하고 있습니다...</div>';

  var ps = new kakao.maps.services.Places();
  var location = new kakao.maps.LatLng(_parkingDest.lat, _parkingDest.lng);

  ps.categorySearch('PK6', function(data, status) {
    if (status !== kakao.maps.services.Status.OK || !data.length) {
      listEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">😢 주변에 주차장을 찾을 수 없습니다</div>';
      _renderParkingMap([]);
      return;
    }
    _renderParkingList(data);
    _renderParkingMap(data);
  }, {
    location: location,
    radius: 1000,
    sort: kakao.maps.services.SortBy.DISTANCE,
    size: 15
  });
}

function _renderParkingList(places) {
  var listEl = document.getElementById('parkingList');
  var html = '<div style="padding:4px 0 8px;font-size:.78rem;color:var(--text3)">📍 ' + escapeHtml(_parkingDest.name) + ' 주변 · ' + places.length + '개</div>';

  places.forEach(function(p, i) {
    var dist = p.distance ? (Number(p.distance) < 1000 ? p.distance + 'm' : (Number(p.distance) / 1000).toFixed(1) + 'km') : '';
    html += '<div class="parking-card" id="parking-card-' + i + '" onclick="parkingFocus(' + i + ')">';
    html += '<div class="gas-rank' + (i === 0 ? ' top' : '') + '">' + (i + 1) + '</div>';
    html += '<div class="parking-info">';
    html += '<div class="parking-name">' + escapeHtml(p.place_name) + '</div>';
    html += '<div class="parking-addr">' + escapeHtml(p.road_address_name || p.address_name || '') + '</div>';
    if (p.phone) html += '<div class="parking-phone">📞 <a href="tel:' + p.phone + '">' + escapeHtml(p.phone) + '</a></div>';
    html += '<button class="gas-nav-btn" onclick="event.stopPropagation();openGasNavigation(' + p.y + ',' + p.x + ',\'' + escapeHtml(p.place_name).replace(/'/g, "\\'") + '\')">🗺️ 길안내</button>';
    html += '</div>';
    html += '<div class="parking-dist">' + dist + '</div>';
    html += '</div>';
  });

  listEl.innerHTML = html;
}

function _renderParkingMap(places) {
  var mapEl = document.getElementById('parkingMap');
  mapEl.style.display = 'block';

  var center = new kakao.maps.LatLng(_parkingDest.lat, _parkingDest.lng);

  if (!_parkingMap) {
    _parkingMap = new kakao.maps.Map(mapEl, { center: center, level: 4 });
  } else {
    _parkingMap.setCenter(center);
  }

  // 기존 마커 제거
  _parkingMarkers.forEach(function(m) { m.setMap(null); });
  _parkingMarkers = [];
  _parkingInfoWindows = [];

  // 도착지 마커 (별 모양)
  var destMarker = new kakao.maps.Marker({
    position: center,
    map: _parkingMap,
    image: new kakao.maps.MarkerImage(
      'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png',
      new kakao.maps.Size(24, 35)
    )
  });
  _parkingMarkers.push(destMarker);

  var bounds = new kakao.maps.LatLngBounds();
  bounds.extend(center);

  // 주차장 마커
  places.forEach(function(p, i) {
    var pos = new kakao.maps.LatLng(p.y, p.x);
    bounds.extend(pos);

    var marker = new kakao.maps.Marker({ position: pos, map: _parkingMap });
    _parkingMarkers.push(marker);

    var dist = p.distance ? (Number(p.distance) < 1000 ? p.distance + 'm' : (Number(p.distance) / 1000).toFixed(1) + 'km') : '';
    var infoContent = '<div style="padding:4px 8px;font-size:12px;white-space:nowrap;background:#fff;border-radius:4px;color:#333">'
      + '<b>' + (i + 1) + '. ' + escapeHtml(p.place_name) + '</b>'
      + (dist ? '<br><span style="color:#60a5fa">' + dist + '</span>' : '')
      + '</div>';

    var infowindow = new kakao.maps.InfoWindow({ content: infoContent, removable: true });
    _parkingInfoWindows.push({ marker: marker, infowindow: infowindow, position: pos });

    kakao.maps.event.addListener(marker, 'click', function() {
      _parkingInfoWindows.forEach(function(iw) { iw.infowindow.close(); });
      infowindow.open(_parkingMap, marker);
      var card = document.getElementById('parking-card-' + i);
      if (card) { card.style.background = 'rgba(124,111,255,.1)'; card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); setTimeout(function() { card.style.background = ''; }, 2000); }
    });
  });

  if (places.length > 0) {
    _parkingMap.setBounds(bounds);
  } else {
    _parkingMap.setCenter(center);
    _parkingMap.setLevel(4);
  }
  setTimeout(function() { _parkingMap.relayout(); }, 300);
}

function parkingFocus(index) {
  if (!_parkingMap || !_parkingInfoWindows[index]) return;
  var item = _parkingInfoWindows[index];
  _parkingInfoWindows.forEach(function(iw) { iw.infowindow.close(); });
  _parkingMap.setCenter(item.position);
  _parkingMap.setLevel(3);
  item.infowindow.open(_parkingMap, item.marker);
  document.getElementById('parkingMap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ===== IMAGE 압축 (base64 → Firestore 직접 저장) ===== */
function compressImage(file, maxSize, quality) {
  return new Promise(async (resolve, reject) => {
    try {
      // createImageBitmap은 EXIF 방향을 자동 처리
      var bitmap = await createImageBitmap(file);
      var width = bitmap.width, height = bitmap.height;
      var dw = width, dh = height;
      if (width > maxSize || height > maxSize) {
        if (width > height) { dh = dh * maxSize / dw; dw = maxSize; }
        else { dw = dw * maxSize / dh; dh = maxSize; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = dw;
      canvas.height = dh;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0, dw, dh);
      bitmap.close();
      resolve(canvas.toDataURL('image/jpeg', quality));
    } catch(e) { reject(e); }
  });
}

/* ===== HELPERS ===== */
function _avatarFallback(name) {
  const colors = ['#6c63ff', '#ff6b6b', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];
  return colors[(name?.charCodeAt(0) || 0) % colors.length];
}
function avatarEl(m) {
  const color = _avatarFallback(m.name);
  const initial = escapeHtml(m.name?.[0] || '?');
  const fallback = `<span style="background:${color};color:#fff;width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:inherit;font-weight:700">${initial}</span>`;
  if (m.image) return `<img src="${m.image}" alt="${escapeHtml(displayName(m.name))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" onerror="this.outerHTML=this.dataset.fallback" data-fallback='${fallback.replace(/'/g, "&#39;")}'>`;
  return fallback;
}

function avatarSmall(m) {
  const color = _avatarFallback(m.name);
  const initial = escapeHtml(m.name?.[0] || '?');
  const fallback = `<span style="background:${color};color:#fff;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0">${initial}</span>`;
  if (m.image) return `<img src="${m.image}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" onerror="this.outerHTML=this.dataset.fallback" data-fallback='${fallback.replace(/'/g, "&#39;")}'>`;
  return fallback;
}

/* ===== CROP ===== */
let _cropperInstance = null;
let _cropCallback = null;
let _galleryQueue = [];
let _galleryResults = [];

function openCropModal(file, aspectRatio, callback) {
  // 파일 크기 제한 (15MB)
  if (file.size > 15 * 1024 * 1024) { alert('15MB 이하의 이미지만 업로드할 수 있습니다.'); return; }
  _cropCallback = callback;
  const img = document.getElementById('cropImage');
  // ObjectURL 사용 — 브라우저가 EXIF 방향을 자동 처리
  if (img._objectUrl) URL.revokeObjectURL(img._objectUrl);
  var objUrl = URL.createObjectURL(file);
  img._objectUrl = objUrl;
  img.src = objUrl;
  const overlay = document.getElementById('cropModal');
  overlay.style.display = 'flex';
  if (_cropperInstance) { _cropperInstance.destroy(); _cropperInstance = null; }
  img.onload = () => {
    _cropperInstance = new Cropper(img, {
      aspectRatio: aspectRatio ?? NaN,
      viewMode: 1,
      autoCropArea: 1,
      dragMode: 'move',
      cropBoxMovable: false,
      cropBoxResizable: false,
      movable: true,
      zoomable: true,
      rotatable: false,
      checkOrientation: false, // 브라우저가 이미 EXIF 처리, Cropper 중복 방지
      toggleDragModeOnDblclick: false,
    });
  };
}

function confirmCrop() {
  if (!_cropperInstance || !_cropCallback) return;
  const canvas = _cropperInstance.getCroppedCanvas({ maxWidth: 1200, maxHeight: 1200 });
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const cb = _cropCallback;
  closeCropModal();
  cb(dataUrl);
  // 갤러리 큐 처리
  if (_galleryQueue.length > 0) {
    const next = _galleryQueue.shift();
    openCropModal(next, NaN, dataUrl2 => {
      _galleryResults.push(dataUrl2);
      confirmGalleryQueue();
    });
  }
}

function confirmGalleryQueue() {
  if (_galleryQueue.length > 0) return; // 아직 진행 중
  _galleryResults.forEach(dataUrl => addGalleryPreview(dataUrl));
  _galleryResults = [];
}

function cancelCrop() {
  closeCropModal();
  _galleryQueue = [];
  _galleryResults = [];
}

function closeCropModal() {
  if (_cropperInstance) { _cropperInstance.destroy(); _cropperInstance = null; }
  _cropCallback = null;
  const cropImg = document.getElementById('cropImage');
  if (cropImg) cropImg.src = '';
  document.getElementById('cropModal').style.display = 'none';
}

/* ===== 사진 미리보기 헬퍼 ===== */
function profilePreviewHtml(src, isNew) {
  const label = isNew ? '선택된 새 사진' : '현재 사진 · 새 파일 선택 시 교체됩니다';
  return `<div class="preview-inline">
    <div class="preview-thumb-wrap">
      <img src="${src}" class="preview-thumb-profile">
      <button type="button" class="preview-thumb-del" onclick="clearPhotoPreview('memberImage','memberImagePreview')">✕</button>
    </div>
    <span class="preview-label">${label}</span>
  </div>`;
}

function carPreviewHtml(src, isNew) {
  const label = isNew ? '선택된 새 사진' : '현재 사진 · 새 파일 선택 시 교체됩니다';
  return `<div class="preview-inline">
    <div class="preview-thumb-wrap">
      <img src="${src}" class="preview-thumb-34">
      <button type="button" class="preview-thumb-del" onclick="clearPhotoPreview('carImage','carImagePreview')">✕</button>
    </div>
    <span class="preview-label">${label}</span>
  </div>`;
}

function quizPreviewHtml(src) {
  return `<div class="preview-thumb-wrap" style="display:inline-block;margin-top:6px">
    <img src="${src}" class="preview-thumb-quiz">
    <button type="button" class="preview-thumb-del" onclick="clearPhotoPreview('quizPhoto','quizPhotoPreview')">✕</button>
  </div>`;
}

function clearPhotoPreview(inputId, previewId) {
  const el = document.getElementById(inputId);
  el._croppedData = null;
  el._deleted = true;
  document.getElementById(previewId).innerHTML = '';
}

function addGalleryPreview(dataUrl) {
  const preview = document.getElementById('galleryPhotoPreview');
  const wrap = document.createElement('div');
  wrap.className = 'preview-photo-wrap';
  wrap.innerHTML = `<img src="${dataUrl}" class="preview-photo"><button type="button" class="preview-photo-del" onclick="this.parentElement.remove()">✕</button>`;
  wrap.dataset.cropped = dataUrl;
  preview.appendChild(wrap);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function linkify(text) {
  return escapeHtml(text)
    .replace(/\n/g, '<br>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--primary-light);text-decoration:underline;word-break:break-all">$1</a>');
}

function toggleDesc(evId) {
  const el = document.getElementById(`desc-${evId}`);
  const btn = el.nextElementSibling;
  const isCollapsed = el.classList.contains('collapsed');
  el.classList.toggle('collapsed', !isCollapsed);
  btn.textContent = isCollapsed ? '접기 ▲' : '더 보기 ▼';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// 관리자이거나 본인이 만든 항목이면 수정/삭제 가능
function canEdit(item) {
  return state.currentUserRole === 'admin' || state.currentUserRole === 'superadmin' || item.createdBy === state.currentUserId;
}

function authErrMsg(code) {
  const map = {
    'auth/user-not-found': '존재하지 않는 이메일입니다.',
    'auth/wrong-password': '비밀번호가 틀렸습니다.',
    'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/too-many-requests': '너무 많은 시도입니다. 잠시 후 다시 시도해주세요.',
    'auth/blacklisted': '가입이 제한된 이메일입니다. 운영진에게 문의하세요.',
  };
  return map[code] || `오류가 발생했습니다. (${code || '알 수 없는 오류'})`;
}

/* ===== LOADING OVERLAY ===== */
function showLoading(msg = '데이터 불러오는 중...') {
  let el = document.getElementById('loadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.style.cssText = 'position:fixed;bottom:24px;right:24px;background:rgba(24,24,31,.95);border:1px solid #2e2e3a;border-radius:14px;display:flex;align-items:center;justify-content:center;z-index:999;color:#fff;gap:10px;font-size:.88rem;padding:12px 18px;pointer-events:none;';
    el.innerHTML = `<div style="width:40px;height:40px;border:3px solid rgba(108,99,255,.3);border-top-color:#6c63ff;border-radius:50%;animation:spin .8s linear infinite"></div><span id="loadingMsg">${msg}</span>`;
    document.head.insertAdjacentHTML('beforeend', '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>');
    document.body.appendChild(el);
  } else {
    document.getElementById('loadingMsg').textContent = msg;
    el.style.display = 'flex';
  }
}
function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) el.style.display = 'none';
}

/* ===== FIREBASE CONFIG 체크 ===== */
function isConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('여기에');
}

/* ===== THEME ===== */
function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const next = isLight ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem('theme', next);
}

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '☀️' : '🌙';
  // mobile menu button text
  document.querySelectorAll('.mobile-menu .nav-btn').forEach(b => {
    if (b.textContent.includes('테마')) b.textContent = (theme === 'light' ? '☀️' : '🌙') + ' 테마 변경';
  });
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  // iOS 자동 줌 방지: 포커스 시 maximum-scale=1, 해제 시 복원
  const metaVp = document.querySelector('meta[name=viewport]');
  if (metaVp) {
    const orig = metaVp.getAttribute('content');
    document.addEventListener('focusin', e => {
      if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) {
        metaVp.setAttribute('content', orig + ', maximum-scale=1');
      }
    });
    document.addEventListener('focusout', () => {
      metaVp.setAttribute('content', orig);
    });
  }

  // PWA 설치 프롬프트 캡처 (Android)
  window._deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window._deferredInstallPrompt = e;
  });

  // 저장된 테마 복원
  applyTheme(localStorage.getItem('theme') || 'dark');
  // Firebase config 미설정 시 안내
  if (!isConfigured()) {
    document.body.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f0f13;color:#f0f0f5;font-family:'Segoe UI',sans-serif;padding:24px">
        <div style="max-width:520px;text-align:center">
          <div style="font-size:3rem;margin-bottom:16px">🔧</div>
          <h2 style="margin-bottom:12px;color:#8b84ff">Firebase 설정이 필요합니다</h2>
          <p style="color:#9898b0;line-height:1.8;margin-bottom:20px">
            <code style="background:#22222c;padding:2px 8px;border-radius:6px">firebase-config.js</code> 파일에<br>
            Firebase 프로젝트 설정값을 붙여넣으세요.
          </p>
          <div style="background:#18181f;border:1px solid #2e2e3a;border-radius:12px;padding:20px;text-align:left;font-size:.86rem;color:#9898b0;line-height:2">
            1. <a href="https://console.firebase.google.com" target="_blank" style="color:#8b84ff">console.firebase.google.com</a> 접속<br>
            2. 프로젝트 만들기 → 웹앱 추가<br>
            3. 발급된 config를 firebase-config.js에 복사<br>
            4. Firestore Database 활성화 (테스트 모드)
          </div>
        </div>
      </div>`;
    return;
  }

  // ① 이벤트 바인딩 먼저 → UI 즉시 활성화
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      goPage(btn.dataset.page);
      document.getElementById('mobileMenu').classList.remove('open');
    });
  });

  document.getElementById('hamburger').addEventListener('click', () => {
    document.getElementById('mobileMenu').classList.toggle('open');
  });

  window.closeMobileMenu = () => document.getElementById('mobileMenu').classList.remove('open');

  // 메뉴 외부 클릭 시 닫기
  document.addEventListener('click', e => {
    const menu = document.getElementById('mobileMenu');
    const hamburger = document.getElementById('hamburger');
    if (menu.classList.contains('open') && !menu.contains(e.target) && !hamburger.contains(e.target)) {
      menu.classList.remove('open');
    }
  });

  document.getElementById('btnInstallGuide').addEventListener('click', async () => {
    document.getElementById('mobileMenu').classList.remove('open');
    // Android: beforeinstallprompt 캡처된 경우 즉시 설치 팝업
    if (window._deferredInstallPrompt) {
      const prompt = window._deferredInstallPrompt;
      prompt.prompt();
      const result = await prompt.userChoice;
      if (result.outcome === 'accepted') {
        window._deferredInstallPrompt = null;
        showToast('🎉 앱이 설치되었습니다!');
      }
      return;
    }
    // iOS 또는 이미 설치된 경우: 가이드 모달 표시
    setTimeout(() => {
      const modal = document.getElementById('installGuideModal');
      modal.style.display = '';
      modal.classList.add('open');
    }, 100);
  });

  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal || btn.closest('.modal-overlay')?.id));
  });
  // 폼 모달은 외부 클릭으로 닫히지 않음 (데이터 손실 방지)
  const formModals = new Set(['memberModal', 'eventModal', 'galleryFormModal', 'myAccountModal', 'inviteModal', 'noticeEditModal', 'anonEditModal', 'authModal']);
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    if (formModals.has(overlay.id)) return;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  });

  document.getElementById('btnAddMember').addEventListener('click', openAddMember);
  document.getElementById('memberForm').addEventListener('submit', saveMember);
  document.getElementById('memberRole').addEventListener('change', e => toggleCarSection(e.target.value));
  document.getElementById('memberImage').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    openCropModal(file, 1, dataUrl => {
      document.getElementById('memberImage')._croppedData = dataUrl;
      document.getElementById('memberImage')._deleted = false;
      document.getElementById('memberImagePreview').innerHTML = profilePreviewHtml(dataUrl, true);
    });
  });
  document.getElementById('carImage').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    openCropModal(file, 3/4, dataUrl => {
      document.getElementById('carImage')._croppedData = dataUrl;
      document.getElementById('carImage')._deleted = false;
      document.getElementById('carImagePreview').innerHTML = carPreviewHtml(dataUrl, true);
    });
  });

  document.querySelectorAll('#page-members .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-members .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.memberFilter = btn.dataset.filter;
      renderMembers();
    });
  });
  document.getElementById('memberSearch').addEventListener('input', e => {
    state.memberSearch = e.target.value;
    renderMembers();
  });

  document.getElementById('btnAddEvent').addEventListener('click', openAddEvent);
  document.getElementById('eventForm').addEventListener('submit', saveEvent);

  document.getElementById('btnAddGallery').addEventListener('click', openAddGallery);
  document.getElementById('galleryForm').addEventListener('submit', saveGallery);

  // 사진 미리보기
  document.getElementById('galleryPhotos').addEventListener('change', e => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    // 파일 큐에 넣고 하나씩 크롭
    _galleryQueue = files.slice(1);
    _galleryResults = [];
    openCropModal(files[0], 3/4, dataUrl => {
      _galleryResults.push(dataUrl);
      if (_galleryQueue.length > 0) {
        const next = _galleryQueue.shift();
        openCropModal(next, 3/4, dataUrl2 => {
          _galleryResults.push(dataUrl2);
          confirmGalleryQueue();
        });
      } else {
        confirmGalleryQueue();
      }
    });
  });

  // 키보드 라이트박스 이동
  document.addEventListener('keydown', e => {
    if (!document.getElementById('lightbox').classList.contains('active')) return;
    if (e.key === 'ArrowLeft') lightboxNav(-1);
    if (e.key === 'ArrowRight') lightboxNav(1);
    if (e.key === 'Escape') closeLightbox();
  });

  document.querySelectorAll('#page-events .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-events .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.eventFilter = btn.dataset.filter;
      renderEvents();
    });
  });

  // ② ~ ④ 구 로그인/회원가입 폼 이벤트 삭제됨 (authModal로 대체)

  // ⑤ 로그아웃
  document.getElementById('btnLogout').addEventListener('click', logout);
  document.getElementById('btnLogoutMobile').addEventListener('click', logout);

  // ⑥ 내 정보 수정
  document.getElementById('btnMyProfile').addEventListener('click', openMyProfile);
  document.getElementById('btnMyProfileMobile').addEventListener('click', openMyProfile);
  document.getElementById('myAccountForm').addEventListener('submit', saveMyAccount);

  // 비밀번호 확인 실시간 피드백
  ['accountPassword','accountPasswordConfirm'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const pw = document.getElementById('accountPassword').value;
      const cf = document.getElementById('accountPasswordConfirm').value;
      const msg = document.getElementById('passwordMatchMsg');
      if (!cf) { msg.style.display = 'none'; return; }
      msg.style.display = 'block';
      if (pw === cf) {
        msg.textContent = '✅ 비밀번호가 일치합니다.';
        msg.style.color = '#4ade80';
      } else {
        msg.textContent = '❌ 비밀번호가 일치하지 않습니다.';
        msg.style.color = 'var(--accent)';
      }
    });
  });

  // ⑥ 관리자: 계정 생성
  document.getElementById('btnInviteUser').addEventListener('click', () => openModal('inviteModal'));
  document.getElementById('inviteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('inviteError');
    errEl.textContent = '';
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = '생성 중...';
    try {
      await createAccount(
        document.getElementById('inviteName').value.trim(),
        document.getElementById('inviteEmail').value.trim(),
        document.getElementById('invitePassword').value,
        document.getElementById('inviteRole').value
      );
      closeModal('inviteModal');
      e.target.reset();
      renderAdmin();
      alert('계정이 생성되었습니다!');
    } catch (err) {
      errEl.textContent = authErrMsg(err.code) || err.message;
    } finally {
      btn.disabled = false; btn.textContent = '생성';
    }
  });

  // ⑦ Firebase 초기화 및 Auth 감지
  document.getElementById('dmInput').addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return; // 한글 IME 조합 중이면 무시
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDMMessage(); }
  });

  // 초기 URL로 페이지 복원 (pathname 또는 hash 호환)
  const path = location.pathname.slice(1) || location.hash.replace('#', '') || 'home';
  const validPages = ['home', 'members', 'cars', 'events', 'gallery', 'admin'];
  const initPage = validPages.includes(path) ? path : 'home';
  goPage(initPage, false);
  history.replaceState({ page: state.currentPage }, '', '/' + (state.currentPage === 'home' ? '' : state.currentPage));

  initFirebase();
  initAuth();

  // ⑧ Firestore 구독 및 seed는 showApp()에서 인증 완료 후 처리

  // PWA 서비스워커 등록
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});

