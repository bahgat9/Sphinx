require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); // Still useful for main requests
const { v4: uuidv4 } = require('uuid');

const app = express();

// --- START URGENT CORS FIX ---
// Explicitly handle OPTIONS requests globally. This should be the first or among the first middleware.
app.options('*', (req, res) => {
  // Log incoming OPTIONS request for debugging in Vercel logs
  console.log(`Received OPTIONS request for: ${req.url} from origin: ${req.headers.origin}`);
  
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://bahgat9.github.io',
    'https://qr-attendance-8x8iqvpdq-bahgats-projects-6796583a.vercel.app', // Your Vercel app origin
    'http://localhost:3000' // For local development
  ];

  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    console.log(`OPTIONS: Set Access-Control-Allow-Origin to: ${origin}`);
  } else {
    console.log(`OPTIONS: Origin ${origin} not in allowedOrigins.`);
    // Even if not in allowedOrigins, for OPTIONS, some servers might still send generic headers
    // or let the main cors handler decide. For now, we only set ACAO if origin is allowed.
    // If issues persist, you might need to always set ACAO to a default or '*' if appropriate,
    // but specific origin is best practice with credentials.
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE'); // Be generous with methods
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin'); // Common headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Respond with 204 No Content for OPTIONS, which is standard.
  // This tells the browser the preflight check is successful.
  res.status(204).send();
});

// General CORS middleware for all other requests (GET, POST, etc.)
// This will apply after the OPTIONS request has been successfully handled.
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://bahgat9.github.io',
      'https://qr-attendance-8x8iqvpdq-bahgats-projects-6796583a.vercel.app',
      'http://localhost:3000'
    ];
    // Allow requests with no origin (like mobile apps or curl requests) or from allowed origins
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      console.log(`CORS: Allowed origin: ${origin || 'N/A'}`);
      callback(null, true);
    } else {
      console.error(`CORS: Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], // OPTIONS is handled by app.options above
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true
};
app.use(cors(corsOptions));
// --- END URGENT CORS FIX ---

// Body parser middleware - should come AFTER CORS setup
app.use(express.json());

// MongoDB Connection with robust error handling
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://BY7:bahgat_88@qr-attendance.nphqruk.mongodb.net/qr-attendance?retryWrites=true&w=majority';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Shortened for faster connection attempts or failures
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000, // Standard connection timeout
      maxPoolSize: 10 // Default is 5, can be increased if needed
    });
    console.log('✅ MongoDB Connected');
    
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('Available collections:', collections.map(c => c.name));

  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err.message);
    // console.error('Full MongoDB error object:', err); // More detailed error
    // process.exit(1); // Exit process on critical DB connection failure (optional)
  }
}
connectDB();

mongoose.connection.on('error', err => {
  console.error('❌ MongoDB runtime error:', err.message);
});
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected.');
});
mongoose.connection.on('reconnected', () => {
  console.info('🔄 MongoDB reconnected.');
});


// Schemas
const memberSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  qrCode: { type: String, required: true, unique: true }, // This will store the name or ID for the QR
  createdAt: { type: Date, default: Date.now }
});
const Member = mongoose.model('Member', memberSchema);

const attendanceSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
  memberName: { type: String, required: true }, // Denormalized for easier querying
  date: { type: String, required: true }, // YYYY-MM-DD
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['PRESENT', 'ABSENT'], default: 'PRESENT' } // Assuming default is present upon scan
});
// Index for faster querying of attendance by date and member
attendanceSchema.index({ date: 1, memberId: 1 }, { unique: true }); // Ensure one record per member per day
attendanceSchema.index({ date: 1 });

const Attendance = mongoose.model('Attendance', attendanceSchema);


// API Routes

// Root endpoint for health check or basic info
app.get('/', (req, res) => {
  res.status(200).send('QR Attendance API is running. Timestamp: ' + new Date().toISOString());
});


// Register a new member
app.post('/api/members', async (req, res) => {
  console.log('POST /api/members request body:', req.body);
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim() === '') {
      console.log('Validation error: Name is required.');
      return res.status(400).json({ error: 'Name is required.' });
    }

    const existingMember = await Member.findOne({ name: name.trim() });
    if (existingMember) {
      console.log(`Member already exists: ${name.trim()}`);
      return res.status(409).json({ error: 'Member with this name already exists.' });
    }

    // For QR code, we can use the member's name or a unique ID. Using name for simplicity.
    // Ensure it's URL-safe if it's complex, but for QR data, raw string is fine.
    const qrCodeData = name.trim(); 

    const newMember = new Member({ name: name.trim(), qrCode: qrCodeData });
    await newMember.save();
    console.log('Member registered successfully:', newMember);
    res.status(201).json({ message: 'Member registered successfully', member: newMember });
  } catch (err) {
    console.error('Error registering member:', err);
    if (err.code === 11000) { // Duplicate key error
        return res.status(409).json({ error: 'Member with this name or QR code data already exists (database constraint).' });
    }
    res.status(500).json({ error: 'Failed to register member. ' + err.message });
  }
});

// Record attendance
app.post('/api/attendance', async (req, res) => {
  console.log('POST /api/attendance request body:', req.body);
  try {
    const { qrCodeData, date } = req.body; // Expecting qrCodeData (which is member's name) and date (YYYY-MM-DD)
    
    if (!qrCodeData || !date) {
      return res.status(400).json({ error: 'QR code data (member name) and date are required.' });
    }

    const member = await Member.findOne({ qrCode: qrCodeData }); // Find member by the data in QR
    if (!member) {
      return res.status(404).json({ error: 'Member not found for the scanned QR code.' });
    }

    // Check if attendance already recorded for this member on this date
    const existingAttendance = await Attendance.findOne({ memberId: member._id, date });
    if (existingAttendance) {
      return res.status(409).json({ message: 'Attendance already recorded for this member today.', attendance: existingAttendance });
    }

    const newAttendance = new Attendance({
      memberId: member._id,
      memberName: member.name, // Store member name for convenience
      date: date, // Date from client (e.g., YYYY-MM-DD)
      status: 'PRESENT'
    });
    await newAttendance.save();
    console.log('Attendance recorded:', newAttendance);
    res.status(201).json({ message: 'Attendance recorded successfully', attendance: newAttendance });
  } catch (err) {
    console.error('Error recording attendance:', err);
    res.status(500).json({ error: 'Failed to record attendance. ' + err.message });
  }
});

// Get attendance for a specific date
app.get('/api/attendance/:date', async (req, res) => {
  console.log(`GET /api/attendance/${req.params.date}`);
  try {
    const { date } = req.params; // Date in YYYY-MM-DD format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Please use YYYY-MM-DD.' });
    }
    const records = await Attendance.find({ date }).populate('memberId', 'name').lean(); // Populate member name
    
    // Also fetch all members to determine who is absent
    const allMembers = await Member.find().select('_id name').lean();
    const presentMemberIds = new Set(records.map(r => r.memberId._id.toString()));

    const attendanceWithAbsent = allMembers.map(member => {
        const isPresent = presentMemberIds.has(member._id.toString());
        if (isPresent) {
            return records.find(r => r.memberId._id.toString() === member._id.toString());
        } else {
            return {
                memberId: member._id,
                memberName: member.name,
                date: date,
                status: 'ABSENT'
            };
        }
    });
    
    console.log(`Found ${attendanceWithAbsent.length} total records (including absent) for date: ${date}`);
    res.status(200).json(attendanceWithAbsent);
  } catch (err) {
    console.error('Attendance fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch attendance. ' + err.message });
  }
});

// Get all members
app.get('/api/members', async (req, res) => {
  console.log('GET /api/members');
  try {
    const members = await Member.find()
      .sort({ name: 1 }) // Sort by name
      .select('name qrCode createdAt') // Select specific fields
      .lean(); // Use .lean() for faster queries if not modifying docs
    
    console.log(`Fetched ${members.length} members.`);
    res.status(200).json(members);
  } catch (err) {
    console.error('Members fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch members. ' + err.message });
  }
});

// Error handling middleware - MUST be last
app.use((err, req, res, next) => {
  console.error('Global Server Error Handler:', err);
  // Check if headers have already been sent
  if (res.headersSent) {
    return next(err); // Delegate to default Express error handler
  }
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error. Please try again later.' 
  });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') { // Avoid starting server during tests if any
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔗 CORS-enabled for origins including: https://bahgat9.github.io`);
      console.log(`MongoDB URI in use: ${MONGODB_URI.substring(0, MONGODB_URI.indexOf('@'))}...`); // Mask credentials
    });
}

module.exports = app; // Export for Vercel
