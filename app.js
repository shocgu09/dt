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
        const errEl = document.getElementById('loginError');
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
      showLoginScreen();
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
  document.getElementById('loginScreen').classList.add('hidden');
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
  state.auth.signOut();
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
  document.getElementById('loginScreen').classList.remove('hidden');
}

function applyRoleUI() {
  // 관리자만 회원/이벤트 추가·수정·삭제 가능
  // 렌더링 함수에서 isAdmin 체크하여 처리
}

async function login(email, password) {
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
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  if (!email || !password) {
    errEl.style.color = '';
    errEl.textContent = '이메일과 비밀번호를 입력 후 재전송 버튼을 눌러주세요.';
    return;
  }
  try {
    const cred = await state.auth.signInWithEmailAndPassword(email, password);
    if (cred.user.emailVerified) {
      errEl.style.color = '';
      errEl.textContent = '이미 인증된 계정입니다. 로그인을 진행해 주세요.';
      await state.auth.signOut();
      return;
    }
    await cred.user.sendEmailVerification();
    await state.auth.signOut();
    errEl.style.color = 'var(--driver)';
    errEl.textContent = '✅ 인증 메일을 재전송했습니다. 스팸함도 확인해 주세요.';
  } catch (e) {
    errEl.style.color = '';
    errEl.textContent = authErrMsg(e.code);
  }
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

// members 컬렉션의 프로필 이미지를 users 캐시에 동기화
function syncUserImages() {
  if (!state.users?.length || !state.members?.length) return;
  state.users.forEach(u => {
    const member = state.members.find(m => m.createdBy === u.uid);
    u.image = member?.image || null;
    u.gender = member?.gender || u.gender || 'male';
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
        ${isSuperAdmin ? `<input class="role-select" style="min-width:80px;text-align:center" value="${escapeHtml(u.title || '')}" placeholder="칭호 입력" onchange="updateUserTitle('${u.uid}', this.value.trim())" onkeydown="if(event.key==='Enter'){this.blur()}">` : (u.title ? titleBadge(u.title) : '')}
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
        ${u.uid !== state.currentUserId && u.role !== 'superadmin' ? `
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

  const newEl = document.getElementById('home-new-members');
  const newMem = [...members].slice(0, 4);
  newEl.innerHTML = newMem.length
    ? newMem.map(m => `
        <div class="home-list-item" onclick="openMemberDetail('${m.id}')">
          <span class="item-icon">${avatarSmall(m)}</span>
          <div class="item-info">
            <div class="item-title">${escapeHtml(displayName(m.name))} ${m.nickname ? `<small style="color:var(--text2)">(${escapeHtml(m.nickname)})</small>` : ''}</div>
            <div class="item-sub">${m.role === 'driver' ? '🚗 운전자' : '💺 동승자'} · ${m.joinDate}</div>
          </div>
        </div>`)
      .join('')
    : '<div class="empty-state">회원이 없습니다</div>';
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
      // 현재 열린 그룹 채팅의 타이틀(인원수) 실시간 갱신
      if (state._activeDMConvId) {
        const activeConv = state.dms.find(c => c.id === state._activeDMConvId);
        if (activeConv?.isGroup) {
          const count = activeConv.participants?.length || 0;
          document.getElementById('dmChatTitle').innerHTML = `👥 ${escapeHtml(activeConv.groupName || '그룹')} <span style="color:var(--primary-light);font-size:.8rem;cursor:pointer;text-decoration:underline" onclick="showGroupMembers()">${count}명</span>`;
        }
      }
    }, err => console.error('DM 구독 오류:', err));
}

function updateDMBadge() {
  const uid = state.currentUserId;
  const total = state.dms.reduce((sum, c) => sum + ((c.unread || {})[uid] || 0), 0);
  const label = total > 99 ? '99+' : total;
  ['dmUnreadBadge', 'dmUnreadBadgeMobile'].forEach(id => {
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
    const isGroup = conv.isGroup || false;
    const unread = (conv.unread || {})[uid] || 0;
    const lastMsg = conv.lastMessage || '';
    const lastAt = conv.lastAt ? (() => {
      const d = conv.lastAt.toDate ? conv.lastAt.toDate() : new Date(conv.lastAt);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      return isToday ? d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    })() : '';

    let avatarHtml, displayNameHtml, clickAction;
    if (isGroup) {
      // 그룹: 멀티 아바타 + 그룹명
      const others = conv.participants.filter(p => p !== uid).slice(0, 2).map(p => state.users.find(u => u.uid === p));
      avatarHtml = `<div class="dm-multi-avatar">
        <div>${avatarEl({ name: others[0]?.name || '?', image: others[0]?.image || null, gender: others[0]?.gender || 'male' })}</div>
        <div>${avatarEl({ name: others[1]?.name || '?', image: others[1]?.image || null, gender: others[1]?.gender || 'male' })}</div>
      </div>`;
      displayNameHtml = `${escapeHtml(conv.groupName || '그룹')}<span class="dm-group-badge">${conv.participants.length}명</span>`;
      clickAction = `event.stopPropagation();openGroupChat('${conv.id}')`;
    } else {
      // 1:1
      const otherUid = conv.participants.find(p => p !== uid);
      const other = state.users.find(u => u.uid === otherUid);
      const name = other?.name || '알 수 없음';
      avatarHtml = `<div class="mini-avatar dm-conv-avatar">${avatarEl({ name, image: other?.image || null, gender: other?.gender || 'male' })}</div>`;
      displayNameHtml = `${escapeHtml(name)}${titleBadge(other?.title)}`;
      clickAction = `event.stopPropagation();openDMChat('${otherUid}')`;
    }

    return `
      <div class="dm-conv-item" onclick="${clickAction}">
        ${avatarHtml}
        <div class="dm-conv-info">
          <div class="dm-conv-name">${displayNameHtml}</div>
          <div class="dm-conv-last">${escapeHtml(lastMsg.length > 28 ? lastMsg.slice(0, 28) + '…' : lastMsg)}</div>
        </div>
        <div class="dm-conv-meta">
          <div class="dm-conv-time">${lastAt}</div>
          ${unread > 0 ? `<div class="dm-unread-dot">${unread}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function openDMChat(otherUid) {
  try {
  const uid = state.currentUserId;
  if (!uid || otherUid === uid) return;

  // 기존 1:1 대화방 찾기: 정규 ID 또는 그룹에서 전환된 대화방
  const defaultConvId = [uid, otherUid].sort().join('_');
  const existingConv = state.dms.find(c => !c.isGroup && c.participants?.length === 2
    && c.participants.includes(uid) && c.participants.includes(otherUid));
  const convId = existingConv ? existingConv.id : defaultConvId;
  state._activeDMConvId = convId;
  state._activeDMOtherUid = otherUid;

  try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'DM_VIEWING', convId }); } catch(e) {}

  const other = state.users.find(function(u) { return u.uid === otherUid; });
  const name = (other && other.name) || '알 수 없음';
  document.getElementById('dmChatTitle').innerHTML = '💬 ' + escapeHtml(name) + titleBadge(other ? other.title : '');
  document.getElementById('dmMessages').innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:.84rem">로딩 중…</div>';

  var toolbar = document.getElementById('dmToolbar');
  if (toolbar) { toolbar.classList.remove('hidden'); }
  document.querySelectorAll('.dm-group-only').forEach(function(el) { el.classList.add('hidden'); });

  closeDMPanel();
  openModal('dmChatModal');

  // 비동기 작업은 별도로 (모달은 이미 열린 상태)
  _initDMChatAsync(convId, uid);

  } catch(e) { alert('DM 열기 오류: ' + e.message); }
}

async function _initDMChatAsync(convId, uid) {
  // 알림센터 알림 제거
  try {
    if ('serviceWorker' in navigator) {
      var reg = await navigator.serviceWorker.ready;
      var notifications = await reg.getNotifications({ tag: 'dm-' + convId });
      notifications.forEach(function(n) { n.close(); });
    }
  } catch(e) {}

  // 읽음 처리
  var convRef = state.db.collection('dms').doc(convId);
  try {
    var convSnap = await convRef.get();
    if (convSnap.exists) {
      await convRef.update({ ['unread.' + uid]: 0 });
      var localConv = state.dms.find(function(c) { return c.id === convId; });
      if (localConv && localConv.unread) localConv.unread[uid] = 0;
      updateDMBadge();
    } else {
      // 대화방이 아직 없음 (첫 DM) → 빈 메시지 화면 표시
      renderDMMessages([], uid);
      return;
    }
  } catch(e) {}

  // 메시지 구독
  if (state._dmMsgUnsub) state._dmMsgUnsub();
  state._dmMsgUnsub = state.db.collection('dms').doc(convId).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(function(snap) {
      renderDMMessages(snap.docs.map(function(d) { return { id: d.id, ...d.data() }; }), uid);
      var modal = document.getElementById('dmChatModal');
      if (modal && modal.classList.contains('open')) {
        state.db.collection('dms').doc(convId).update({ ['unread.' + uid]: 0 }).catch(function() {});
        var lc = state.dms.find(function(c) { return c.id === convId; });
        if (lc && lc.unread) lc.unread[uid] = 0;
        updateDMBadge();
      }
    }, function(err) { console.error('DM 메시지 구독 오류:', err); });
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
  // 툴바 숨기기
  var tb = document.getElementById('dmToolbar');
  if (tb) tb.classList.add('hidden');
  closeModal('dmChatModal');
}

/* ===== GROUP CHAT ===== */
function openCreateGroupModal() {
  const uid = state.currentUserId;
  const members = state.users.filter(u => u.uid !== uid);
  document.getElementById('groupNameInput').value = '';
  document.getElementById('groupMemberList').innerHTML = members.map(u => `
    <label class="group-member-item">
      <input type="checkbox" value="${u.uid}">
      <div class="mini-avatar">${avatarEl({ name: u.name, image: u.image || null, gender: u.gender || 'male' })}</div>
      <span class="group-member-item-name">${escapeHtml(u.name)}${titleBadge(u.title)}</span>
    </label>`).join('');
  closeDMPanel();
  openModal('groupCreateModal');
}

async function createGroupChat() {
  const uid = state.currentUserId;
  const checked = [...document.querySelectorAll('#groupMemberList input:checked')].map(el => el.value);
  if (checked.length < 1) { alert('멤버를 1명 이상 선택해주세요.'); return; }

  // 2명(나+1명)이면 1:1 DM으로 열기
  if (checked.length === 1) {
    closeModal('groupCreateModal');
    openDMChat(checked[0]);
    return;
  }

  const groupName = document.getElementById('groupNameInput').value.trim() || '그룹 대화';
  const participants = [uid, ...checked];
  const unread = {};
  participants.forEach(p => unread[p] = 0);

  const FieldValue = firebase.firestore.FieldValue;
  try {
    const ref = state.db.collection('dms').doc();
    await ref.set({
      participants,
      isGroup: true,
      groupName,
      createdBy: uid,
      lastMessage: '그룹이 생성되었습니다',
      lastAt: FieldValue.serverTimestamp(),
      unread
    });
    await ref.collection('messages').add({
      senderId: uid,
      text: `${state.users.find(u => u.uid === uid)?.name || ''}님이 그룹을 만들었습니다`,
      createdAt: FieldValue.serverTimestamp(),
      system: true
    });
    closeModal('groupCreateModal');
    openGroupChat(ref.id);
  } catch (e) {
    alert('그룹 생성 실패: ' + e.message);
  }
}

async function openGroupChat(convId) {
  const uid = state.currentUserId;
  state._activeDMConvId = convId;
  state._activeDMOtherUid = null;

  try { navigator.serviceWorker?.controller?.postMessage({ type: 'DM_VIEWING', convId }); } catch(e) {}

  const conv = state.dms.find(c => c.id === convId);
  const title = conv?.groupName || '그룹';
  const count = conv?.participants?.length || 0;
  document.getElementById('dmChatTitle').innerHTML = `👥 ${escapeHtml(title)} <span style="color:var(--primary-light);font-size:.8rem;cursor:pointer;text-decoration:underline" onclick="showGroupMembers()">${count}명</span>`;
  document.getElementById('dmMessages').innerHTML = '<div style="text-align:center;padding:24px;color:var(--text3);font-size:.84rem">로딩 중…</div>';

  // 그룹: 툴바 + 그룹 전용 버튼 모두 표시
  var gtb = document.getElementById('dmToolbar');
  if (gtb) gtb.classList.remove('hidden');
  document.querySelectorAll('.dm-group-only').forEach(function(el) { el.classList.remove('hidden'); });

  closeDMPanel();
  openModal('dmChatModal');

  // 알림 클리어
  try { if ('serviceWorker' in navigator) { navigator.serviceWorker.ready.then(reg => { reg.getNotifications({ tag: `dm-${convId}` }).then(ns => ns.forEach(n => n.close())); }); } } catch(e) {}

  // 읽음 처리
  const convRef = state.db.collection('dms').doc(convId);
  try {
    const snap = await convRef.get();
    if (snap.exists) {
      await convRef.update({ [`unread.${uid}`]: 0 });
      const local = state.dms.find(c => c.id === convId);
      if (local?.unread) local.unread[uid] = 0;
      updateDMBadge();
    }
  } catch(e) {}

  // 메시지 구독
  if (state._dmMsgUnsub) state._dmMsgUnsub();
  state._dmMsgUnsub = state.db.collection('dms').doc(convId).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snap => {
      renderDMMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })), uid);
      const modal = document.getElementById('dmChatModal');
      if (modal && modal.classList.contains('open')) {
        state.db.collection('dms').doc(convId).update({ [`unread.${uid}`]: 0 }).catch(() => {});
        const local = state.dms.find(c => c.id === convId);
        if (local?.unread) local.unread[uid] = 0;
        updateDMBadge();
      }
    }, err => console.error('그룹 메시지 구독 오류:', err));
}

function openInviteGroupModal() {
  const convId = state._activeDMConvId;
  const conv = state.dms.find(c => c.id === convId);
  if (!conv) return;

  const existing = new Set(conv.participants);
  const candidates = state.users.filter(u => !existing.has(u.uid));
  if (!candidates.length) { alert('초대할 수 있는 멤버가 없습니다.'); return; }

  document.getElementById('groupInviteMemberList').innerHTML = candidates.map(u => `
    <label class="group-member-item">
      <input type="checkbox" value="${u.uid}">
      <div class="mini-avatar">${avatarEl({ name: u.name, image: u.image || null, gender: u.gender || 'male' })}</div>
      <span class="group-member-item-name">${escapeHtml(u.name)}${titleBadge(u.title)}</span>
    </label>`).join('');
  openModal('groupInviteModal');
}

async function inviteToGroup() {
  const convId = state._activeDMConvId;
  if (!convId) return;
  const checked = [...document.querySelectorAll('#groupInviteMemberList input:checked')].map(el => el.value);
  if (!checked.length) { alert('초대할 멤버를 선택해주세요.'); return; }

  const uid = state.currentUserId;
  const FieldValue = firebase.firestore.FieldValue;
  const convRef = state.db.collection('dms').doc(convId);
  try {
    const updates = {
      participants: FieldValue.arrayUnion(...checked),
      isGroup: true
    };
    checked.forEach(u => updates[`unread.${u}`] = 0);

    // 그룹명이 없으면 자동 설정
    const snap = await convRef.get();
    if (snap.exists && !snap.data().groupName) {
      updates.groupName = '그룹 대화';
    }

    await convRef.update(updates);

    const myName = state.users.find(u => u.uid === uid)?.name || '';
    const invitedNames = checked.map(u => state.users.find(x => x.uid === u)?.name || '').join(', ');
    await convRef.collection('messages').add({
      senderId: uid,
      text: `${myName}님이 ${invitedNames}님을 초대했습니다`,
      createdAt: FieldValue.serverTimestamp(),
      system: true
    });

    closeModal('groupInviteModal');

    // 1:1에서 그룹으로 전환된 경우 그룹 채팅 UI로 다시 열기
    if (!snap.data()?.isGroup) {
      closeDMChat();
      openGroupChat(convId);
    }
    // 타이틀 갱신은 initDMs의 onSnapshot 콜백에서 자동 처리됨
  } catch (e) {
    alert('초대 실패: ' + e.message);
  }
}

function showGroupMembers() {
  const convId = state._activeDMConvId;
  const conv = state.dms.find(c => c.id === convId);
  if (!conv) return;
  const uid = state.currentUserId;
  document.getElementById('groupMembersTitle').textContent = `참여자 ${conv.participants.length}명`;
  document.getElementById('groupMembersBody').innerHTML = conv.participants.map(pUid => {
    const u = state.users.find(x => x.uid === pUid);
    const name = u?.name || '알 수 없음';
    const isMe = pUid === uid;
    return `<div class="group-member-row">
      <div class="mini-avatar" style="width:36px;height:36px;flex-shrink:0">${avatarEl({ name, image: u?.image || null, gender: u?.gender || 'male' })}</div>
      <div style="flex:1;min-width:0">
        <span style="font-size:.9rem;font-weight:600">${escapeHtml(name)}</span>${titleBadge(u?.title)}${isMe ? '<span style="color:var(--primary-light);font-size:.75rem;margin-left:4px">나</span>' : ''}
      </div>
    </div>`;
  }).join('');
  openModal('groupMembersModal');
}

function renameGroup() {
  const convId = state._activeDMConvId;
  const conv = state.dms.find(c => c.id === convId);
  if (!conv) return;
  const input = document.getElementById('groupRenameInput');
  input.value = conv.groupName || '';
  openModal('groupRenameModal');
  setTimeout(() => input.focus(), 100);
}

async function submitRenameGroup() {
  const convId = state._activeDMConvId;
  const conv = state.dms.find(c => c.id === convId);
  if (!conv) return;
  const newName = document.getElementById('groupRenameInput').value.trim();
  if (!newName) { alert('그룹 이름을 입력해주세요.'); return; }
  try {
    await state.db.collection('dms').doc(convId).update({ groupName: newName });
    closeModal('groupRenameModal');
  } catch (e) {
    alert('이름 변경 실패: ' + e.message);
  }
}

async function leaveDM() {
  const convId = state._activeDMConvId;
  if (!convId) return;
  const conv = state.dms.find(c => c.id === convId);
  const isGroup = conv?.isGroup || false;

  const msg = isGroup ? '이 그룹을 나가시겠습니까?' : '대화방을 나가시겠습니까?\n모든 대화 내용이 삭제됩니다.';
  if (!confirm(msg)) return;

  const uid = state.currentUserId;
  const FieldValue = firebase.firestore.FieldValue;
  const convRef = state.db.collection('dms').doc(convId);
  try {
    // 메시지 구독 해제 (participants 제거 후 권한 에러 방지)
    if (state._dmMsgUnsub) { state._dmMsgUnsub(); state._dmMsgUnsub = null; }

    if (!isGroup) {
      // 1:1 채팅: 대화방 및 모든 메시지 삭제
      await deleteConversation(convId);
    } else {
      // 그룹 채팅: participants 수에 따라 처리
      const convSnap = await convRef.get();
      const currentParticipants = convSnap.data()?.participants || [];

      // 시스템 메시지를 먼저 기록 (participants에서 제거 전이어야 권한이 있음)
      const myName = state.users.find(u => u.uid === uid)?.name || '';
      await convRef.collection('messages').add({
        senderId: uid,
        text: `${myName}님이 나갔습니다`,
        createdAt: FieldValue.serverTimestamp(),
        system: true
      });
      // participants에서 자신 제거
      const updateData = {
        participants: FieldValue.arrayRemove(uid),
        [`unread.${uid}`]: FieldValue.delete()
      };
      // 나간 후 2명 남으면 1:1 DM으로 자동 전환
      if (currentParticipants.length === 3) {
        updateData.isGroup = false;
        updateData.groupName = FieldValue.delete();
      }
      await convRef.update(updateData);
    }
    closeDMChat();
  } catch (e) {
    alert('나가기 실패: ' + e.message);
  }
}

async function deleteConversation(convId) {
  const convRef = state.db.collection('dms').doc(convId);
  // 서브컬렉션(messages) 일괄 삭제 (batch 500개 제한 대응)
  const msgSnap = await convRef.collection('messages').get();
  const docs = msgSnap.docs;
  for (let i = 0; i < docs.length; i += 499) {
    const batch = state.db.batch();
    docs.slice(i, i + 499).forEach(doc => batch.delete(doc.ref));
    if (i + 499 >= docs.length) batch.delete(convRef); // 마지막 batch에서 대화방 문서도 삭제
    await batch.commit();
  }
  if (docs.length === 0) await convRef.delete(); // 메시지가 없는 경우
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
  const conv = state.dms.find(c => c.id === state._activeDMConvId);
  const isGroup = conv?.isGroup || false;
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

    // 시스템 메시지 (그룹 생성, 초대, 나가기)
    if (msg.system) {
      html += `<div class="dm-date-sep" style="font-size:.78rem">${escapeHtml(msg.text)}</div>`;
      return;
    }

    // 그룹 채팅: 상대방 메시지에 발신자 이름 표시
    let senderLabel = '';
    if (isGroup && !isMe) {
      const sender = state.users.find(u => u.uid === msg.senderId);
      senderLabel = `<div class="dm-msg-sender">${escapeHtml(sender?.name || '알 수 없음')}</div>`;
    }

    let content = '';
    if (msg.image) {
      content = `<div class="dm-bubble dm-bubble-img"><img src="${msg.image}" alt="사진" onclick="openLightbox('${msg.image}')"></div>`;
      if (msg.text) content += `<div class="dm-bubble">${escapeHtml(msg.text)}</div>`;
    } else if (isSingleEmoji(msg.text)) {
      content = `<div class="dm-emoji-big">${msg.text}</div>`;
    } else {
      content = `<div class="dm-bubble">${escapeHtml(msg.text)}</div>`;
    }

    html += `<div class="dm-msg ${isMe ? 'dm-msg-me' : 'dm-msg-other'}">
      ${senderLabel}${content}
      <div class="dm-time">${time}</div>
    </div>`;
  });
  container.innerHTML = html;
  // 이미지 로드 완료 후 스크롤 (이미지가 있으면 로드 대기)
  const images = container.querySelectorAll('img');
  if (images.length) {
    let loaded = 0;
    const onLoad = () => { if (++loaded >= images.length) container.scrollTop = container.scrollHeight; };
    images.forEach(img => {
      if (img.complete) onLoad();
      else { img.addEventListener('load', onLoad); img.addEventListener('error', onLoad); }
    });
  }
  container.scrollTop = container.scrollHeight;
}

function handleDMImage(fileInput) {
  const file = fileInput.files[0];
  if (!file) return;
  fileInput.value = '';
  // 이미지 리사이즈 후 base64 변환
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxSize = 600;
      let w = img.width, h = img.height;
      if (w > maxSize || h > maxSize) {
        if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
        else { w = Math.round(w * maxSize / h); h = maxSize; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      sendDMMessage(dataUrl);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function sendDMMessage(imageDataUrl) {
  const input = document.getElementById('dmInput');
  const text = input.value.trim();
  if (!text && !imageDataUrl) return;
  const convId = state._activeDMConvId;
  const uid = state.currentUserId;
  if (!convId || !uid) return;

  const conv = state.dms.find(c => c.id === convId);
  const isGroup = conv?.isGroup || false;
  const otherUid = state._activeDMOtherUid; // 1:1에서만 사용

  if (!isGroup && !otherUid) return;

  input.value = '';
  const FieldValue = firebase.firestore.FieldValue;
  const convRef = state.db.collection('dms').doc(convId);

  // 그룹이면 발신자 이름 접두사 추가
  const myName = state.users.find(u => u.uid === uid)?.name || '';
  const rawMsg = imageDataUrl ? '📷 사진' : text;
  const lastMsg = isGroup ? `${myName}: ${rawMsg}` : rawMsg;

  try {
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      // 1:1 새 대화방 생성
      await convRef.set({
        participants: [uid, otherUid],
        lastMessage: lastMsg,
        lastAt: FieldValue.serverTimestamp(),
        unread: { [uid]: 0, [otherUid]: 1 }
      });
      // 대화방 생성 후 메시지 구독 시작
      if (state._dmMsgUnsub) state._dmMsgUnsub();
      state._dmMsgUnsub = convRef.collection('messages')
        .orderBy('createdAt', 'asc')
        .onSnapshot(function(snap) {
          renderDMMessages(snap.docs.map(function(d) { return { id: d.id, ...d.data() }; }), uid);
          var modal = document.getElementById('dmChatModal');
          if (modal && modal.classList.contains('open')) {
            convRef.update({ ['unread.' + uid]: 0 }).catch(function() {});
            var lc = state.dms.find(function(c) { return c.id === convId; });
            if (lc && lc.unread) lc.unread[uid] = 0;
            updateDMBadge();
          }
        }, function(err) { console.error('DM 메시지 구독 오류:', err); });
    } else {
      // 기존 대화방 업데이트 (1:1 또는 그룹)
      const updates = {
        lastMessage: lastMsg,
        lastAt: FieldValue.serverTimestamp(),
        [`unread.${uid}`]: 0
      };
      if (isGroup) {
        // 그룹: 본인 외 모든 참여자 unread +1
        conv.participants.filter(p => p !== uid).forEach(p => {
          updates[`unread.${p}`] = FieldValue.increment(1);
        });
      } else {
        updates[`unread.${otherUid}`] = FieldValue.increment(1);
      }
      await convRef.update(updates);
    }
    const msgData = {
      senderId: uid,
      text: text || '',
      createdAt: FieldValue.serverTimestamp()
    };
    if (imageDataUrl) msgData.image = imageDataUrl;
    await convRef.collection('messages').add(msgData);

    // 푸시 알림: 그룹이면 모든 참여자에게, 1:1이면 상대에게
    const recipients = isGroup
      ? conv.participants.filter(p => p !== uid)
      : [otherUid];
    recipients.forEach(recipientUid => {
      triggerPushNotification(recipientUid, lastMsg, convId).catch(() => {});
    });
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

/* ===== IMAGE 압축 (base64 → Firestore 직접 저장) ===== */
function getExifOrientation(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const view = new DataView(e.target.result);
      if (view.getUint16(0, false) !== 0xFFD8) return resolve(1);
      let offset = 2;
      while (offset < view.byteLength) {
        const marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xFFE1) {
          if (view.getUint32(offset += 2, false) !== 0x45786966) return resolve(1);
          const little = view.getUint16(offset += 6, false) === 0x4949;
          offset += view.getUint32(offset + 4, little);
          const tags = view.getUint16(offset, little);
          offset += 2;
          for (let i = 0; i < tags; i++) {
            if (view.getUint16(offset + i * 12, little) === 0x0112) {
              return resolve(view.getUint16(offset + i * 12 + 8, little));
            }
          }
        } else if ((marker & 0xFF00) !== 0xFF00) break;
        else offset += view.getUint16(offset, false);
      }
      resolve(1);
    };
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

function compressImage(file, maxSize, quality) {
  return new Promise(async resolve => {
    const orientation = await getExifOrientation(file);
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        // 회전이 필요한 orientation (5,6,7,8)은 width/height 교환
        const rotated = orientation >= 5 && orientation <= 8;
        let dw = width, dh = height;
        if (width > maxSize || height > maxSize) {
          if (width > height) { dh = dh * maxSize / dw; dw = maxSize; }
          else { dw = dw * maxSize / dh; dh = maxSize; }
        }
        canvas.width = rotated ? dh : dw;
        canvas.height = rotated ? dw : dh;
        const ctx = canvas.getContext('2d');
        // EXIF orientation에 따라 변환
        if (orientation === 2) { ctx.transform(-1, 0, 0, 1, dw, 0); }
        else if (orientation === 3) { ctx.transform(-1, 0, 0, -1, dw, dh); }
        else if (orientation === 4) { ctx.transform(1, 0, 0, -1, 0, dh); }
        else if (orientation === 5) { ctx.transform(0, 1, 1, 0, 0, 0); }
        else if (orientation === 6) { ctx.transform(0, 1, -1, 0, dh, 0); }
        else if (orientation === 7) { ctx.transform(0, -1, -1, 0, dh, dw); }
        else if (orientation === 8) { ctx.transform(0, -1, 1, 0, 0, dw); }
        ctx.drawImage(img, 0, 0, dw, dh);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ===== HELPERS ===== */
function avatarEl(m) {
  const colors = ['#6c63ff', '#ff6b6b', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];
  const color = colors[(m.name?.charCodeAt(0) || 0) % colors.length];
  if (m.image) return `<img src="${m.image}" alt="${escapeHtml(displayName(m.name))}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  return `<span style="background:${color};color:#fff;width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:inherit;font-weight:700">${escapeHtml(m.name?.[0] || '?')}</span>`;
}

function avatarSmall(m) {
  const colors = ['#6c63ff', '#ff6b6b', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];
  const color = colors[(m.name?.charCodeAt(0) || 0) % colors.length];
  if (m.image) return `<img src="${m.image}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`;
  return `<span style="background:${color};color:#fff;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0">${escapeHtml(m.name?.[0] || '?')}</span>`;
}

/* ===== CROP ===== */
let _cropperInstance = null;
let _cropCallback = null;
let _galleryQueue = [];
let _galleryResults = [];

function openCropModal(file, aspectRatio, callback) {
  _cropCallback = callback;
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById('cropImage');
    img.src = e.target.result;
    const overlay = document.getElementById('cropModal');
    overlay.style.display = 'flex';
    if (_cropperInstance) { _cropperInstance.destroy(); _cropperInstance = null; }
    img.onload = () => {
      _cropperInstance = new Cropper(img, {
        aspectRatio: aspectRatio ?? NaN,
        viewMode: 1,
        autoCropArea: 1,       // 크롭 박스가 뷰 전체를 채움
        dragMode: 'move',      // 드래그 시 이미지 이동
        cropBoxMovable: false, // 크롭 박스 고정
        cropBoxResizable: false, // 크롭 박스 크기 고정
        movable: true,         // 이미지 이동 가능
        zoomable: true,        // 핀치/휠 줌 가능
        rotatable: false,
        toggleDragModeOnDblclick: false,
      });
    };
  };
  reader.readAsDataURL(file);
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
  return map[code] || `오류가 발생했습니다. (${code})`;
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
  const formModals = new Set(['memberModal', 'eventModal', 'galleryFormModal', 'myAccountModal', 'inviteModal', 'noticeEditModal', 'dmChatModal', 'groupRenameModal']);
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

  // ② 로그인/회원가입 탭 전환
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isLogin = tab.dataset.tab === 'login';
      document.getElementById('loginForm').classList.toggle('hidden', !isLogin);
      document.getElementById('signupForm').classList.toggle('hidden', isLogin);
    });
  });

  // ③ 로그인 폼
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    try {
      await login(
        document.getElementById('loginEmail').value.trim(),
        document.getElementById('loginPassword').value
      );
      // onAuthStateChanged에서 미인증 시 자동 로그아웃되므로 여기서 별도 처리
      // emailVerified 체크는 onAuthStateChanged에서 수행
    } catch (err) {
      errEl.textContent = authErrMsg(err.code);
    }
  });

  // ④ 회원가입 폼
  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('signupError');
    errEl.textContent = '';
    const pw = document.getElementById('signupPassword').value;
    const pw2 = document.getElementById('signupPasswordConfirm').value;
    if (pw !== pw2) { errEl.textContent = '비밀번호가 일치하지 않습니다.'; return; }
    try {
      await signup(
        document.getElementById('signupName').value.trim(),
        document.getElementById('signupEmail').value.trim(),
        pw
      );
      // 가입 성공 → 인증 메일 안내
      document.getElementById('signupForm').reset();
      errEl.style.color = 'var(--driver)';
      errEl.textContent = '✅ 인증 메일을 발송했습니다. 이메일을 확인 후 로그인해 주세요.';
    } catch (err) {
      errEl.style.color = '';
      errEl.textContent = authErrMsg(err.code);
    }
  });

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

