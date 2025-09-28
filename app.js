// ====================
// JOMPO App (extended) with Admin Dashboard
// Replace with your Firebase config below
// ====================
const firebaseConfig = {
  apiKey: "YOUR_KEY_HERE",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// default locations to seed (5-10)
const DEFAULT_LOCATIONS = [
  "Nairobi","Kisumu","Eldoret","Mombasa","Nakuru",
  "Kericho","Kakamega","Machakos","Nyeri","Kisii"
];

// Admin email (provided)
const HARDCODED_ADMIN_EMAIL = "maxwelogweno098@gmail.com";

let allProducts = []; // cached products list
let currentUserDoc = null; // store current user's profile doc (if exists)

// NAV
function showSection(id) {
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.getElementById(id).style.display = 'block';
}

// AUTH: signup/login/logout
async function signup() {
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  if (!email || !password) return alert('Enter email & password');
  try {
    const uc = await auth.createUserWithEmailAndPassword(email, password);
    // create a users doc for admin management
    await db.collection('users').doc(uc.user.uid).set({
      email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      blocked: false,
      role: "user"
    });
    alert('Signup successful');
  } catch (err) {
    alert(err.message);
  }
}

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) return alert('Enter email & password');
  try {
    await auth.signInWithEmailAndPassword(email, password);
    showSection('market');
  } catch (err) {
    alert(err.message);
  }
}

function logout() {
  auth.signOut().then(() => {
    showSection('login');
  });
}

// Seed locations collection if empty
async function seedLocationsIfEmpty() {
  const snap = await db.collection('locations').limit(1).get();
  if (snap.empty) {
    const batch = db.batch();
    DEFAULT_LOCATIONS.forEach(loc => {
      const ref = db.collection('locations').doc();
      batch.set(ref, { name: loc });
    });
    await batch.commit();
  }
}

// Load locations into both product creation select and filter select
async function loadLocations() {
  const locSel = document.getElementById('productLocation');
  const filterSel = document.getElementById('locationFilter');
  locSel.innerHTML = '';
  // fetch locations from Firestore
  const snap = await db.collection('locations').orderBy('name').get();
  const locations = [];
  snap.forEach(doc => locations.push({ id: doc.id, ...doc.data() }));
  // populate product location select (default to first)
  locations.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    locSel.appendChild(opt);
  });
  // populate filter select
  filterSel.innerHTML = '<option value="">All Locations</option>';
  locations.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.name;
    opt.textContent = l.name;
    filterSel.appendChild(opt);
  });
}

// Add a new location (editable dropdown) - normal users blocked; admin uses adminAddLocation
function addLocation() {
  alert("Location creation is admin-only. Use the Admin Dashboard to add locations.");
}

// Admin: add location directly
async function adminAddLocation() {
  const input = document.getElementById('adminNewLocation');
  const name = input.value.trim();
  if (!name) return alert('Enter a location name');
  // create location doc
  await db.collection('locations').add({ name });
  input.value = '';
  await loadLocations();
  alert('Location added');
}

// Add product with single photo (checks blocked state)
async function addProduct() {
  const name = document.getElementById('productName').value.trim();
  const price = document.getElementById('productPrice').value;
  const location = document.getElementById('productLocation').value;
  const imageFile = document.getElementById('productImage').files[0];
  if (!name || !price || !location) return alert('Fill all fields');
  if (!imageFile) return alert('Please select an image');
  const user = auth.currentUser;
  if (!user) return alert('Please log in to add product');

  // check if user is blocked
  if (currentUserDoc && currentUserDoc.blocked) return alert('Your account has been blocked. Contact admin.');

  const storageRef = storage.ref('product_images/' + Date.now() + '_' + imageFile.name);
  const uploadTask = storageRef.put(imageFile);
  uploadTask.on('state_changed',
    null,
    (err) => alert(err.message),
    async () => {
      const url = await uploadTask.snapshot.ref.getDownloadURL();
      await db.collection('products').add({
        name, price: Number(price), location, imageUrl: url,
        ownerId: user.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      document.getElementById('productName').value = '';
      document.getElementById('productPrice').value = '';
      document.getElementById('productImage').value = '';
      alert('Product added');
    });
}

// Load products and cache them
function loadProducts() {
  db.collection('products').orderBy('createdAt','desc').onSnapshot(snapshot => {
    allProducts = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      data.id = doc.id;
      allProducts.push(data);
    });
    applyFilters();
    // Update admin list if admin open
    renderAdminProducts();
  });
}

// Apply search and location filters and render
function applyFilters() {
  const searchQuery = document.getElementById('searchInput').value.toLowerCase();
  const locationFilter = document.getElementById('locationFilter').value;
  const container = document.getElementById('productsList');
  container.innerHTML = '';
  const filtered = allProducts.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery);
    const matchesLocation = locationFilter === '' || p.location === locationFilter;
    return matchesSearch && matchesLocation;
  });
  if (filtered.length === 0) {
    container.innerHTML = '<div class="card small">No products found.</div>';
    return;
  }
  filtered.forEach(p => {
    const html = `<div>
      <img src="${p.imageUrl}" alt="${p.name}" />
      <div>
        <h4>${p.name}</h4>
        <div class="small">Price: KSH ${p.price}</div>
        <div class="small">Location: ${p.location}</div>
      </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
  });
}

// ==================
// ADMIN FUNCTIONS
// ==================
function isCurrentUserAdmin(user) {
  if (!user) return false;
  // primary check: hardcoded admin email OR user doc role === 'admin'
  if ((user.email && user.email.toLowerCase() === HARDCODED_ADMIN_EMAIL.toLowerCase()) ) return true;
  if (currentUserDoc && currentUserDoc.role === 'admin') return true;
  return false;
}

// show/hide admin UI elements
function updateAdminUI(user) {
  const adminBtn = document.getElementById('adminBtn');
  if (isCurrentUserAdmin(user)) {
    adminBtn.style.display = 'inline-block';
  } else {
    adminBtn.style.display = 'none';
  }
}

// Admin: render products with delete buttons
function renderAdminProducts() {
  const container = document.getElementById('adminProductsList');
  if (!container) return;
  container.innerHTML = '';
  // show all products with delete option
  allProducts.forEach(p => {
    const html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <div style="display:flex;gap:10px;align-items:center;">
        <img src="${p.imageUrl}" style="width:64px;height:48px;object-fit:cover;border-radius:4px" />
        <div><strong>${p.name}</strong><div class="small">Loc: ${p.location} · KSH ${p.price}</div></div>
      </div>
      <div>
        <button onclick="adminDeleteProduct('${p.id}', '${p.imageUrl.replace(/'/g, "\\'")}')">Delete</button>
      </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
  });
}

// Admin: delete product (Firestore + Storage)
async function adminDeleteProduct(productId, imageUrl) {
  if (!confirm('Delete this product?')) return;
  try {
    // delete Firestore doc
    await db.collection('products').doc(productId).delete();
    // delete storage file (if exists) - only admin allowed in storage rules
    if (imageUrl) {
      try {
        const ref = storage.refFromURL(imageUrl);
        await ref.delete();
      } catch (e) {
        console.warn('Failed to delete image from storage:', e.message || e);
      }
    }
    alert('Product deleted');
  } catch (err) {
    alert('Failed to delete product: ' + (err.message || err));
  }
}

// Admin: render locations list with delete buttons
async function renderAdminLocations() {
  const container = document.getElementById('adminLocationsList');
  if (!container) return;
  const snap = await db.collection('locations').orderBy('name').get();
  container.innerHTML = '';
  snap.forEach(doc => {
    const data = doc.data();
    const id = doc.id;
    const html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div>${data.name}</div>
      <div><button onclick="adminDeleteLocation('${id}')">Delete</button></div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
  });
}

async function adminDeleteLocation(locationId) {
  if (!confirm('Delete this location?')) return;
  await db.collection('locations').doc(locationId).delete();
  await loadLocations();
  await renderAdminLocations();
  alert('Location deleted');
}

// Admin: add location wrapper already implemented as adminAddLocation()

// Admin: load users list from 'users' collection
async function renderAdminUsers() {
  const container = document.getElementById('adminUsersList');
  if (!container) return;
  const snap = await db.collection('users').orderBy('createdAt','desc').get();
  container.innerHTML = '';
  snap.forEach(doc => {
    const u = { id: doc.id, ...doc.data() };
    const blocked = u.blocked ? ' (blocked)' : '';
    const html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div>${u.email} <span class="small">${blocked}</span></div>
      <div>
        <button onclick="adminToggleBlockUser('${u.id}', ${u.blocked ? 'false' : 'true'})">
          ${u.blocked ? 'Unblock' : 'Block'}
        </button>
      </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
  });
}

async function adminToggleBlockUser(userId, block) {
  if (!confirm(block ? 'Block this user?' : 'Unblock this user?')) return;
  await db.collection('users').doc(userId).update({ blocked: block });
  await renderAdminUsers();
  alert('User updated');
}

// ==================
// Auth state changes
// ==================
auth.onAuthStateChanged(async (user) => {
  if (user) {
    // load user's doc (if exists)
    const userDocRef = db.collection('users').doc(user.uid);
    const docSnap = await userDocRef.get();
    if (docSnap.exists) {
      currentUserDoc = docSnap.data();
    } else {
      // create a users doc if not present
      await userDocRef.set({
        email: user.email || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        blocked: false,
        role: (user.email && user.email.toLowerCase() === HARDCODED_ADMIN_EMAIL.toLowerCase()) ? 'admin' : 'user'
      });
      const newSnap = await userDocRef.get();
      currentUserDoc = newSnap.data();
    }

    // ensure locations seeded and loaded
    await seedLocationsIfEmpty();
    await loadLocations();
    showSection('market');
    loadProducts();

    // show admin UI if admin
    updateAdminUI(user);
    if (isCurrentUserAdmin(user)) {
      // render admin lists
      renderAdminProducts();
      renderAdminLocations();
      renderAdminUsers();
    }
  } else {
    currentUserDoc = null;
    showSection('login');
    // hide admin UI
    updateAdminUI(null);
  }
});
