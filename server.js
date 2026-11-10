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
// 1. SECURITY & MIDDLEWARE
// ==========================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', apiLimiter);

// ==========================================
// 2. MONGOOSE MODELS
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  pin: { type: String, required: true }, // 4-digit security PIN
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
  createdByUserId: { type: String, required: true },
  createdByName: { type: String, default: '' },
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
// 3. AUTH & USER ROUTES (Username + 4-Digit PIN)
// ==========================================

// Register Account
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, pin, name, upi, pfp, deviceName, deviceId } = req.body;
    if (!username || !pin || pin.length !== 4) {
      return res.status(400).json({ error: 'Valid username and 4-digit PIN required.' });
    }

    const cleanUsername = username.toLowerCase().trim();
    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken.' });
    }

    const newUser = await User.create({
      userId: 'usr_' + cleanUsername + '_' + Date.now().toString(36),
      username: cleanUsername,
      pin,
      name,
      upiId: upi || '',
      pfpUrl: pfp || '',
      deviceName: deviceName || 'Web',
      deviceId: deviceId || 'DEV-ANON'
    });

    res.status(201).json({ ok: true, user: newUser });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed.' });
  }
});

// Login Account
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, pin, deviceName, deviceId } = req.body;
    const cleanUsername = (username || '').toLowerCase().trim();

    const user = await User.findOne({ username: cleanUsername });
    if (!user) {
      return res.status(404).json({ error: 'No account found with this username.' });
    }
    if (user.pin !== pin) {
      return res.status(401).json({ error: 'Incorrect 4-digit PIN.' });
    }

    user.deviceName = deviceName || user.deviceName;
    user.deviceId = deviceId || user.deviceId;
    await user.save();

    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
});

// Update Profile
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
// 4. EVENT & EXPENSE ROUTES (With Cross-Device Sync)
// ==========================================

// Get All Events & Attached Expenses
app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 }).lean();
    for (const evt of events) {
      evt.expenses = await Expense.find({ eventId: evt.eventId }).sort({ createdAt: -1 }).lean();
      evt.id = evt.eventId;
      // Convert Map back to plain object for client JSON
      if (evt.memberProfiles instanceof Map) {
        evt.memberProfiles = Object.fromEntries(evt.memberProfiles);
      }
    }
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load events.' });
  }
});

// Fetch Single Event for Swipe-to-Approve Invite Preview
app.get('/api/events/by-code/:code', async (req, res) => {
  try {
    const event = await Event.findOne({ code: req.params.code }).lean();
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    event.expenses = await Expense.find({ eventId: event.eventId }).sort({ createdAt: -1 }).lean();
    event.id = event.eventId;
    res.json({ ok: true, event });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve event.' });
  }
});

// Create Event
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

// Join Event
app.post('/api/events/:eventId/join', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { name, upi, pfp, deviceName, deviceId } = req.body;
    const event = await Event.findOne({ $or: [{ eventId }, { code: eventId }] });
    if (!event) return res.status(404).json({ error: 'Event not found.' });

    if (!event.members.includes(name)) {
      event.members.push(name);
    }
    if (!event.memberProfiles) event.memberProfiles = new Map();
    event.memberProfiles.set(name, { name, upi: upi || '', pfp: pfp || '', deviceName, deviceId });

    await event.save();
    res.json({ ok: true, event });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join event.' });
  }
});

// Add Expense
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
    res.status(500).json({ error: 'Failed to record expense.' });
  }
});

// Toggle Cleared
app.patch('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    const { expenseId } = req.params;
    const { cleared } = req.body;
    const updated = await Expense.findOneAndUpdate({ expenseId }, { cleared }, { new: true });
    res.json({ ok: true, expense: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update expense.' });
  }
});

// Delete Expense
app.delete('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    await Expense.findOneAndDelete({ expenseId: req.params.expenseId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete expense.' });
  }
});

// Record Settlement
app.post('/api/events/:eventId/settlements', async (req, res) => {
  try {
    const { eventId } = req.params;
    const st = req.body;
    const event = await Event.findOne({ $or: [{ eventId }, { code: eventId }] });
    if (!event) return res.status(404).json({ error: 'Event not found.' });

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
    res.status(500).json({ error: 'Failed settlement.' });
  }
});

app.post('/api/categories', (req, res) => res.json({ ok: true }));

// ==========================================
// 5. SERVE FRONTEND & CLEAN SHARE LINKS
// ==========================================
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/:eventCode', (req, res, next) => {
  if (req.params.eventCode.includes('.') || req.params.eventCode.startsWith('api')) {
    return next();
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ==========================================
// 6. DB CONNECTION & START
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✓ Successfully connected to MongoDB Atlas!');
    app.listen(PORT, () => {
      console.log(`🚀 FoldSplit Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database connection failed:', err.message);
  });