const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PHOTOS_DIR = path.join(__dirname, 'public', 'photos');
const MAX_SPLATS = 200;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Cloudinary - optional, used when env vars are set
const useCloudinary = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

let cloudinary, upload;

if (useCloudinary) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  const storage = new CloudinaryStorage({
    cloudinary,
    params: { folder: 'tomato-app', allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }
  });
  upload = multer({ storage });
  console.log('Cloudinary enabled');
} else {
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  const storage = multer.diskStorage({
    destination: PHOTOS_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
  });
  upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });
  console.log('Local storage (set CLOUDINARY_* env vars for persistent cloud storage)');
}

// In-memory state
const splats = {};
const totalCounts = {};
let onlineCount = 0;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/check-auth', (req, res) => {
  const pw = req.headers['x-admin-password'];
  if (pw === ADMIN_PASSWORD) res.json({ ok: true });
  else res.status(401).json({ error: 'Неверный пароль' });
});

// List photos
app.get('/photos', async (req, res) => {
  try {
    if (useCloudinary) {
      const result = await cloudinary.search
        .expression('folder:tomato-app')
        .sort_by('created_at', 'desc')
        .max_results(50)
        .execute();
      res.json(result.resources.map(r => ({
        id: r.public_id,
        url: r.secure_url,
        name: path.basename(r.public_id)
      })));
    } else {
      const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const files = fs.existsSync(PHOTOS_DIR)
        ? fs.readdirSync(PHOTOS_DIR).filter(f => exts.includes(path.extname(f).toLowerCase()))
        : [];
      res.json(files.map(f => ({ id: f, url: `/photos/${f}`, name: f })));
    }
  } catch (e) {
    res.json([]);
  }
});

// Upload photo (admin)
app.post('/upload', (req, res, next) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  next();
}, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Нет файла' });
  const photo = useCloudinary
    ? { id: req.file.filename, url: req.file.path, name: path.basename(req.file.filename) }
    : { id: req.file.filename, url: `/photos/${req.file.filename}`, name: req.file.originalname };
  res.json({ ok: true, photo });
});

// Delete photo (admin)
app.delete('/photo/:id(*)', async (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  try {
    const id = req.params.id;
    if (useCloudinary) {
      await cloudinary.uploader.destroy(id);
    } else {
      const fp = path.join(PHOTOS_DIR, id);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    delete splats[id];
    delete totalCounts[id];
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Socket.io
io.on('connection', (socket) => {
  onlineCount++;
  io.emit('online_count', onlineCount);

  socket.on('get_splats', (photoId) => {
    socket.emit('splats_data', {
      photoId,
      splats: splats[photoId] || [],
      total: totalCounts[photoId] || 0
    });
  });

  socket.on('throw_tomato', ({ photoId, x, y }) => {
    if (!photoId || x == null || y == null) return;
    const splat = { x, y, size: 40 + Math.random() * 50, rotation: Math.random() * 360 };
    if (!splats[photoId]) splats[photoId] = [];
    splats[photoId].push(splat);
    if (splats[photoId].length > MAX_SPLATS) splats[photoId].shift();
    totalCounts[photoId] = (totalCounts[photoId] || 0) + 1;
    io.emit('tomato_hit', { photoId, ...splat, total: totalCounts[photoId] });
  });

  socket.on('disconnect', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit('online_count', onlineCount);
  });
});

server.listen(PORT, () => {
  console.log(`TomatoApp running at http://localhost:${PORT}`);
});
