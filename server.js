require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

// CORS Configuration:
// Let vercel.json handle the detailed header specifics for deployment.
// This Express cors setup is good for local development and as a fallback.
app.use(cors({
  origin: [
    'https://bahgat9.github.io', // Your frontend origin
    'https://qr-attendance-8x8iqvpdq-bahgats-projects-6796583a.vercel.app', // Your backend origin
    'http://localhost:3000', // For local frontend development
    'http://localhost:YOUR_LOCAL_FRONTEND_PORT' // If your local frontend runs on a different port
  ],
  credentials: true, // Important for Express to handle credentialed requests
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], // Explicitly list methods
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'] // Explicitly list allowed headers
}));

app.use(express.json());

// Middleware to log all incoming requests to API routes
app.use('/api', (req, res, next) => {
  console.log(`[${new Date().toISOString()}] Received ${req.method} request for ${req.originalUrl}`);
  console.log('Request Headers:', JSON.stringify(req.headers, null, 2));
  // Log body for POST/PUT requests (be careful with sensitive data in production logs)
  if (req.method === 'POST' || req.method === 'PUT') {
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});


// MongoDB Connection with robust error handling
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://BY7:bahgat_88@qr-attendance.nphqruk.mongodb.net/qr-attendance?retryWrites=true&w=majority';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Shortened for quicker feedback on connection issues
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000, // Default is 30000
      maxPoolSize: 10 // Default is 100
    });
    console.log('✅ MongoDB Connected');
    
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    if (!collectionNames.includes('members')) {
      console.log('Collection "members" not found. Attempting to create...');
      await db.createCollection('members');
      console.log('✅ Created members collection');
    }
    
    if (!collectionNames.includes('attendances')) { // Note: your screenshot shows 'attendance' (singular)
      console.log('Collection "attendances" (plural) not found. Your screenshot shows "attendance" (singular). Please verify.');
      // Assuming 'attendances' is what you intend based on schema naming. If it's 'attendance', adjust here and in schema.
      if (!collectionNames.includes('attendance')) {
         await db.createCollection('attendance'); // Changed to 'attendance' to match screenshot
         console.log('✅ Created attendance collection (singular)');
      }
    }
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    // More detailed error logging
    if (err.reason) console.error('MongoDB Connection Error Reason:', err.reason);
    process.exit(1); // Exit if DB connection fails
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

// IMPORTANT: Your screenshot shows the collection as 'attendance' (singular).
// Mongoose by default pluralizes model names for collections (e.g., 'Attendance' model -> 'attendances' collection).
// To match your existing 'attendance' collection, explicitly set the collection name.
const attendanceSchema = new mongoose.Schema({
  memberId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Member', // Refers to the 'Member' model
    required: true,
    index: true
  },
  memberName: { // Denormalized for easier display
    type: String,
    required: true
  },
  date: { // YYYY-MM-DD string
    type: String,
    required: true,
    index: true
  },
  timestamp: { 
    type: Date, 
    default: Date.now 
  }
}, { collection: 'attendance' }); // Explicitly set collection name to 'attendance' (singular)


// Create indexes
memberSchema.index({ qrCode: 1 });
attendanceSchema.index({ memberId: 1, date: 1 }, { unique: true }); // Added unique constraint for a member per day

const Member = mongoose.model('Member', memberSchema); // Collection will be 'members'
const Attendance = mongoose.model('Attendance', attendanceSchema); // Collection will be 'attendance'

async function initializeTestData() {
  try {
    let testMember = await Member.findOne({ name: "Test Member" });
    if (!testMember) {
      testMember = new Member({ name: "Test Member", qrCode: "test-qr-code-123" });
      await testMember.save();
      console.log('✅ Created test member:', testMember.name, testMember.qrCode);
    } else {
      console.log('ℹ️ Test Member already exists.');
    }

    const today = new Date().toISOString().split('T')[0];
    const existingAttendance = await Attendance.findOne({ memberId: testMember._id, date: today });
    if (!existingAttendance) {
      const newAttendance = new Attendance({
        memberId: testMember._id,
        memberName: testMember.name,
        date: today
      });
      await newAttendance.save();
      console.log('✅ Created test attendance record for Test Member for today.');
    } else {
      console.log('ℹ️ Test attendance for Test Member today already exists.');
    }
  } catch (err) {
    console.error('❌ Test data initialization failed:', err.message);
    if (err.code === 11000) {
        console.error('❌ Attempted to insert duplicate data during test init.');
    }
  }
}

async function initializeDatabase() {
  try {
    await connectDB();
    // Only run test data initialization if NOT in production, or based on a specific flag
    if (process.env.NODE_ENV !== 'production') {
        await initializeTestData();
    }
  } catch (err) {
    console.error('❌ Database Initialization failed:', err);
    process.exit(1);
  }
}

initializeDatabase();

// API Routes
app.get('/', (req, res) => {
  console.log(`[${new Date().toISOString()}] Root path / requested from ${req.ip}`);
  res.json({
    status: 'API is working',
    message: 'Welcome to the QR Attendance Tracker API',
    timestamp: new Date().toISOString(),
    endpoints: {
      register: 'POST /api/members',
      markAttendance: 'POST /api/attendance',
      viewAttendanceByDate: 'GET /api/attendance/:date',
      listMembers: 'GET /api/members'
    }
  });
});

app.post('/api/members', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Valid member name is required' });
    }
    // Check if member with this name already exists (optional, depends on requirements)
    // const existingMember = await Member.findOne({ name: name.trim() });
    // if (existingMember) {
    //   return res.status(409).json({ error: 'Member with this name already exists', member: existingMember });
    // }

    const member = new Member({ name: name.trim() }); // qrCode will be auto-generated
    await member.save();
    res.status(201).json({
      _id: member._id,
      name: member.name,
      qrCode: member.qrCode,
      createdAt: member.createdAt
    });
  } catch (err) {
    console.error('Member registration error:', err);
    if (err.code === 11000) { // Duplicate key error (likely qrCode, though default UUIDs make this rare)
      return res.status(409).json({ error: 'A member with this QR code already exists. This is highly unlikely with UUIDs. Please try again.' });
    }
    res.status(500).json({ error: 'Member registration failed due to a server error' });
  }
});

app.post('/api/attendance', async (req, res) => {
  try {
    const { qrCode } = req.body;
    if (!qrCode) {
      return res.status(400).json({ error: 'QR code is required' });
    }

    const member = await Member.findOne({ qrCode });
    if (!member) {
      return res.status(404).json({ error: 'Member not found for the provided QR code' });
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Using findOneAndUpdate with upsert could also work here to simplify
    const existingAttendance = await Attendance.findOne({ memberId: member._id, date: today });

    if (existingAttendance) {
      return res.status(200).json({ // 200 OK is fine, or 208 Already Reported
        message: 'Attendance already marked for this member today',
        memberName: member.name,
        date: today,
        attendanceId: existingAttendance._id
      });
    }

    const attendance = new Attendance({
      memberId: member._id,
      memberName: member.name, // Store member name for convenience
      date: today
    });
    await attendance.save();
    res.status(201).json({
      message: 'Attendance recorded successfully',
      memberName: member.name,
      date: today,
      attendanceId: attendance._id
    });
  } catch (err) {
    console.error('Mark attendance error:', err);
     if (err.code === 11000) {
      return res.status(409).json({ error: 'Attendance conflict. This member might have already been marked present simultaneously.' });
    }
    res.status(500).json({ error: 'Failed to mark attendance due to a server error' });
  }
});

app.get('/api/attendance/:date', async (req, res) => {
  try {
    const { date } = req.params;
    // Validate date format (basic check)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
    }
    const records = await Attendance.find({ date }).populate('memberId', 'name').lean(); // Populate member name
    res.status(200).json(records);
  } catch (err) {
    console.error('Fetch attendance error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance records' });
  }
});

app.get('/api/members', async (req, res) => {
  try {
    const members = await Member.find().sort({ name: 1 }).select('_id name qrCode createdAt').lean();
    res.status(200).json(members);
  } catch (err) {
    console.error('Fetch members error:', err);
    res.status(500).json({ error: 'Failed to fetch members list' });
  }
});

// Global error handling middleware (should be last)
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack || err);
  res.status(500).json({ error: 'An unexpected internal server error occurred.' });
});


const PORT = process.env.PORT || 3000;
// Vercel handles the listening part, so app.listen is mainly for local dev.
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
      console.log(`🚀 Server running locally on port ${PORT}`);
      console.log(`🔗 Frontend should connect to http://localhost:${PORT}`);
    });
}

// Enhanced DB connection monitoring
mongoose.connection.on('connected', () => console.log('🔗 MongoDB re-established connection'));
mongoose.connection.on('error', (err) => console.error('❌ MongoDB runtime connection error:', err));
mongoose.connection.on('disconnected', () => console.warn('⚠️ MongoDB connection disconnected'));
mongoose.connection.on('reconnected', () => console.info('ℹ️ MongoDB reconnected'));
mongoose.connection.on('close', () => console.info('ℹ️ MongoDB connection closed'));


module.exports = app; // Export app for Vercel
