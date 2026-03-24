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
  currentUserRole: null, // 'admin' | 'member'
  currentUserId: null,   // Firestore users 문서 ID (= auth uid)
  memberFilter: 'all',
  memberSearch: '',
  eventFilter: 'all',
};

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
        // 삭제 대기 계정 → 본인 Auth 계정 완전 삭제 후 로그아웃
        if (data.pendingDelete) {
          try {
            await state.db.collection('users').doc(user.uid).delete();
            await user.delete(); // Firebase Auth에서도 완전 삭제
          } catch (e) {
            // 세션 만료 등으로 삭제 실패 시 비활성화 유지
          }
          await state.auth.signOut();
          alert('삭제된 계정입니다.');
          return;
        }
        // 비활성화된 계정 → 강제 로그아웃
        if (data.disabled) {
          await state.auth.signOut();
          alert('접근이 차단된 계정입니다. 운영진에게 문의하세요.');
          return;
        }
        state.currentUserRole = data.role;
      } else {
        // 그래도 없으면 member로 폴백 생성
        await state.db.collection('users').doc(user.uid).set({
          name: user.displayName || user.email,
          email: user.email,
          role: 'member',
          createdAt: new Date().toISOString().slice(0, 10),
        });
        state.currentUserRole = 'member';
      }
      showApp();
    } else {
      state.currentUser = null;
      state.currentUserRole = null;
      state.currentUserId = null;
      state.subscribed = false;
      showLoginScreen();
    }
  });
}

function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  // 네비바 사용자 정보 표시
  const userDoc = state.db.collection('users').doc(state.currentUserId);
  userDoc.get().then(doc => {
    const name = doc.exists ? doc.data().name : state.currentUser.email;
    document.getElementById('navUserName').textContent = name;
  });
  // 관리자 전용 UI
  const isAdmin = state.currentUserRole === 'admin';
  document.querySelectorAll('.admin-only').forEach(el => {
    el.classList.toggle('hidden', !isAdmin);
  });
  document.getElementById('navAdminBadge').classList.toggle('hidden', !isAdmin);
  applyRoleUI();
  // 인증 완료 후 Firestore 구독 시작 (최초 1회만)
  if (!state.subscribed) {
    state.subscribed = true;
    subscribeAll();
    // 회원 프로필 미등록 시 안내 토스트
    state.db.collection('members').where('createdBy', '==', state.currentUserId).limit(1).get().then(snap => {
      if (snap.empty) showToast('👋 환영합니다! 회원 탭에서 프로필을 등록해주세요.', 6000);
    });
  }
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
    // 1. pendingDelete 마킹
    await state.db.collection('users').doc(uid).set(
      { pendingDelete: true, disabled: true },
      { merge: true }
    );
    // 2. 내 회원 프로필 삭제 (members 컬렉션)
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
      const votes = doc.data().votes || {};
      const inVotes = [...(votes.attending || []), ...(votes.maybe || []), ...(votes.absent || [])].includes(uid);
      if (inVotes) {
        voteBatch.update(doc.ref, {
          'votes.attending': FieldValue.arrayRemove(uid),
          'votes.maybe': FieldValue.arrayRemove(uid),
          'votes.absent': FieldValue.arrayRemove(uid),
        });
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
  try {
    await state.db.collection('users').doc(uid).update({ role });
    renderAdmin();
  } catch (e) {
    alert('역할 변경 실패: ' + e.message);
  }
}

async function deleteUserAccount(uid) {
  if (!confirm('정말 탈퇴 처리하시겠습니까?\n해당 계정과 관련된 모든 데이터가 삭제됩니다.')) return;
  try {
    const FieldValue = firebase.firestore.FieldValue;

    // 1. 회원 프로필 삭제 (members 컬렉션)
    const myMembers = await state.db.collection('members').where('createdBy', '==', uid).get();
    for (const doc of myMembers.docs) await doc.ref.delete();

    // 2. 이벤트 투표에서 uid 제거
    const allEvents = await state.db.collection('events').get();
    const voteBatch = state.db.batch();
    allEvents.docs.forEach(doc => {
      const votes = doc.data().votes || {};
      const inVotes = [...(votes.attending || []), ...(votes.maybe || []), ...(votes.absent || [])].includes(uid);
      if (inVotes) {
        voteBatch.update(doc.ref, {
          'votes.attending': FieldValue.arrayRemove(uid),
          'votes.maybe': FieldValue.arrayRemove(uid),
          'votes.absent': FieldValue.arrayRemove(uid),
        });
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

    // 6. users 문서 삭제 (pendingDelete로 마킹 → 다음 로그인 시 Auth도 삭제)
    await state.db.collection('users').doc(uid).update({ pendingDelete: true, disabled: true });

    alert('탈퇴 처리가 완료됐습니다.');
    renderAdmin();
  } catch (e) {
    alert('오류: ' + e.message);
  }
}

async function restoreUserAccount(uid) {
  if (!confirm('이 계정을 복구할까요?')) return;
  try {
    await state.db.collection('users').doc(uid).update({ disabled: false, pendingDelete: false });
    renderAdmin();
  } catch (e) {
    alert('복구 실패: ' + e.message);
  }
}

/* ===== REALTIME LISTENERS ===== */
function subscribeAll() {
  state.db.collection('members').orderBy('joinDate', 'desc').onSnapshot(snap => {
    state.members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  if (pushState) history.pushState({ page: name }, '', '#' + name);
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

/* ===== ADMIN PAGE ===== */
async function renderAdmin() {
  if (state.currentUserRole !== 'admin') return;
  const snap = await state.db.collection('users').orderBy('createdAt', 'asc').get();
  const users = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  const list = document.getElementById('userList');
  if (!users.length) {
    list.innerHTML = '<div class="empty-state">등록된 계정이 없습니다</div>';
    return;
  }
  list.innerHTML = users.map(u => `
    <div class="user-item" style="${u.disabled ? 'opacity:.5' : ''}">
      <div class="user-item-info">
        <div class="user-item-name">
          ${u.name}
          ${u.uid === state.currentUserId ? '<span style="color:var(--primary-light);font-size:.76rem">(나)</span>' : ''}
          ${u.pendingDelete ? '<span style="color:var(--accent);font-size:.76rem">삭제 예정</span>' : u.disabled ? '<span style="color:var(--accent);font-size:.76rem">비활성화</span>' : ''}
        </div>
        <div class="user-item-email">${u.email}</div>
      </div>
      <div class="user-item-actions">
        ${!u.disabled ? `
          <select class="role-select" onchange="updateUserRole('${u.uid}', this.value)" ${u.uid === state.currentUserId ? 'disabled' : ''}>
            <option value="member" ${u.role === 'member' ? 'selected' : ''}>일반 회원</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자</option>
          </select>` : ''}
        ${u.uid !== state.currentUserId ? `
          <button class="btn btn-sm ${u.disabled ? 'btn-success' : 'btn-danger'}"
            onclick="${u.disabled ? `restoreUserAccount('${u.uid}')` : `deleteUserAccount('${u.uid}')`}">
            ${u.disabled ? '복구' : '비활성화'}
          </button>` : ''}
      </div>
    </div>`).join('');
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
            <div class="item-title">${ev.title}</div>
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
            <div class="item-title">${m.name} ${m.nickname ? `<small style="color:var(--text2)">(${m.nickname})</small>` : ''}</div>
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
          <div class="member-name">${m.name}${m.createdBy === state.currentUserId ? ' <span style="color:var(--primary-light);font-size:.75rem;font-weight:600">나</span>' : ''}</div>
          <div class="member-nick">${m.nickname || '-'}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">
            <span class="role-badge ${m.role}">${m.role === 'driver' ? '🚗 운전자' : '💺 동승자'}</span>
            <span class="gender-badge ${m.gender || 'male'}">${m.gender === 'female' ? '♀ 여' : '♂ 남'}</span>
          </div>
        </div>
      </div>
      <div class="member-card-body">
        <div class="member-bio">${m.bio || '소개 없음'}</div>
        ${m.car ? `<div class="member-car-tag">${brandLogoHtml(m.car.brand, 18)} ${m.car.brand} ${m.car.model}</div>` : ''}
      </div>
      <div class="member-card-footer">
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openMemberDetail('${m.id}')">상세보기</button>
        ${canEdit(m) ? `
          <button class="btn btn-sm btn-outline" onclick="event.stopPropagation();openEditMember('${m.id}')">수정</button>
          <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="event.stopPropagation();deleteMember('${m.id}')">삭제</button>
        ` : ''}
      </div>
    </div>`).join('');
}

function openMemberDetail(id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  document.getElementById('detailModalTitle').textContent = `${m.name} 회원 정보`;
  document.getElementById('memberDetailBody').innerHTML = `
    <div class="detail-hero">
      <div class="detail-avatar">${avatarEl(m)}</div>
      <div class="detail-info-main">
        <h2>${m.name}</h2>
        <div class="nick">${m.nickname ? `"${m.nickname}"` : ''}</div>
        <div class="detail-meta">
          <span class="role-badge ${m.role}">${m.role === 'driver' ? '🚗 운전자' : '💺 동승자'}</span>
          <span class="gender-badge ${m.gender || 'male'}">${m.gender === 'female' ? '♀ 여' : '♂ 남'}</span>
        </div>
        <div style="font-size:.88rem;color:var(--text2)">${m.bio || ''}</div>
      </div>
    </div>
    <div class="info-grid">
      <div class="info-item"><div class="info-label">연락처</div><div class="info-value">${m.phone ? m.phone.slice(0, -4) + '****' : '-'}</div></div>
      <div class="info-item"><div class="info-label">가입일</div><div class="info-value">${m.joinDate || '-'}</div></div>
    </div>
    ${m.car ? `
      <div class="detail-section">
        <h4>내 차</h4>
        <div class="detail-car">
          <div class="detail-car-img">${m.car.image ? `<img src="${m.car.image}" alt="차량">` : '🚗'}</div>
          <div class="detail-car-info">
            <div class="detail-car-name">${m.car.brand} ${m.car.model}</div>
            <div class="detail-car-sub">${m.car.year || ''} · ${m.car.color || ''}</div>
            <div class="detail-car-desc">${m.car.desc || ''}</div>
          </div>
        </div>
      </div>` : ''}
    ${canEdit(m) ? `
    <div class="detail-actions">
      <button class="btn btn-outline" onclick="openEditMember('${m.id}');closeModal('memberDetailModal')">수정</button>
      <button class="btn btn-danger" onclick="deleteMember('${m.id}');closeModal('memberDetailModal')">삭제</button>
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
  const preview = document.getElementById('memberImagePreview');
  if (m.image) {
    preview.innerHTML = `<img src="${m.image}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--border)"><span style="font-size:.78rem;color:var(--text3);margin-left:8px;vertical-align:middle">현재 사진 · 새 파일 선택 시 교체됩니다</span>`;
  } else {
    preview.innerHTML = '';
  }
  const carPreview = document.getElementById('carImagePreview');
  if (m.car?.image) {
    carPreview.innerHTML = `<img src="${m.car.image}" style="width:80px;height:56px;border-radius:8px;object-fit:cover;border:2px solid var(--border)"><span style="font-size:.78rem;color:var(--text3);margin-left:8px;vertical-align:middle">현재 사진 · 새 파일 선택 시 교체됩니다</span>`;
  } else {
    carPreview.innerHTML = '';
  }
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

    const memberImageFile = document.getElementById('memberImage').files[0];
    const carImageFile = document.getElementById('carImage').files[0];

    let memberImg = existing?.image || null;
    let carImg = existing?.car?.image || null;

    // 이미지 압축 후 base64로 Firestore에 저장 (Storage 불필요)
    if (memberImageFile) memberImg = await compressImage(memberImageFile, 600, 0.7);
    if (carImageFile) carImg = await compressImage(carImageFile, 800, 0.75);

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
  const isAdmin = state.currentUserRole === 'admin';
  const btn = document.getElementById('btnAddGallery');
  if (btn) btn.classList.toggle('hidden', !isAdmin);

  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  if (!state.gallery.length) {
    grid.innerHTML = '<div class="empty-state" style="text-align:center;padding:60px;grid-column:1/-1">등록된 활동이 없습니다.</div>';
    return;
  }
  grid.innerHTML = state.gallery.map(g => `
    <div class="gallery-card" onclick="openGalleryDetail('${g.id}')">
      <div class="gallery-card-img">
        ${g.photo ? `<img src="${g.photo}" alt="${g.title}">` : '<div class="gallery-no-img">📷</div>'}
      </div>
      <div class="gallery-card-body">
        <div class="gallery-card-title">${g.title}</div>
        <div class="gallery-card-date">${formatDate(g.date)}</div>
        ${g.desc ? `<div class="gallery-card-desc">${linkify(g.desc)}</div>` : ''}
      </div>
    </div>`).join('');
}

function openGalleryDetail(id) {
  const g = state.gallery.find(x => x.id === id);
  if (!g) return;
  const isAdmin = state.currentUserRole === 'admin';
  currentGalleryId = id;

  document.getElementById('galleryDetailTitle').textContent = g.title;
  document.getElementById('galleryDetailMeta').textContent = `📅 ${formatDate(g.date)}`;
  document.getElementById('galleryDetailDesc').innerHTML = linkify(g.desc || '');
  document.getElementById('galleryDetailPhoto').innerHTML = g.photo
    ? `<img src="${g.photo}" style="width:100%;max-height:340px;object-fit:cover;border-radius:12px;cursor:zoom-in" onclick="openLightbox('${g.photo}')">`
    : '';
  document.getElementById('commentInput').value = '';

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
  const isAdmin = state.currentUserRole === 'admin';
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
        <span class="comment-author">${c.authorName}</span>
        <span class="comment-time">${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('ko') : ''}</span>
        ${(c.authorUid === uid || isAdmin) ? `<button class="comment-del" onclick="deleteComment('${galleryId}','${c.id}')">✕</button>` : ''}
      </div>
      <div class="comment-text">${c.text}</div>
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
    const file = document.getElementById('galleryPhotos').files[0];
    let photo = existing?.photo || null;
    if (file) photo = await compressImage(file, 1200, 0.75);
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
      <div class="car-card-img">${m.car.image ? `<img src="${m.car.image}" alt="${m.car.model}">` : '🚗'}</div>
      <div class="car-card-body">
        <div class="car-name" style="display:flex;align-items:center;gap:6px">${brandLogoHtml(m.car.brand, 20)} ${m.car.brand} ${m.car.model}</div>
        <div class="car-year-color">${m.car.year || ''} ${m.car.year && m.car.color ? '·' : ''} ${m.car.color || ''}</div>
        <div class="car-desc">${m.car.desc || '설명 없음'}</div>
        <div class="car-owner">
          <div class="car-owner-avatar">${avatarEl(m)}</div>
          <div>
            <div class="car-owner-name">${m.name}</div>
            <div style="font-size:.76rem;color:var(--text3)">오너</div>
          </div>
        </div>
      </div>
    </div>`).join('');
}

/* ===== EVENTS ===== */
function renderEvents() {
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
          <div class="event-title">${ev.title}</div>
          ${isPast ? '<span style="font-size:.78rem;color:var(--text3);background:var(--bg3);padding:3px 10px;border-radius:10px;white-space:nowrap">종료됨</span>' : ''}
        </div>
        ${(() => {
          const author = state.users.find(u => u.uid === ev.createdBy);
          const isMe = ev.createdBy === state.currentUserId;
          const name = author?.name || '알 수 없음';
          return `<div style="font-size:.78rem;color:var(--text3);margin-bottom:6px">✍️ ${name}${isMe ? ' <span style="color:var(--primary-light);font-weight:600">(나)</span>' : ''}</div>`;
        })()}
        <div class="event-meta">
          <span class="event-meta-item">📅 ${formatDate(ev.date)}</span>
          ${ev.time ? `<span class="event-meta-item">🕐 ${ev.time}</span>` : ''}
          ${ev.location ? `<span class="event-meta-item">📍 ${ev.location}</span>` : ''}
          ${ev.fee ? `<span class="event-meta-item">💰 ${ev.fee}</span>` : ''}
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
        <div class="event-actions">
          <button class="btn btn-sm btn-outline" onclick="openVoteModal('${ev.id}')">📊 투표 현황</button>
          ${canEdit(ev) ? `
            <button class="btn btn-sm btn-outline" onclick="openEditEvent('${ev.id}')">수정</button>
            <button class="btn btn-sm btn-danger" style="margin-left:auto" onclick="deleteEvent('${ev.id}')">삭제</button>
          ` : ''}
        </div>
      </div>`;
  }).join('');
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
    if (ev.quizPhoto) {
      document.getElementById('quizPhotoPreview').innerHTML = `<img src="${ev.quizPhoto}" style="max-width:100%;max-height:160px;border-radius:8px;margin-top:6px">`;
    }
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
      const photoFile = document.getElementById('quizPhoto').files[0];
      if (photoFile) {
        data.quizPhoto = await compressImage(photoFile, 800, 0.75);
      } else {
        data.quizPhoto = existing?.quizPhoto || null;
      }
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
  document.getElementById('quizPhotoPreview').innerHTML = '';
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
  const isAdmin = state.currentUserRole === 'admin';
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
  const authorName = author?.name || '알 수 없음';

  let winnerHtml = '';
  if (revealed && ev.quizWinner) {
    const winner = state.users.find(u => u.uid === ev.quizWinner) || state.members.find(m => m.id === ev.quizWinner);
    winnerHtml = `<div class="quiz-winner-banner">🏆 당첨자: <strong>${winner?.name || '알 수 없음'}</strong></div>`;
  } else if (revealed && !ev.quizWinner) {
    winnerHtml = `<div class="quiz-winner-banner" style="background:rgba(255,107,107,.13);border-color:rgba(255,107,107,.3);color:#ff9898">😢 정답자 없음 — 추첨 불가</div>`;
  }

  const optionsHtml = options.map((opt, i) => {
    let cls = 'quiz-opt-btn';
    if (revealed) {
      if (i === correctIdx) cls += ' correct';
      else if (myAnswer === i) cls += ' wrong';
    } else {
      if (myAnswer === i) cls += ' selected';
    }
    const disabled = (deadlinePassed || revealed || myAnswer !== null) ? 'disabled' : '';
    const countAnswered = Object.values(quizAnswers).filter(v => v === i).length;
    const pct = totalAnswers > 0 ? Math.round(countAnswered / totalAnswers * 100) : 0;
    return `
      <button class="${cls}" onclick="castQuizAnswer('${ev.id}', ${i})" ${disabled}>
        <span class="quiz-opt-label">${labels[i]}</span>
        <span class="quiz-opt-text">${opt}</span>
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
        <div class="event-title">${ev.title}</div>
        ${isPast ? '<span style="font-size:.78rem;color:var(--text3);background:var(--bg3);padding:3px 10px;border-radius:10px;white-space:nowrap">종료됨</span>' : ''}
      </div>
      <div style="font-size:.78rem;color:var(--text3);margin-bottom:6px">✍️ ${authorName}${isMe ? ' <span style="color:var(--primary-light);font-weight:600">(나)</span>' : ''}</div>
      <div class="event-meta">
        <span class="event-meta-item">📅 ${formatDate(ev.date)}</span>
        ${deadline ? `<span class="event-meta-item ${deadlinePassed ? 'deadline-over' : 'deadline-active'}">⏰ 마감 ${ev.voteDeadline.replace('T', ' ')}</span>` : ''}
      </div>
      ${ev.desc ? `<div style="font-size:.88rem;color:var(--text2);margin-bottom:10px">${linkify(ev.desc)}</div>` : ''}
      ${ev.quizPhoto ? `<img src="${ev.quizPhoto}" style="width:100%;max-height:220px;object-fit:cover;border-radius:10px;margin-bottom:12px">` : ''}
      <div class="quiz-options">${optionsHtml}</div>
      <div style="font-size:.78rem;color:var(--text3);margin:6px 0 8px">${myAnswer !== null ? `✅ 답변 완료 (${labels[myAnswer]})` : deadlinePassed ? '⏰ 마감됨' : '👆 정답을 골라보세요!'} · 참여 ${totalAnswers}명</div>
      ${winnerHtml}
      <div class="event-actions">${adminActions}</div>
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

/* ===== IMAGE 압축 (base64 → Firestore 직접 저장) ===== */
function compressImage(file, maxSize, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = height * maxSize / width; width = maxSize; }
          else { width = width * maxSize / height; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
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
  if (m.image) return `<img src="${m.image}" alt="${m.name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
  return `<span style="background:${color};color:#fff;width:100%;height:100%;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:700">${m.name?.[0] || '?'}</span>`;
}

function avatarSmall(m) {
  const colors = ['#6c63ff', '#ff6b6b', '#4ade80', '#60a5fa', '#f472b6', '#fb923c'];
  const color = colors[(m.name?.charCodeAt(0) || 0) % colors.length];
  if (m.image) return `<img src="${m.image}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">`;
  return `<span style="background:${color};color:#fff;width:28px;height:28px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;flex-shrink:0">${m.name?.[0] || '?'}</span>`;
}

function linkify(text) {
  return text
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
  return state.currentUserRole === 'admin' || item.createdBy === state.currentUserId;
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

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
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

  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal || btn.closest('.modal-overlay')?.id));
  });
  // 폼 모달은 외부 클릭으로 닫히지 않음 (데이터 손실 방지)
  const formModals = new Set(['memberModal', 'eventModal', 'galleryFormModal', 'myAccountModal', 'inviteModal']);
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
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('memberImagePreview').innerHTML = `<img src="${ev.target.result}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--border)"><span style="font-size:.78rem;color:var(--text3);margin-left:8px;vertical-align:middle">선택된 새 사진</span>`;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('carImage').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('carImagePreview').innerHTML = `<img src="${ev.target.result}" style="width:80px;height:56px;border-radius:8px;object-fit:cover;border:2px solid var(--border)"><span style="font-size:.78rem;color:var(--text3);margin-left:8px;vertical-align:middle">선택된 새 사진</span>`;
    };
    reader.readAsDataURL(file);
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
  document.getElementById('quizPhoto').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      document.getElementById('quizPhotoPreview').innerHTML = `<img src="${ev.target.result}" style="max-width:100%;max-height:160px;border-radius:8px;margin-top:6px">`;
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btnAddGallery').addEventListener('click', openAddGallery);
  document.getElementById('galleryForm').addEventListener('submit', saveGallery);

  // 사진 미리보기
  document.getElementById('galleryPhotos').addEventListener('change', e => {
    const preview = document.getElementById('galleryPhotoPreview');
    const existing = preview.querySelectorAll('.preview-photo-wrap').length;
    Array.from(e.target.files).forEach(f => {
      const reader = new FileReader();
      reader.onload = ev => {
        const wrap = document.createElement('div');
        wrap.className = 'preview-photo-wrap';
        wrap.innerHTML = `<img src="${ev.target.result}" class="preview-photo">`;
        preview.appendChild(wrap);
      };
      reader.readAsDataURL(f);
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
  // 초기 URL 해시로 페이지 복원
  const initPage = location.hash.replace('#', '') || 'home';
  const validPages = ['home', 'members', 'cars', 'events', 'gallery', 'admin'];
  if (validPages.includes(initPage)) goPage(initPage, false);
  history.replaceState({ page: state.currentPage }, '', '#' + state.currentPage);

  initFirebase();
  initAuth();

  // ⑧ Firestore 구독 및 seed는 showApp()에서 인증 완료 후 처리
});
