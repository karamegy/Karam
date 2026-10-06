// --- 1. التهيئة والتخزين المحلي ---
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.apps.length ? firebase.firestore() : null;

// IndexedDB التخزين المحلي
let idb;
const request = indexedDB.open("ConnectXUltraDB", 2);
request.onupgradeneeded = (e) => {
  idb = e.target.result;
  if (!idb.objectStoreNames.contains("messages")) {
    idb.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
  }
};
request.onsuccess = (e) => { idb = e.target.result; };

// --- 2. الحالة العامة للنظام ---
let contacts = [
  { id: "saved_cloud", name: "الرسائل المحفوظة (السحابة)", avatar: "https://i.pravatar.cc/150?img=60", status: "مساحتك الشخصية", category: "saved", isLocked: false, pin: null },
  { id: "1", name: "أحمد محمود", avatar: "https://i.pravatar.cc/150?img=11", status: "متصل الآن", category: "work", isLocked: true, pin: "1234" },
  { id: "2", name: "سارة علي", avatar: "https://i.pravatar.cc/150?img=5", status: "آخر ظهور منذ ساعة", category: "personal", isLocked: false, pin: null }
];

let activeContact = null;
let currentFilter = 'all';
let isStealthMode = false;
let isViewOnce = false;
let mediaRecorder, audioChunks = [];
let localStream, peerConnection;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19020' }] };

// العناصر
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const mediaPanel = document.getElementById('media-panel');
const mediaGrid = document.getElementById('media-grid');

// --- 3. إدارة التبويبات والمجلدات الذكية ---
document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.getAttribute('data-tab')}`).classList.add('active');
  });
});

document.querySelectorAll('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentFilter = pill.getAttribute('data-filter');
    renderContacts();
  });
});

// --- 4. العرض والفلترة وقفل PIN ---
function renderContacts() {
  const listEl = document.getElementById('contacts-list');
  listEl.innerHTML = '';
  
  const filtered = contacts.filter(c => currentFilter === 'all' || c.category === currentFilter);
  
  filtered.forEach(c => {
    const li = document.createElement('li');
    li.className = `contact-item ${activeContact?.id === c.id ? 'active' : ''}`;
    const lockBadge = c.isLocked ? '<i class="fa-solid fa-lock" style="margin-right:auto; color:var(--accent);"></i>' : '';
    li.innerHTML = `<img src="${c.avatar}" class="avatar"><div><h4>${c.name}</h4><p>${c.status}</p></div>${lockBadge}`;
    li.onclick = () => handleContactSelection(c);
    listEl.appendChild(li);
  });
}

function handleContactSelection(contact) {
  if (contact.isLocked) {
    showPinModal(contact);
  } else {
    selectContact(contact);
  }
}

function showPinModal(contact) {
  const modal = document.getElementById('pin-modal');
  const input = document.getElementById('pin-input');
  const btn = document.getElementById('unlock-pin-btn');
  input.value = '';
  modal.classList.remove('hidden');

  btn.onclick = () => {
    if (input.value === contact.pin) {
      modal.classList.add('hidden');
      selectContact(contact);
    } else {
      alert('رمز PIN غير صحيح!');
    }
  };
}

function selectContact(contact) {
  activeContact = contact;
  document.getElementById('active-name').textContent = contact.name;
  document.getElementById('active-avatar').src = contact.avatar;
  document.getElementById('active-status').textContent = contact.status;
  renderContacts();
  loadMessages();
}

// --- 5. إرسال الرسائل والمميزات المتقدمة ---
function sendMessage(type = 'text', content = '', options = {}) {
  if (!activeContact) return alert('اختر محادثة أولاً');
  const text = content || messageInput.value.trim();
  if (!text) return;

  const msgData = {
    contactId: activeContact.id,
    sender: 'sent',
    type: type,
    content: text,
    isViewOnce: options.isViewOnce || false,
    viewed: false,
    timestamp: new Date().toISOString()
  };

  if (idb) {
    const tx = idb.transaction("messages", "readwrite");
    tx.objectStore("messages").add(msgData);
  }

  if (db && !isStealthMode) {
    db.collection("chats").doc(activeContact.id).collection("messages").add(msgData);
  }

  appendMessageUI(msgData);
  if (type === 'text') messageInput.value = '';
  if (isViewOnce) {
    isViewOnce = false;
    document.getElementById('view-once-btn').classList.remove('active-mode');
  }
}

function appendMessageUI(msg) {
  const div = document.createElement('div');
  div.className = `message ${msg.sender}`;
  
  // خاصية العرض لمرة واحدة
  if (msg.isViewOnce && !msg.viewed) {
    div.classList.add('view-once-blurred');
    div.innerHTML = `<i class="fa-solid fa-eye-slash"></i> وسائط للعرض لمرة واحدة (انقر للفتح)`;
    div.onclick = () => {
      div.classList.remove('view-once-blurred');
      renderMessageContent(div, msg);
      msg.viewed = true;
    };
  } else {
    renderMessageContent(div, msg);
  }

  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function renderMessageContent(div, msg) {
  if (msg.type === 'text') div.textContent = msg.content;
  else if (msg.type === 'image') div.innerHTML = `<img src="${msg.content}">`;
  else if (msg.type === 'video') {
    div.innerHTML = `<video src="${msg.content}" controls></video><button class="pip-btn">تشغيل عائم PiP</button>`;
    setTimeout(() => {
      const v = div.querySelector('video');
      const pip = div.querySelector('.pip-btn');
      if (pip && v) pip.onclick = () => v.requestPictureInPicture();
    }, 100);
  } else if (msg.type === 'audio') {
    div.innerHTML = `<audio src="${msg.content}" controls></audio>`;
  }
}

function loadMessages() {
  messagesContainer.innerHTML = '';
  if (!activeContact) return;

  if (idb) {
    const tx = idb.transaction("messages", "readonly");
    const store = tx.objectStore("messages");
    const request = store.getAll();
    request.onsuccess = () => {
      request.result
        .filter(m => m.contactId === activeContact.id)
        .forEach(appendMessageUI);
    };
  }
}

// --- 6. تحويل الصوت لنص + الردود السريعة + العرض لمرة واحدة ---
// Speech to Text (Web Speech API)
const sttBtn = document.getElementById('stt-btn');
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'ar-SA';

  sttBtn.onclick = () => {
    recognition.start();
    sttBtn.style.color = '#10b981';
  };

  recognition.onresult = (e) => {
    messageInput.value += e.results[0][0].transcript;
    sttBtn.style.color = '';
  };
}

// View Once Toggle
document.getElementById('view-once-btn').onclick = (e) => {
  isViewOnce = !isViewOnce;
  e.currentTarget.classList.toggle('active-mode', isViewOnce);
};

// Quick Replies Toggle
const qrMenu = document.getElementById('quick-replies-menu');
document.getElementById('quick-reply-btn').onclick = () => qrMenu.classList.toggle('hidden');
document.querySelectorAll('.qr-item').forEach(item => {
  item.onclick = () => {
    messageInput.value = item.getAttribute('data-text');
    qrMenu.classList.add('hidden');
  };
});

// Stealth Mode Toggle
document.getElementById('stealth-toggle-btn').onclick = (e) => {
  isStealthMode = !isStealthMode;
  e.currentTarget.classList.toggle('stealth-active', isStealthMode);
  alert(isStealthMode ? 'تم تفعيل وضع التخفي! لن يتم إرسال مؤشرات القراءة أو الكتابة.' : 'تم إيقاف وضع التخفي.');
};

// --- 7. جدولة الرسائل (Scheduled Messages) ---
const schedModal = document.getElementById('schedule-modal');
document.getElementById('schedule-btn').onclick = () => schedModal.classList.remove('hidden');
document.getElementById('close-schedule-btn').onclick = () => schedModal.classList.add('hidden');

document.getElementById('confirm-schedule-btn').onclick = () => {
  const timeVal = document.getElementById('schedule-time-input').value;
  if (!timeVal) return alert('حدد الوقت أولاً');
  
  const delay = new Date(timeVal).getTime() - new Date().getTime();
  if (delay <= 0) return alert('اختر وقتاً مستقبلياً!');

  const textToSchedule = messageInput.value;
  messageInput.value = '';
  schedModal.classList.add('hidden');

  alert('تم جدولة الرسالة بنجاح!');
  setTimeout(() => {
    sendMessage('text', textToSchedule);
  }, delay);
};

// --- 8. تسجيل الصوت ومكالمات WebRTC ---
const recordBtn = document.getElementById('record-audio-btn');
recordBtn.addEventListener('click', async () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
      const reader = new FileReader();
      reader.onload = () => sendMessage('audio', reader.result);
      reader.readAsDataURL(audioBlob);
    };
    mediaRecorder.start();
    recordBtn.style.color = '#ef4444';
  } else {
    mediaRecorder.stop();
    recordBtn.style.color = '';
  }
});

// WebRTC Calls
document.getElementById('call-video-btn').onclick = () => startCall(true);
document.getElementById('call-audio-btn').onclick = () => startCall(false);
document.getElementById('end-call-btn').onclick = () => {
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (peerConnection) peerConnection.close();
  document.getElementById('call-modal').classList.add('hidden');
};

async function startCall(video = true) {
  document.getElementById('call-modal').classList.remove('hidden');
  localStream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
  document.getElementById('local-video').srcObject = localStream;
  peerConnection = new RTCPeerConnection(rtcConfig);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = e => { document.getElementById('remote-video').srcObject = e.streams[0]; };
}

// Media Handling & Sending Controls
document.getElementById('toggle-media-panel').onclick = () => mediaPanel.classList.toggle('hidden');
document.getElementById('close-media-panel').onclick = () => mediaPanel.classList.add('hidden');

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  const isVideo = file.type.startsWith('video/');
  reader.onload = (evt) => {
    sendMessage(isVideo ? 'video' : 'image', evt.target.result, { isViewOnce });
  };
  reader.readAsDataURL(file);
});

document.getElementById('send-btn').onclick = () => sendMessage('text');
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage('text'); });

// التشغيل المبدئي
renderContacts();
