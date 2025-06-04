require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

// CORS Configuration:
// Rely primarily on vercel.json for deployed CORS headers.
// This Express cors setup is for local development and as a comprehensive fallback.
app.use(cors({
  origin: [
    'https://bahgat9.github.io', // Your frontend origin
    'https://qr-attendance-8x8iqvpdq-bahgats-projects-6796583a.vercel.app', // Your backend origin
    'http://localhost:3000', // For local server development
    // Add your local frontend development URL if different, e.g., http://localhost:5173 for Vite
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Middleware to parse JSON bodies. CRITICAL: This must come before your routes.
app.use(express.json());

// Middleware to log all incoming requests to API routes
app.use('/api', (req, res, next) => {
  console.log(`[${new Date().toISOString()}] SERVER: Received ${req.method} request for ${req.originalUrl}`);
  console.log(`[${new Date().toISOString()}] SERVER: Request Headers: ${JSON.stringify(req.headers)}`);
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    console.log(`[${new Date().toISOString()}] SERVER: Request Body: ${JSON.stringify(req.body)}`);
  }
  next();
});


// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error("FATAL ERROR: MONGODB_URI is not defined in .env or environment variables.");
    process.exit(1);
}

async function connectDB() {
  try {
    console.log("SERVER: Attempting to connect to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 7000, // Increased slightly
      socketTimeoutMS: 45000,
      connectTimeoutMS: 20000,
      maxPoolSize: 10
    });
    console.log('SERVER: ✅ MongoDB Connected Successfully.');

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    console.log('SERVER: Existing collections:', collectionNames.join(', '));

    if (!collectionNames.includes('members')) {
      console.log('SERVER: Collection "members" not found. Creating...');
      await db.createCollection('members');
      console.log('SERVER: ✅ Created "members" collection.');
    }
    // Your screenshot shows 'attendance' (singular)
    if (!collectionNames.includes('attendance')) {
      console.log('SERVER: Collection "attendance" (singular) not found. Creating...');
      await db.createCollection('attendance');
      console.log('SERVER: ✅ Created "attendance" collection.');
    }
  } catch (err) {
    console.error('SERVER: ❌ MongoDB Connection Error:', err.message);
    if (err.reason) console.error('SERVER: MongoDB Connection Error Reason:', JSON.stringify(err.reason, null, 2));
    // Do not exit process here for serverless, let Vercel handle function errors.
    // process.exit(1); // This is fine for local, but can be problematic for serverless retries.
    throw err; // Re-throw to be caught by Vercel or a higher-level handler
  }
}

// Database Schemas
const memberSchema = new mongoose.Schema({
  name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: [100, 'Name cannot exceed 100 characters'] },
  qrCode: { type: String, required: true, unique: true, default: () => uuidv4() },
  createdAt: { type: Date, default: Date.now, index: true }
});

const attendanceSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true, index: true },
  memberName: { type: String, required: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  timestamp: { type: Date, default: Date.now }
}, { collection: 'attendance' }); // Explicitly set collection name

memberSchema.index({ qrCode: 1 });
// Unique constraint for a member's attendance per day
attendanceSchema.index({ memberId: 1, date: 1 }, { unique: true });

const Member = mongoose.model('Member', memberSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

async function initializeDatabaseAndApp() {
    try {
        await connectDB(); // Ensure DB is connected before routes are active
        // Test data initialization (optional, consider if needed for every startup)
        if (process.env.NODE_ENV !== 'production') {
            // await initializeTestData(); // You can define this function if needed
        }
    } catch (error) {
        console.error("SERVER: Failed to initialize database for the app:", error);
        // If DB connection fails, API routes might still be set up but will fail.
        // For serverless, the function might error out on first request if DB is down.
    }
}

// Call initialization. For serverless, this runs when the function instance starts.
initializeDatabaseAndApp();


// API Routes
app.get('/', (req, res) => {
  res.status(200).json({ status: 'API is healthy and running', timestamp: new Date().toISOString() });
});

// Register new member
app.post('/api/members', async (req, res) => {
  console.log(`[${new Date().toISOString()}] SERVER: /api/members POST route invoked.`);
  try {
    const { name } = req.body;
    console.log(`[${new Date().toISOString()}] SERVER: Received name for registration: "${name}"`);

    if (!name || typeof name !== 'string' || name.trim() === '') {
      console.log(`[${new Date().toISOString()}] SERVER: Validation failed: Name is invalid.`);
      return res.status(400).json({ error: 'Valid member name is required' });
    }

    const trimmedName = name.trim();
    console.log(`[${new Date().toISOString()}] SERVER: Attempting to create new Member with name: "${trimmedName}"`);
    
    const newMember = new Member({ name: trimmedName });
    // qrCode will be auto-generated by schema default

    console.log(`[${new Date().toISOString()}] SERVER: New member object created (before save): ${JSON.stringify(newMember)}`);
    
    await newMember.save();
    console.log(`[${new Date().toISOString()}] SERVER: Member saved successfully. ID: ${newMember._id}, QR: ${newMember.qrCode}`);

    res.status(201).json({
      _id: newMember._id.toString(), // Ensure _id is a string
      name: newMember.name,
      qrCode: newMember.qrCode,
      createdAt: newMember.createdAt
    });

  } catch (err) {
    console.error(`[${new Date().toISOString()}] SERVER: ERROR in /api/members:`, err.message);
    console.error(`[${new Date().toISOString()}] SERVER: Error stack:`, err.stack);
    
    if (err.code === 11000) { // MongoDB duplicate key error
      console.error(`[${new Date().toISOString()}] SERVER: Duplicate key error (likely qrCode).`);
      return res.status(409).json({ error: 'Duplicate data error. This QR code might already exist (highly unlikely with UUIDs). Please try again or contact support.' });
    }
    if (err.name === 'ValidationError') {
      console.error(`[${new Date().toISOString()}] SERVER: Mongoose validation error.`);
      return res.status(400).json({ error: 'Validation failed.', details: err.errors });
    }
    // Generic server error
    res.status(500).json({ error: 'Member registration failed due to an internal server error. Please check server logs.' });
  }
});

// Mark attendance
app.post('/api/attendance', async (req, res) => {
  console.log(`[${new Date().toISOString()}] SERVER: /api/attendance POST route invoked.`);
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
    const existingAttendance = await Attendance.findOne({ memberId: member._id, date: today });

    if (existingAttendance) {
      return res.status(200).json({
        message: 'Attendance already marked for this member today',
        memberName: member.name,
        date: today,
        attendanceId: existingAttendance._id.toString()
      });
    }

    const attendance = new Attendance({ memberId: member._id, memberName: member.name, date: today });
    await attendance.save();
    res.status(201).json({
      message: 'Attendance recorded successfully',
      memberName: member.name,
      date: today,
      attendanceId: attendance._id.toString()
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] SERVER: ERROR in /api/attendance:`, err.message);
    if (err.code === 11000) { // Unique constraint (memberId, date) violated
        return res.status(409).json({ error: 'Attendance conflict. This member has already been marked present today (simultaneous request likely).' });
    }
    res.status(500).json({ error: 'Failed to mark attendance due to a server error.' });
  }
});

// Get attendance by date
app.get('/api/attendance/:date', async (req, res) => {
  console.log(`[${new Date().toISOString()}] SERVER: /api/attendance/:date GET route invoked for date: ${req.params.date}.`);
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
    }
    // Populate memberId to get member's name, select only name and _id from member
    const records = await Attendance.find({ date })
                                    .populate({ path: 'memberId', select: 'name _id' })
                                    .lean(); // .lean() for plain JS objects
    res.status(200).json(records);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] SERVER: ERROR in /api/attendance/:date:`, err.message);
    res.status(500).json({ error: 'Failed to fetch attendance records.' });
  }
});

// Get all members
app.get('/api/members', async (req, res) => {
  console.log(`[${new Date().toISOString()}] SERVER: /api/members GET route invoked.`);
  try {
    const members = await Member.find().sort({ name: 1 }).select('_id name qrCode createdAt').lean();
    res.status(200).json(members);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] SERVER: ERROR in /api/members GET:`, err.message);
    res.status(500).json({ error: 'Failed to fetch members list.' });
  }
});

// Global error handling middleware (catches errors from next(err) or unhandled sync errors in routes)
// This should be defined AFTER all other app.use() and routes
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] SERVER: UNHANDLED ERROR MIDDLEWARE TRIGGERED:`, err.message);
  console.error(err.stack);
  // Avoid sending stack trace to client in production
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: 'An unexpected internal server error occurred.',
    message: process.env.NODE_ENV === 'production' ? 'Please contact support.' : err.message 
  });
});

// For Vercel, you export the app. Vercel handles the listening.
// The app.listen block is for local development.
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log(`SERVER: 🚀 Local server running on port ${PORT}`);
    });
}

module.exports = app;
