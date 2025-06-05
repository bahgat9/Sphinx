require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// CORS configuration
app.use(cors({
  origin: [
    'https://bahgat9.github.io',
    'https://qr-attendance-8x8iqvpdq-bahgats-projects-6796583a.vercel.app',
    'http://localhost:3000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));

app.use(express.json());

// File-based database setup
const DB_FILE = path.join(__dirname, 'db.json');

// Initialize database file if it doesn't exist
async function initializeDB() {
  try {
    await fs.access(DB_FILE);
    console.log('✅ Database file exists');
  } catch (err) {
    console.log('ℹ️ Creating new database file');
    const initialData = {
      members: [],
      attendance: []
    };
    await fs.writeFile(DB_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Database file created');
  }
}

// Read database
async function readDB() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database:', err);
    throw err;
  }
}

// Write to database
async function writeDB(data) {
  try {
    await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing to database:', err);
    throw err;
  }
}

// Initialize test data
async function initializeTestData() {
  const db = await readDB();
  
  // Add test member if not exists
  const testMemberExists = db.members.some(m => m.name === "Test Member");
  if (!testMemberExists) {
    db.members.push({
      _id: uuidv4(),
      name: "Test Member",
      qrCode: "test-qr-code-123",
      createdAt: new Date().toISOString()
    });
    console.log('✅ Added test member');
  }

  // Add today's attendance if not exists
  const today = new Date().toISOString().split('T')[0];
  const testMember = db.members.find(m => m.name === "Test Member");
  const attendanceExists = db.attendance.some(a => 
    a.memberId === testMember._id && a.date === today
  );
  
  if (!attendanceExists && testMember) {
    db.attendance.push({
      _id: uuidv4(),
      memberId: testMember._id,
      memberName: testMember.name,
      date: today,
      timestamp: new Date().toISOString()
    });
    console.log('✅ Added test attendance record');
  }

  await writeDB(db);
}

// Initialize database
initializeDB().then(initializeTestData);

// API Routes
app.get('/', (req, res) => {
  res.json({
    status: 'API is working',
    endpoints: {
      register: 'POST /api/members',
      markAttendance: 'POST /api/attendance',
      viewAttendance: 'GET /api/attendance/:date',
      listMembers: 'GET /api/members'
    }
  });
});

// Register new member
app.post('/api/members', async (req, res) => {
  try {
    const { name } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Valid name is required' });
    }

    const db = await readDB();
    const newMember = {
      _id: uuidv4(),
      name,
      qrCode: uuidv4(),
      createdAt: new Date().toISOString()
    };
    
    db.members.push(newMember);
    await writeDB(db);
    
    res.status(201).json({
      _id: newMember._id,
      name: newMember.name,
      qrCode: newMember.qrCode,
      createdAt: newMember.createdAt
    });
  } catch (err) {
    console.error('Member registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Mark attendance
app.post('/api/attendance', async (req, res) => {
  try {
    const { qrCode } = req.body;
    
    if (!qrCode) {
      return res.status(400).json({ error: 'QR code is required' });
    }

    const db = await readDB();
    const member = db.members.find(m => m.qrCode === qrCode);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const today = new Date().toISOString().split('T')[0];
    const existing = db.attendance.find(a => 
      a.memberId === member._id && a.date === today
    );

    if (existing) {
      return res.status(200).json({ 
        message: 'Attendance already marked today',
        memberName: member.name
      });
    }

    const newAttendance = {
      _id: uuidv4(),
      memberId: member._id,
      memberName: member.name,
      date: today,
      timestamp: new Date().toISOString()
    };
    
    db.attendance.push(newAttendance);
    await writeDB(db);
    
    res.status(201).json({
      message: 'Attendance recorded',
      memberName: member.name,
      date: today
    });
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ error: 'Failed to mark attendance' });
  }
});

// Get attendance by date
app.get('/api/attendance/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const db = await readDB();
    const records = db.attendance.filter(a => a.date === date);
    
    res.status(200).json(records);
  } catch (err) {
    console.error('Attendance fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Get all members
app.get('/api/members', async (req, res) => {
  try {
    const db = await readDB();
    const members = db.members
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => ({
        _id: m._id,
        name: m.name,
        qrCode: m.qrCode,
        createdAt: m.createdAt
      }));
    
    res.status(200).json(members);
  } catch (err) {
    console.error('Members fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
