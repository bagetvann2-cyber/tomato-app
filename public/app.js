const socket = io();

let activePhoto = null; // { id, url, name }
let cooldown = false;

const mainPhoto = document.getElementById('main-photo');
const splatsLayer = document.getElementById('splats-layer');
const throwBtn = document.getElementById('throw-btn');
const totalCountEl = document.getElementById('total-count');
const onlineCountEl = document.getElementById('online-count');
const thumbnailsEl = document.getElementById('thumbnails');
const photoSelector = document.getElementById('photo-selector');
const noPhotos = document.getElementById('no-photos');
const flyingContainer = document.getElementById('flying-tomatoes');
const photoWrapper = document.getElementById('photo-wrapper');

fetch('/photos')
  .then(r => r.json())
  .then(photos => {
    if (photos.length === 0) {
      noPhotos.classList.remove('hidden');
      mainPhoto.style.display = 'none';
      throwBtn.disabled = true;
      return;
    }

    photoSelector.classList.remove('hidden');
    photos.forEach(photo => {
      const img = document.createElement('img');
      img.src = photo.url;
      img.className = 'thumb';
      img.dataset.id = photo.id;
      img.title = photo.name;
      img.addEventListener('click', () => selectPhoto(photo));
      thumbnailsEl.appendChild(img);
    });

    selectPhoto(photos[0]);
  });

function selectPhoto(photo) {
  activePhoto = photo;
  mainPhoto.src = photo.url;
  mainPhoto.style.display = 'block';
  noPhotos.classList.add('hidden');
  throwBtn.disabled = false;

  document.querySelectorAll('.thumb').forEach(t => {
    t.classList.toggle('active', t.dataset.id === photo.id);
  });

  splatsLayer.innerHTML = '';
  totalCountEl.textContent = '0';
  socket.emit('get_splats', photo.id);
}

socket.on('splats_data', ({ photoId, splats, total }) => {
  if (!activePhoto || photoId !== activePhoto.id) return;
  splats.forEach(s => drawSplat(s.x, s.y, s.size, s.rotation, false));
  totalCountEl.textContent = total;
});

socket.on('tomato_hit', ({ photoId, x, y, size, rotation, total }) => {
  if (activePhoto && photoId === activePhoto.id) {
    animateTomato(x, y, () => drawSplat(x, y, size, rotation, true));
    totalCountEl.textContent = total;
  }
});

socket.on('online_count', (count) => {
  onlineCountEl.textContent = count;
});

photoWrapper.addEventListener('click', (e) => {
  if (!activePhoto || cooldown) return;
  const rect = mainPhoto.getBoundingClientRect();
  if (e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom) return;
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  throwTomato(x, y);
});

throwBtn.addEventListener('click', () => {
  if (!activePhoto || cooldown) return;
  throwTomato(20 + Math.random() * 60, 20 + Math.random() * 60);
});

function throwTomato(x, y) {
  socket.emit('throw_tomato', { photoId: activePhoto.id, x, y });
  startCooldown();
}

function startCooldown() {
  cooldown = true;
  throwBtn.classList.add('cooldown');
  throwBtn.disabled = true;
  setTimeout(() => {
    cooldown = false;
    throwBtn.classList.remove('cooldown');
    throwBtn.disabled = false;
  }, 1000);
}

function drawSplat(xPct, yPct, size, rotation, animated) {
  const el = document.createElement('div');
  el.className = 'splat';
  const w = size;
  const h = size * (0.7 + Math.random() * 0.5);
  el.style.width = w + 'px';
  el.style.height = h + 'px';
  el.style.left = `calc(${xPct}% - ${w / 2}px)`;
  el.style.top = `calc(${yPct}% - ${h / 2}px)`;
  el.style.setProperty('--rot', rotation + 'deg');
  el.style.transform = `scale(1) rotate(${rotation}deg)`;
  if (!animated) {
    el.style.animation = 'none';
    el.style.opacity = '0.82';
  }
  splatsLayer.appendChild(el);
}

function animateTomato(targetXPct, targetYPct, onHit) {
  const rect = mainPhoto.getBoundingClientRect();
  const targetX = rect.left + (targetXPct / 100) * rect.width;
  const targetY = rect.top + (targetYPct / 100) * rect.height;

  const edge = Math.floor(Math.random() * 4);
  let startX, startY;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (edge === 0)      { startX = Math.random() * vw; startY = -80; }
  else if (edge === 1) { startX = vw + 80; startY = Math.random() * vh; }
  else if (edge === 2) { startX = Math.random() * vw; startY = vh + 80; }
  else                 { startX = -80; startY = Math.random() * vh; }

  const tomato = document.createElement('img');
  tomato.className = 'flying-tomato';
  tomato.src = '/tomato-tomato-throw.gif?t=' + Date.now();
  tomato.style.left = startX + 'px';
  tomato.style.top = startY + 'px';
  flyingContainer.appendChild(tomato);

  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const duration = Math.max(800, Math.min(1400, dist * 1.1));

  const mid = {
    x: startX + dx * 0.5 + (Math.random() - 0.5) * 120,
    y: startY + dy * 0.5 - 100
  };

  let start = null;
  function step(ts) {
    if (!start) start = ts;
    const t = Math.min((ts - start) / duration, 1);
    const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * mid.x + t * t * targetX;
    const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * mid.y + t * t * targetY;
    tomato.style.left = x + 'px';
    tomato.style.top = y + 'px';
    tomato.style.transform = `rotate(${t * 540}deg) scale(${1 + t * 0.3})`;
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      tomato.remove();
      onHit();
    }
  }
  requestAnimationFrame(step);
}
