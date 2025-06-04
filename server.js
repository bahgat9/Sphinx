require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Enhanced CORS configuration
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

// MongoDB Connection with robust error handling
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://BY7:bahgat_88@qr-attendance.nphqruk.mongodb.net/qr-attendance?retryWrites=true&w=majority';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10
    });
    console.log('✅ MongoDB Connected');
    
    // Verify collections exist
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    if (!collectionNames.includes('members')) {
      await db.createCollection('members');
      console.log('✅ Created members collection');
    }
    
    if (!collectionNames.includes('attendance')) {
      await db.createCollection('attendance');
      console.log('✅ Created attendance collection');
    }
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  }
}

// Database Schemas
const memberSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters']
  },
  qrCode: { 
    type: String, 
    required: true,
    unique: true,
    default: () => uuidv4()
  },
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true 
  }
});

const attendanceSchema = new mongoose.Schema({
  memberId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Member',
    required: true,
    index: true
  },
  memberName: {
    type: String,
    required: true
  },
  date: {
    type: String,
    required: true,
    index: true
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  }
});

// Create indexes
memberSchema.index({ qrCode: 1 });
attendanceSchema.index({ memberId: 1, date: 1 });

const Member = mongoose.model('Member', memberSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// =============================================
// NEW CODE: Automatic Test Data Initialization
// =============================================
async function initializeTestData() {
  try {
    // 1. Ensure test member exists
    let testMember = await Member.findOne({ name: "Test Member" });
    
    if (!testMember) {
      testMember = new Member({
        name: "Test Member",
        qrCode: "test-qr-code-123" // Fixed QR code for testing
      });
      await testMember.save();
      console.log('✅ Created test member:', testMember);
    }

    // 2. Create today's attendance record if it doesn't exist
    const today = new Date().toISOString().split('T')[0];
    const existingAttendance = await Attendance.findOne({
      memberId: testMember._id,
      date: today
    });

    if (!existingAttendance) {
      const newAttendance = new Attendance({
        memberId: testMember._id,
        memberName: testMember.name,
        date: today
      });
      await newAttendance.save();
      console.log('✅ Created test attendance record:', newAttendance);
    }

    // 3. Verify data exists
    const memberCount = await Member.countDocuments();
    const attendanceCount = await Attendance.countDocuments();
    console.log(`📊 Current stats: ${memberCount} members, ${attendanceCount} attendance records`);

  } catch (err) {
    console.error('❌ Test data initialization failed:', err.message);
  }
}

// =============================================
// Modified DB Connection Handler
// =============================================
async function initializeDatabase() {
  try {
    await connectDB();
    await initializeTestData();
  } catch (err) {
    console.error('❌ Initialization failed:', err);
    process.exit(1);
  }
}

// Initialize database when starting
initializeDatabase();

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

    const member = new Member({ name });
    await member.save();
    
    res.status(201).json({
      _id: member._id,
      name: member.name,
      qrCode: member.qrCode,
      createdAt: member.createdAt
    });
  } catch (err) {
    console.error('Member registration error:', err);
    res.status(500).json({ 
      error: err.code === 11000 ? 'Duplicate QR code' : 'Registration failed' 
    });
  }
});

// Mark attendance
app.post('/api/attendance', async (req, res) => {
  try {
    const { qrCode } = req.body;
    
    if (!qrCode) {
      return res.status(400).json({ error: 'QR code is required' });
    }

    const member = await Member.findOne({ qrCode });
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const today = new Date().toISOString().split('T')[0];
    const existing = await Attendance.findOne({ 
      memberId: member._id, 
      date: today 
    });

    if (existing) {
      return res.status(200).json({ 
        message: 'Attendance already marked today',
        memberName: member.name
      });
    }

    const attendance = new Attendance({
      memberId: member._id,
      memberName: member.name,
      date: today
    });
    
    await attendance.save();
    
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
    const records = await Attendance.find({ date }).lean();
    
    res.status(200).json(records);
  } catch (err) {
    console.error('Attendance fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Get all members
app.get('/api/members', async (req, res) => {
  try {
    const members = await Member.find()
      .sort({ name: 1 })
      .select('name qrCode createdAt')
      .lean();
    
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
  console.log(`🔗 CORS-enabled for: 
  - https://bahgat9.github.io
  - https://qr-attendance-8x8iqvpdq-bahgats-projects-6796583a.vercel.app`);
});

// Enhanced DB connection monitoring
mongoose.connection.on('connected', () => {
  console.log('🔗 MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB connection disconnected');
});
