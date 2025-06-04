const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Atlas Connection
mongoose.connect('mongodb+srv://BY7:bahgat_88@qr-attendance.nphqruk.mongodb.net/qr-attendance?retryWrites=true&w=majority')
  .then(() => console.log('Connected to MongoDB Atlas'))
  .catch(err => console.error('Connection error:', err));

// Define Schemas
const memberSchema = new mongoose.Schema({
  name: String,
  qrCode: { type: String, unique: true },
  createdAt: { type: Date, default: Date.now }
});

const attendanceSchema = new mongoose.Schema({
  memberId: mongoose.Schema.Types.ObjectId,
  memberName: String,
  date: { type: String, default: () => new Date().toISOString().split('T')[0] },
  timestamp: { type: Date, default: Date.now }
});

const Member = mongoose.model('Member', memberSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// API Routes
app.post('/api/members', async (req, res) => {
  try {
    const { name, qrCode } = req.body;
    const member = new Member({ name, qrCode });
    await member.save();
    res.json(member);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/attendance', async (req, res) => {
  try {
    const { qrCode } = req.body;
    const member = await Member.findOne({ qrCode });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    // Check if already attended today
    const today = new Date().toISOString().split('T')[0];
    const existing = await Attendance.findOne({ 
      memberId: member._id, 
      date: today 
    });
    
    if (existing) {
      return res.status(400).json({ 
        error: 'Already attended today',
        memberName: member.name
      });
    }

    const attendance = new Attendance({
      memberId: member._id,
      memberName: member.name,
      date: today
    });
    
    await attendance.save();
    res.json({ 
      message: 'Attendance recorded',
      memberName: member.name
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/attendance/:date', async (req, res) => {
  try {
    const records = await Attendance.find({ date: req.params.date });
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/members', async (req, res) => {
  try {
    const members = await Member.find().sort({ name: 1 });
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));