require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// --- VERY EARLY LOGGING ---
console.log('Server.js script started. Timestamp:', new Date().toISOString());
console.log('NODE_ENV:', process.env.NODE_ENV);
// --- END VERY EARLY LOGGING ---

const app = express();

// --- CORS Configuration ---
// This needs to be one of the VERY FIRST middleware.
const allowedOrigins = [
  'https://bahgat9.github.io',
  'https://qr-attendance-8x8iqvpdq-bahgats-projects-6796583a.vercel.app', // Your Vercel app
  'http://localhost:3000' // For local development
];

const corsOptions = {
  origin: function (origin, callback) {
    // Log the origin for every request (including preflight OPTIONS)
    console.log(`CORS Check: Request origin: ${origin}`);
    if (!origin || allowedOrigins.includes(origin)) {
      console.log(`CORS Check: Origin allowed: ${origin || 'No Origin (Server-to-server or curl?)'}`);
      callback(null, true); // Allow this origin
    } else {
      console.error(`CORS Check: Origin blocked: ${origin}`);
      callback(new Error('Not allowed by CORS')); // Block this origin
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // Ensure OPTIONS is listed
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
  optionsSuccessStatus: 204 // For legacy browser compatibility, and standard for OPTIONS
};

// Apply CORS middleware globally
app.use(cors(corsOptions));
console.log('CORS middleware configured and applied.');
// --- END CORS Configuration ---


// Body parser middleware - MUST come AFTER CORS, but before route handlers
app.use(express.json());
console.log('Express.json middleware applied.');


// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('FATAL ERROR: MONGODB_URI is not defined in environment variables.');
  // process.exit(1); // Optional: exit if DB URI is missing, but Vercel might retry
} else {
  console.log('MONGODB_URI found.');
}

async function connectDB() {
  try {
    console.log('Attempting MongoDB connection...');
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000, // Increased for Vercel cold starts
      socketTimeoutMS: 45000,
      connectTimeoutMS: 20000,
      maxPoolSize: 10
    });
    console.log('✅ MongoDB Connected Successfully.');
    
    // Optional: Log available collections after connection
    // const db = mongoose.connection.db;
    // const collections = await db.listCollections().toArray();
    // console.log('Available collections:', collections.map(c => c.name));

  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    console.error('Full MongoDB error object:', err);
    // Consider not exiting on initial connect error in serverless, let requests fail
  }
}
// Call connectDB early. If it fails, API routes will still be defined but DB ops will fail.
connectDB();

mongoose.connection.on('error', err => {
  console.error('❌ MongoDB runtime error after initial connection:', err.message);
});
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected.');
});
mongoose.connection.on('reconnected', () => {
  console.info('🔄 MongoDB reconnected.');
});


// --- Schemas ---
const memberSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  qrCode: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});
const Member = mongoose.model('Member', memberSchema);

const attendanceSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  memberName: { type: String, required: true },
  date: { type: String, required: true }, // YYYY-MM-DD
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['PRESENT', 'ABSENT'], default: 'PRESENT' }
});
attendanceSchema.index({ date: 1, memberId: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
const Attendance = mongoose.model('Attendance', attendanceSchema);
console.log('Mongoose schemas and models defined.');
// --- End Schemas ---


// --- API Routes ---
console.log('Defining API routes...');

// Root endpoint
app.get('/', (req, res) => {
  console.log(`GET / request from origin: ${req.headers.origin}`);
  res.status(200).send('QR Attendance API is alive. Timestamp: ' + new Date().toISOString());
});

// Register a new member
app.post('/api/members', async (req, res) => {
  console.log(`POST /api/members request from origin: ${req.headers.origin}, body:`, req.body);
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      console.log('Validation error: Name is required.');
      return res.status(400).json({ error: 'Name is required.' });
    }

    const trimmedName = name.trim();
    const existingMember = await Member.findOne({ name: trimmedName });
    if (existingMember) {
      console.log(`Member already exists: ${trimmedName}`);
      return res.status(409).json({ error: 'Member with this name already exists.' });
    }

    const qrCodeData = trimmedName; // Using name as QR data
    const newMember = new Member({ name: trimmedName, qrCode: qrCodeData });
    await newMember.save();
    console.log('Member registered successfully:', newMember);
    res.status(201).json({ message: 'Member registered successfully', member: newMember });
  } catch (err) {
    console.error('Error registering member:', err);
    if (err.code === 11000) {
        return res.status(409).json({ error: 'Member with this name or QR code data already exists (DB constraint).' });
    }
    res.status(500).json({ error: 'Server error registering member: ' + err.message });
  }
});

// Record attendance
app.post('/api/attendance', async (req, res) => {
  console.log(`POST /api/attendance request from origin: ${req.headers.origin}, body:`, req.body);
  try {
    const { qrCodeData, date } = req.body;
    if (!qrCodeData || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Valid QR code data (member name) and date (YYYY-MM-DD) are required.' });
    }

    const member = await Member.findOne({ qrCode: qrCodeData });
    if (!member) {
      return res.status(404).json({ error: 'Member not found for the scanned QR code.' });
    }

    const existingAttendance = await Attendance.findOne({ memberId: member._id, date });
    if (existingAttendance) {
      return res.status(409).json({ message: 'Attendance already recorded for this member today.', attendance: existingAttendance });
    }

    const newAttendance = new Attendance({
      memberId: member._id,
      memberName: member.name,
      date: date,
      status: 'PRESENT'
    });
    await newAttendance.save();
    console.log('Attendance recorded:', newAttendance);
    res.status(201).json({ message: 'Attendance recorded successfully', attendance: newAttendance });
  } catch (err) {
    console.error('Error recording attendance:', err);
    res.status(500).json({ error: 'Server error recording attendance: ' + err.message });
  }
});

// Get attendance for a specific date (includes absent members)
app.get('/api/attendance/:date', async (req, res) => {
  console.log(`GET /api/attendance/${req.params.date} request from origin: ${req.headers.origin}`);
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
    }
    const presentRecords = await Attendance.find({ date }).populate('memberId', 'name').lean();
    const allMembers = await Member.find().select('_id name').lean();
    
    const presentMemberIds = new Set(presentRecords.map(r => r.memberId._id.toString()));

    const attendanceList = allMembers.map(member => {
        const isPresent = presentMemberIds.has(member._id.toString());
        if (isPresent) {
            const record = presentRecords.find(r => r.memberId._id.toString() === member._id.toString());
            return { ...record, memberName: member.name, status: 'PRESENT' }; // Ensure memberName from Member doc
        } else {
            return {
                // memberId: member._id, // This will be just the ID
                memberId: { _id: member._id, name: member.name }, // Structure like populated for consistency
                memberName: member.name,
                date: date,
                status: 'ABSENT'
            };
        }
    });
    
    console.log(`Found ${attendanceList.length} total records (including absent) for date: ${date}`);
    res.status(200).json(attendanceList);
  } catch (err) {
    console.error('Attendance fetch error:', err);
    res.status(500).json({ error: 'Server error fetching attendance: ' + err.message });
  }
});

// Get all members
app.get('/api/members', async (req, res) => {
  console.log(`GET /api/members request from origin: ${req.headers.origin}`);
  try {
    const members = await Member.find().sort({ name: 1 }).select('name qrCode createdAt').lean();
    console.log(`Fetched ${members.length} members.`);
    res.status(200).json(members);
  } catch (err) {
    console.error('Members fetch error:', err);
    res.status(500).json({ error: 'Server error fetching members: ' + err.message });
  }
});
console.log('API routes defined.');
// --- End API Routes ---


// --- Global Error Handling Middleware ---
// This MUST be the last middleware.
app.use((err, req, res, next) => {
  console.error('--- Global Error Handler Triggered ---');
  console.error(`Error for ${req.method} ${req.url}:`, err.message);
  console.error('Error stack:', err.stack);
  
  // If the error is from CORS (e.g., origin not allowed)
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Not allowed by CORS policy.' });
  }

  if (res.headersSent) {
    console.error('Headers already sent, delegating to default Express error handler.');
    return next(err);
  }
  
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error. Please check server logs.'
  });
});
console.log('Global error handler defined.');
// --- End Global Error Handling Middleware ---

// Export the app for Vercel
module.exports = app;
console.log('Server.js script finished initial execution. App exported.');

// Note: app.listen() is not needed for Vercel; Vercel handles invoking the serverless function.
// const PORT = process.env.PORT || 3000;
// if (process.env.NODE_ENV !== 'test') {
//     app.listen(PORT, () => {
//       console.log(`🚀 Server running on port ${PORT}`);
//     });
// }
