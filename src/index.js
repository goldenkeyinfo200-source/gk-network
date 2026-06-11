require('dotenv').config();

const express = require('express');
const cors = require('cors');

const pool = require('./db/pool');

const authRoutes = require('./routes/auth');
const propertiesRoutes = require('./routes/properties');
const clientsRoutes = require('./routes/clients');
const leadsRoutes = require('./routes/leads');
const adminRoutes = require('./routes/admin');
const bannersRoutes = require('./routes/banners');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GK Network API'
  });
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      db: 'connected',
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error('Health error:', err);
    res.status(500).json({
      status: 'error',
      db: 'disconnected'
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/banners', bannersRoutes);

app.use((req, res) => {
  res.status(404).json({
    error: 'Topilmadi'
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Server xatosi'
  });
});

app.listen(PORT, () => {
  console.log(`✅ GK Network API ishlayapti. PORT: ${PORT}`);
});