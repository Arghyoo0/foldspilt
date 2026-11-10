require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. CYBERSECURITY HARDENING
// ==========================================
app.use(helmet({ contentSecurityPolicy: false })); // Secures HTTP headers while allowing CDNs
app.use(cors()); // Controls cross-origin requests
app.use(express.json({ limit: '10mb' })); // Protects against oversized payload attacks
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Protect API routes from spam & brute-force DDoS
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, please try again in 15 minutes.' }
});
app.use('/api', apiLimiter);

// ==========================================
// 2. DATABASE MODELS (User, Event, Expense)
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  upiId: { type: String, default: '' },
  pfpUrl: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  deviceName: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}));

const Event = mongoose.model('Event', new mongoose.Schema({
  eventId: { type: String, required: true, unique: true, index: true },
  code: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  dateISO: { type: String, required: true },
  createdByUserId: { type: String, required: true },
  members: [{ type: String }],
  memberProfiles: { type: Map, of: Object, default: {} },
  settledTransfers: [{
    id: String,
    from: String,
    to: String,
    amount: Number,
    method: String,
    settledByDeviceId: String,
    settledAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
}));

const Expense = mongoose.model('Expense', new mongoose.Schema({
  expenseId: { type: String, required: true, unique: true, index: true },
  eventId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  paidBy: { type: String, required: true },
  method: { type: String, default: 'UPI' },
  participants: [{ type: String }],
  cleared: { type: Boolean, default: false },
  createdBy: { type: String, required: true },
  createdByUserId: { type: String, required: true },
  createdByPfp: { type: String, default: '' },
  deviceUsed: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  timeStr: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}));

// ==========================================
// 3. API ENDPOINTS
// ==========================================

// Save or Update User Profile
app.post('/api/users/profile', async (req, res) => {
  try {
    const { id, name, upi, pfp, deviceName, deviceId } = req.body;
    const user = await User.findOneAndUpdate(
      { userId: id },
      { name, upiId: upi || '', pfpUrl: pfp || '', deviceName, deviceId },
      { upsert: true, new: true }
    );
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save profile' });
  }
});

// Fetch All Events & Transactions for User
app.get('/api/events', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const events = await Event.find().lean();
    for (const evt of events) {
      evt.expenses = await Expense.find({ eventId: evt.eventId }).sort({ createdAt: -1 }).lean();
      evt.id = evt.eventId;
    }
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load events' });
  }
});

// Create New Event
app.post('/api/events', async (req, res) => {
  try {
    const { id, code, name, dateISO, createdByUserId, members, memberProfiles } = req.body;
    const newEvent = await Event.create({
      eventId: id,
      code,
      name,
      dateISO,
      createdByUserId,
      members,
      memberProfiles: memberProfiles || {}
    });
    res.status(201).json({ ok: true, event: newEvent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Join Event via Share Link
app.post('/api/events/:eventId/join', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { name, upi, pfp, deviceName, deviceId } = req.body;
    const event = await Event.findOne({ $or: [{ eventId }, { code: eventId }] });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    if (!event.members.includes(name)) event.members.push(name);
    if (!event.memberProfiles) event.memberProfiles = new Map();
    event.memberProfiles.set(name, { name, upi: upi || '', pfp: pfp || '', deviceName, deviceId });

    await event.save();
    res.json({ ok: true, event });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join event' });
  }
});

// Create Expense
app.post('/api/events/:eventId/expenses', async (req, res) => {
  try {
    const { eventId } = req.params;
    const exp = req.body;
    const newExpense = await Expense.create({
      expenseId: exp.id,
      eventId,
      title: exp.title,
      category: exp.category,
      amount: exp.amount,
      paidBy: exp.paidBy,
      method: exp.method,
      participants: exp.participants,
      cleared: false,
      createdBy: exp.createdBy,
      createdByUserId: exp.createdByUserId,
      createdByPfp: exp.createdByPfp || '',
      deviceUsed: exp.deviceUsed || '',
      deviceId: exp.deviceId || '',
      timeStr: exp.timeStr || ''
    });
    res.status(201).json({ ok: true, expense: newExpense });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add expense' });
  }
});

// Toggle Cleared State
app.patch('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;
    const { cleared } = req.body;
    const updated = await Expense.findOneAndUpdate({ expenseId }, { cleared }, { new: true });
    res.json({ ok: true, expense: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update expense' });
  }
});

// Delete Expense
app.delete('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;
    await Expense.findOneAndDelete({ expenseId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Record Settlement Transfer
app.post('/api/events/:eventId/settlements', async (req, res) => {
  try {
    const { eventId } = req.params;
    const st = req.body;
    const event = await Event.findOne({ $or: [{ eventId }, { code: eventId }] });
    if (!event) return res.status(404).json({ error: 'Event not found' });

    event.settledTransfers.push({
      id: st.id,
      from: st.from,
      to: st.to,
      amount: st.amount,
      method: st.method,
      settledByDeviceId: st.settledByDeviceId,
      settledAt: new Date()
    });
    await event.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed settlement' });
  }
});

// Custom Category Storing
app.post('/api/categories', (req, res) => res.json({ ok: true }));

// ==========================================
// 4. SERVE FRONTEND & SHAREABLE EVENT LINKS
// ==========================================
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Route any custom shareable event link (e.g., /dinner-123) directly to the app
app.get('/:eventCode', (req, res, next) => {
  if (req.params.eventCode.includes('.') || req.params.eventCode.startsWith('api')) {
    return next();
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ==========================================
// 5. CONNECT DATABASE & LAUNCH
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✓ Successfully connected to MongoDB Atlas!');
    app.listen(PORT, () => {
      console.log(`🚀 FoldSplit Server is running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database connection failed:', err.message);
  });