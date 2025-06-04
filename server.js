const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// MongoDB Atlas Connection with auto-collection setup
async function connectDB() {
  try {
    await mongoose.connect('mongodb+srv://BY7:bahgat_88@qr-attendance.nphqruk.mongodb.net/qr-attendance?retryWrites=true&w=majority');
    console.log('Connected to MongoDB Atlas');
    
    // Verify collections exist or create them
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    if (!collectionNames.includes('members')) {
      await db.createCollection('members');
      console.log('Created "members" collection');
    }
    
    if (!collectionNames.includes('attendance')) {
      await db.createCollection('attendance');
      console.log('Created "attendance" collection');
    }
  } catch (err) {
    console.error('Connection error:', err);
    process.exit(1); // Exit if DB connection fails
  }
}
connectDB();

// Define Schemas
const memberSchema = new mongoose.Schema({
  name: { type: String, required: true },
  qrCode: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

const attendanceSchema = new mongoose.Schema({
  memberId: { type: mongoose.Schema.Types.ObjectId, required: true },
  memberName: { type: String, required: true },
  date: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

// Create indexes for better performance
memberSchema.index({ qrCode: 1 });
attendanceSchema.index({ memberId: 1, date: 1 });

const Member = mongoose.model('Member', memberSchema, 'members');
const Attendance = mongoose.model('Attendance', attendanceSchema, 'attendance');

// API Routes (keep the existing routes from previous server.js)
// ... [rest of your existing routes stay the same]

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
