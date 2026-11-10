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
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1500,
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
  iconLetter: { type: String, default: '🎉' },
  coverType: { type: String, default: 'emoji' },
  coverValue: { type: String, default: '🎉' },
  createdByUserId: { type: String, required: true },
  createdByName: { type: String, default: '' },
  createdByUsername: { type: String, default: '' },
  members: [{ type: String }],
  memberUsernames: [{ type: String }],
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
  eventCode: { type: String, default: '', index: true },
  title: { type: String, required: true },
  category: { type: String, required: true },
  categoryColor: { type: String, default: '' },
  amount: { type: Number, required: true },
  paidBy: { type: String, required: true },
  method: { type: String, default: 'UPI' },
  participants: [{ type: String }],
  cleared: { type: Boolean, default: false },
  note: { type: String, default: '' },
  createdBy: { type: String, required: true },
  createdByUserId: { type: String, required: true },
  createdByPfp: { type: String, default: '' },
  deviceUsed: { type: String, default: '' },
  deviceId: { type: String, default: '' },
  timeStr: { type: String, default: '' },
  dateFormatted: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}));

async function findEventByIdOrCode(identifier) {
  if (!identifier) return null;
  const clean = identifier.trim();
  return Event.findOne({
    $or: [
      { eventId: clean },
      { code: { $regex: new RegExp('^' + clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }
    ]
  });
}

async function hydrateEvent(evtDoc) {
  const evt = evtDoc.toObject ? evtDoc.toObject() : { ...evtDoc };
  const expenses = await Expense.find({
    $or: [{ eventId: evt.eventId }, { eventId: evt.code }, { eventCode: evt.code }]
  }).sort({ createdAt: -1 }).lean();

  evt.expenses = expenses.map(x => ({ ...x, id: x.expenseId }));
  evt.id = evt.eventId;
  evt.memberProfiles = evt.memberProfiles || {};
  evt.members = evt.members || [];
  evt.memberUsernames = evt.memberUsernames || [];
  return evt;
}

// ==========================================
// 2. AUTH & PROFILE ROUTES
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, pin, name, upi, pfp, deviceName, deviceId } = req.body;
    if (!username || !pin || String(pin).length !== 4) {
      return res.status(400).json({ error: 'Valid username and 4-digit PIN required.' });
    }
    const cleanUsername = username.toLowerCase().trim().replace(/^@/, '');
    const existing = await User.findOne({ username: cleanUsername });
    if (existing) {
      return res.status(409).json({ error: 'Username already taken. Please log in.' });
    }
    const cleanName = (name || cleanUsername).trim();
    const user = await User.create({
      userId: 'usr_' + cleanUsername + '_' + Date.now().toString(36),
      username: cleanUsername,
      pin: String(pin).trim(),
      name: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
      upiId: (upi || '').trim(),
      pfpUrl: pfp || '',
      deviceName: deviceName || deviceId || 'DEV-WEB',
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
    const cleanUsername = (username || '').toLowerCase().trim().replace(/^@/, '');
    const user = await User.findOne({ username: cleanUsername });
    if (!user) return res.status(404).json({ error: 'Account not found. Create an account first.' });
    if (user.pin !== String(pin).trim()) return res.status(401).json({ error: 'Incorrect 4-digit PIN.' });

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

// Update Profile + Retroactively Update PFP & UPI Across All Past Events and Transactions
app.post('/api/users/profile', async (req, res) => {
  try {
    const { id, username, name, upi, pfp, deviceName, deviceId } = req.body;
    const query = id ? { userId: id } : { username: (username || '').toLowerCase() };
    const user = await User.findOneAndUpdate(
      query,
      { name, upiId: upi || '', pfpUrl: pfp || '', deviceName, deviceId },
      { new: true }
    );

    if (user) {
      // 1. Update user's profile inside every event they are part of
      const allEvents = await Event.find();
      for (const evt of allEvents) {
        let modified = false;
        const profiles = { ...(evt.memberProfiles || {}) };

        for (const key of Object.keys(profiles)) {
          const mp = profiles[key];
          if (
            key.toLowerCase() === user.name.toLowerCase() ||
            (mp && mp.userId === user.userId) ||
            (mp && mp.username && mp.username.toLowerCase() === user.username.toLowerCase())
          ) {
            profiles[key] = {
              ...mp,
              userId: user.userId,
              username: user.username,
              name: user.name,
              upi: user.upiId,
              pfp: user.pfpUrl,
              deviceName: user.deviceName,
              deviceId: user.deviceId
            };
            modified = true;
          }
        }

        if (evt.members.some(m => m.toLowerCase() === user.name.toLowerCase()) && !profiles[user.name]) {
          profiles[user.name] = {
            userId: user.userId,
            username: user.username,
            name: user.name,
            upi: user.upiId,
            pfp: user.pfpUrl,
            deviceName: user.deviceName,
            deviceId: user.deviceId
          };
          modified = true;
        }

        if (modified) {
          evt.memberProfiles = profiles;
          evt.markModified('memberProfiles');
          await evt.save();
        }
      }

      // 2. Retroactively update PFP on all past and current expenses created by this user
      if (pfp) {
        await Expense.updateMany(
          {
            $or: [
              { createdByUserId: user.userId },
              { createdBy: { $regex: new RegExp('^' + user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }
            ]
          },
          { $set: { createdByPfp: user.pfpUrl } }
        );
      }
    }

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
    const rawEvents = await Event.find().sort({ createdAt: -1 });
    const events = [];
    for (const evtDoc of rawEvents) {
      events.push(await hydrateEvent(evtDoc));
    }
    res.json({ ok: true, events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load events.' });
  }
});

app.get('/api/events/by-code/:code', async (req, res) => {
  try {
    const evtDoc = await findEventByIdOrCode(req.params.code);
    if (!evtDoc) return res.status(404).json({ error: 'Event not found.' });
    res.json({ ok: true, event: await hydrateEvent(evtDoc) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch event.' });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const evt = req.body;
    const creatorName = (evt.createdByName || (evt.members && evt.members[0]) || 'Host').trim();
    const creatorUsername = (evt.createdByUsername || '').toLowerCase().trim();
    const initialProfiles = evt.memberProfiles || {};
    if (initialProfiles[creatorName] && creatorUsername) {
      initialProfiles[creatorName].username = creatorUsername;
    }

    const newEventDoc = await Event.create({
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
      coverType: evt.coverType || 'emoji',
      coverValue: evt.coverValue || '🎉',
      createdByUserId: evt.createdByUserId,
      createdByName: creatorName,
      createdByUsername: creatorUsername,
      members: [creatorName],
      memberUsernames: creatorUsername ? [creatorUsername] : [],
      memberProfiles: initialProfiles
    });

    res.status(201).json({ ok: true, event: await hydrateEvent(newEventDoc) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create event.' });
  }
});

// Delete Event & Associated Expenses
app.delete('/api/events/:eventId', async (req, res) => {
  try {
    const eventDoc = await findEventByIdOrCode(req.params.eventId);
    if (!eventDoc) return res.status(404).json({ error: 'Event not found.' });

    await Expense.deleteMany({
      $or: [
        { eventId: eventDoc.eventId },
        { eventId: eventDoc.code },
        { eventCode: eventDoc.code }
      ]
    });
    await Event.deleteOne({ _id: eventDoc._id });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete event.' });
  }
});

app.post('/api/events/:eventId/join', async (req, res) => {
  try {
    const eventDoc = await findEventByIdOrCode(req.params.eventId);
    if (!eventDoc) return res.status(404).json({ error: 'Event not found.' });

    const rawName = (req.body.name || '').trim();
    const cleanUsername = (req.body.username || '').toLowerCase().trim().replace(/^@/, '');
    const userId = req.body.userId || '';
    const upi = (req.body.upi || '').trim();
    const pfp = req.body.pfp || '';
    const deviceName = req.body.deviceName || req.body.deviceId || 'DEV-MEMBER';
    const deviceId = req.body.deviceId || '';

    if (!rawName) return res.status(400).json({ error: 'Participant name required.' });

    let canonicalName = rawName;
    const existingMember = eventDoc.members.find(m => m.toLowerCase() === rawName.toLowerCase());
    if (existingMember) {
      canonicalName = existingMember;
    } else {
      eventDoc.members.push(canonicalName);
    }

    if (cleanUsername && !eventDoc.memberUsernames.includes(cleanUsername)) {
      eventDoc.memberUsernames.push(cleanUsername);
    }

    const updatedProfiles = { ...(eventDoc.memberProfiles || {}) };
    updatedProfiles[canonicalName] = {
      userId,
      username: cleanUsername,
      name: canonicalName,
      upi,
      pfp,
      deviceName,
      deviceId,
      joinedAt: new Date().toISOString()
    };

    eventDoc.memberProfiles = updatedProfiles;
    eventDoc.markModified('members');
    eventDoc.markModified('memberUsernames');
    eventDoc.markModified('memberProfiles');
    await eventDoc.save();

    res.json({ ok: true, event: await hydrateEvent(eventDoc) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join event.' });
  }
});

app.post('/api/events/:eventId/expenses', async (req, res) => {
  try {
    const eventDoc = await findEventByIdOrCode(req.params.eventId);
    if (!eventDoc) return res.status(404).json({ error: 'Event not found.' });

    const exp = req.body;
    const newExpense = await Expense.create({
      expenseId: exp.id || ('exp_' + Date.now()),
      eventId: eventDoc.eventId,
      eventCode: eventDoc.code,
      title: exp.title,
      category: exp.category,
      categoryColor: exp.categoryColor || '',
      amount: Number(exp.amount),
      paidBy: exp.paidBy,
      method: exp.method || 'UPI',
      participants: Array.isArray(exp.participants) ? exp.participants : eventDoc.members,
      cleared: false,
      note: exp.note || '',
      createdBy: exp.createdBy,
      createdByUserId: exp.createdByUserId,
      createdByPfp: exp.createdByPfp || '',
      deviceUsed: exp.deviceUsed || '',
      deviceId: exp.deviceId || '',
      timeStr: exp.timeStr || '',
      dateFormatted: exp.dateFormatted || ''
    });

    res.status(201).json({ ok: true, expense: { ...newExpense.toObject(), id: newExpense.expenseId } });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save expense.' });
  }
});

app.patch('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    const updateFields = {};
    if (typeof req.body.cleared === 'boolean') updateFields.cleared = req.body.cleared;
    if (typeof req.body.note === 'string') updateFields.note = req.body.note;
    if (typeof req.body.title === 'string') updateFields.title = req.body.title;

    const updated = await Expense.findOneAndUpdate(
      { expenseId: req.params.expenseId },
      { $set: updateFields },
      { new: true }
    );
    res.json({ ok: true, expense: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update expense.' });
  }
});

app.delete('/api/events/:eventId/expenses/:expenseId', async (req, res) => {
  try {
    await Expense.findOneAndDelete({ expenseId: req.params.expenseId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete expense.' });
  }
});

app.post('/api/events/:eventId/settlements', async (req, res) => {
  try {
    const eventDoc = await findEventByIdOrCode(req.params.eventId);
    if (!eventDoc) return res.status(404).json({ error: 'Event not found.' });

    eventDoc.settledTransfers.push({
      id: req.body.id || ('st_' + Date.now()),
      from: req.body.from,
      to: req.body.to,
      amount: Number(req.body.amount),
      method: req.body.method || 'UPI',
      settledByDeviceId: req.body.settledByDeviceId,
      settledAt: new Date()
    });
    eventDoc.markModified('settledTransfers');
    await eventDoc.save();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to settle.' });
  }
});

app.post('/api/categories', (req, res) => res.json({ ok: true }));

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get(['/e/:code', '/:code'], (req, res, next) => {
  const code = req.params.code;
  if (code.includes('.') || code.startsWith('api')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✓ Connected to MongoDB Atlas');
    app.listen(PORT, () => console.log(`🚀 FoldSplit running on port ${PORT}`));
  })
  .catch((err) => console.error('DB error:', err.message));