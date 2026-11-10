require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 800,
  message: { error: 'Too many requests, please try again later.' }
}));

// ==========================================
// 1. DATABASE MODELS
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  pin: { type: String, required: true },
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
  dateStr: { type: String, default: '' },
  createdAtFormatted: { type: String, default: '' },
  dayNum: { type: Number, default: 1 },
  monthIndex: { type: Number, default: 0 },
  monthShort: { type: String, default: 'JAN' },
  yearNum: { type: Number, default: 2026 },
  iconLetter: { type: String, default: 'E' },
  createdByUserId: { type: String, required: true },
  createdByName: { type: String, default: '' },
  members: [{ type: String }],
  memberProfiles: { type: mongoose.Schema.Types.Mixed, default: {} },
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
// 2. AUTH ROUTES (Username + 4-Digit PIN)
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, pin, name, upi, pfp, deviceName, deviceId } = req.body;
    if (!username || !pin || pin.length !== 4) {
      return res.status(400).json({ error: 'Valid username and 4-digit PIN required.' });
    }

    const clean = username.toLowerCase().trim();
    const existing = await User.findOne({ username: clean });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken. Please log in.' });
    }

    const user = await User.create({
      userId: 'usr_' + clean + '_' + Date.now().toString(36),
      username: clean,
      pin,
      name: name.trim(),
      upiId: upi || '',
      pfpUrl: pfp || '',
      deviceName: deviceName || 'Web',
      deviceId: deviceId || 'DEV-ANON'
    });

    res.status(201).json({
      ok: true,
      user: {
        id: user.userId,
        username: user.username,
        pin: user.pin,
        name: user.name,
        upi: user.upiId,
        pfp: user.pfpUrl,
        deviceName: user.deviceName,
        deviceId: user.deviceId
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, pin, deviceName, deviceId } = req.body;
    const clean = (username || '').toLowerCase().trim();

    const user = await User.findOne({ username: clean });
    if (!user) {
      return res.status(404).json({ error: 'Account not found. Create an account first.' });
    }
    if (user.pin !== pin) {
      return res.status(401).json({ error: 'Incorrect 4-digit PIN.' });
    }

    user.deviceName = deviceName || user.deviceName;
    user.deviceId = deviceId || user.deviceId;
    await user.save();

    res.json({
      ok: true,
      user: {
        id: user.userId,
        username: user.username,
        pin: user.pin,
        name: user.name,
        upi: user.upiId,
        pfp: user.pfpUrl,
        deviceName: user.deviceName,
        deviceId: user.deviceId
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/users/profile', async (req, res) => {
  try {
    const { id, name, upi, pfp, deviceName, deviceId } = req.body;
    const user = await User.findOneAndUpdate(
      { userId: id },
      { name, upiId: upi || '', pfpUrl: pfp || '', deviceName, deviceId },
      { new: true }
    );
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ==========================================
// 3. EVENT & EXPENSE ROUTES
// ==========================================
app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 }).lean();
    for (const evt of events) {
      const expenses = await Expense.find({ eventId: evt.eventId }).sort({ createdAt: -1 }).lean();
      evt.expenses = expenses.map(x => ({ ...x, id: x.expenseId }));
      evt.id = evt.eventId;
      evt.memberProfiles = evt.memberProfiles || {};
    }
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load events.' });
  }
});

app.get('/api/events/by-code/:code', async (req, res) => {
  try {
    const cleanCode = req.params.code.trim();
    const event = await Event.findOne({
      $or: [
        { code: { $regex: new RegExp('^' + cleanCode + '$', 'i') } },
        { eventId: cleanCode }
      ]
    }).lean();

    if (!event) return res.status(404).json({ error: 'Event not found.' });
    const expenses = await Expense.find({ eventId: event.eventId }).sort({ createdAt: -1 }).lean();
    event.expenses = expenses.map(x => ({ ...x, id: x.expenseId }));
    event.id = event.eventId;
    res.json({ ok: true, event });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch event.' });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const evt = req.body;
    const newEvent = await Event.create({
      eventId: evt.id,
      code: evt.code,
      name: evt.name,
      dateISO: evt.dateISO,
      dateStr: evt.dateStr || '',
      createdAtFormatted: evt.createdAtFormatted || '',
      dayNum: evt.dayNum || 1,
      monthIndex: evt.monthIndex || 0,
      monthShort: evt.monthShort || 'JAN',
      yearNum: evt.yearNum || 2026,
      iconLetter: evt.iconLetter || evt.name.charAt(0).toUpperCase(),
      createdByUserId: evt.createdByUserId,
      createdByName: evt.createdByName || '',
      members: evt.members || [],
      memberProfiles: evt.memberProfiles || {}
    });
    res.status(201).json({ ok: true, event: newEvent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create event.' });
  }
});

app.post('/api/events/:eventId/join', async (req, res) => {
  try {
    const target = req.params.eventId.trim();
    const { name, upi, pfp, deviceName, deviceId } = req.body;

    const event = await Event.findOne({
      $or: [
        { eventId: target },
        { code: { $regex: new RegExp('^' + target + '$', 'i') } }
      ]
    });
    if (!event) return res.status(404).json({ error: 'Event not found.' });

    const exists = event.members.some(m => m.toLowerCase() === name.toLowerCase());
    if (!exists) {
      event.members.push(name);
    }

    const profiles = { ...(event.memberProfiles || {}) };
    profiles[name] = {
      name,
      upi: upi || '',
      pfp: pfp || '',
      deviceName: deviceName || 'Member Device',
      deviceId: deviceId || ''
    };
    event.memberProfiles = profiles;
    event.markModified('memberProfiles');

    await event.save();
    res.json({ ok: true, event });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join event.' });
  }
});

app.post('/api/events/:eventId/expenses', async (req, res) => {
  try {
    const exp = req.body;
    const newExpense = await Expense.create({
      expenseId: exp.id,
      eventId: req.params.eventId,
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
    res.status(500).json({ error: 'Failed to save expense.' });
  }
});

app.patch('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    const updated = await Expense.findOneAndUpdate(
      { expenseId: req.params.expenseId },
      { cleared: req.body.cleared },
      { new: true }
    );
    res.json({ ok: true, expense: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update.' });
  }
});

app.delete('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    await Expense.findOneAndDelete({ expenseId: req.params.expenseId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete.' });
  }
});

app.post('/api/events/:eventId/settlements', async (req, res) => {
  try {
    const event = await Event.findOne({
      $or: [{ eventId: req.params.eventId }, { code: req.params.eventId }]
    });
    if (!event) return res.status(404).json({ error: 'Event not found.' });

    event.settledTransfers.push({
      id: req.body.id,
      from: req.body.from,
      to: req.body.to,
      amount: req.body.amount,
      method: req.body.method,
      settledByDeviceId: req.body.settledByDeviceId,
      settledAt: new Date()
    });
    await event.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to settle.' });
  }
});

app.post('/api/categories', (req, res) => res.json({ ok: true }));

// ==========================================
// 4. SERVE FRONTEND & SHORT LINKS (/:code)
// ==========================================
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get(['/e/:code', '/:code'], (req, res, next) => {
  const code = req.params.code;
  if (code.includes('.') || code.startsWith('api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✓ Successfully connected to MongoDB Atlas!');
    app.listen(PORT, () => console.log(`🚀 FoldSplit Server running on port ${PORT}`));
  })
  .catch((err) => console.error('Database connection failed:', err.message));