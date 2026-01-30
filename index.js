const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Verify .env Loading
console.log(`${new Date().toISOString()} - MONGO_URI from .env:`, process.env.MONGO_URI ? "LOADED" : "MISSING");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

if (!process.env.MONGO_URI) {
    console.error("❌ CRITICAL ERROR: MONGO_URI is not defined in environment variables.");
    // Do not crash immediately so logs can be read, but DB features won't work
} else {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log('✅ MongoDB Connected Successfully'))
        .catch((err) => console.error('❌ MongoDB Connection Error:', err));
}

// --- Schemas & Models ---

const AboutSchema = new mongoose.Schema({
    title: { type: String, default: 'About Me' },
    text: { type: String, default: '' }
}, { timestamps: true });

const ProjectSchema = new mongoose.Schema({
    title: String,
    description: String,
    tech: String,
    link: String,
    image: String
}, { timestamps: true });

// --- Multer Configuration for Image Uploads ---
const multer = require('multer');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const ExperienceSchema = new mongoose.Schema({
    role: String,
    company: String,
    duration: String,
    description: String
}, { timestamps: true });

const SkillSchema = new mongoose.Schema({
    name: { type: String, unique: true }
}, { timestamps: true });

const SubmissionSchema = new mongoose.Schema({
    name: String,
    email: String,
    message: String,
    date: { type: Date, default: Date.now }
}, { timestamps: true });

const AdminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const About = mongoose.model('About', AboutSchema);
const Project = mongoose.model('Project', ProjectSchema);
const Experience = mongoose.model('Experience', ExperienceSchema);
const Skill = mongoose.model('Skill', SkillSchema);
const Submission = mongoose.model('Submission', SubmissionSchema);
const Admin = mongoose.model('Admin', AdminSchema);

// --- Auth Middleware ---
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: "Unauthorized: Missing Token" });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.adminId = decoded.id;
        next();
    } catch (err) {
        res.status(401).json({ message: "Unauthorized: Invalid or Expired Token" });
    }
};

// --- Routes ---
const apiRouter = express.Router();

// Public: Get All Content
apiRouter.get('/content', async (req, res) => {
    try {
        const about = await About.findOne() || { title: 'About Me', text: '' };
        const projects = await Project.find().sort({ createdAt: -1 });
        const experience = await Experience.find().sort({ createdAt: -1 });
        const skillsData = await Skill.find();
        const skills = skillsData.map(s => s.name);

        res.json({ about, projects, experience, skills });
    } catch (err) {
        res.status(500).json({ message: "Error fetching content", error: err.message });
    }
});

// Admin: Login
apiRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const admin = await Admin.findOne({ email });
        if (admin && bcrypt.compareSync(password, admin.password)) {
            const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '1d' });
            res.json({ token });
        } else {
            res.status(401).json({ message: "Invalid credentials" });
        }
    } catch (err) {
        res.status(500).json({ message: "Login error", error: err.message });
    }
});

// Admin: Update About
apiRouter.put('/about', authenticate, async (req, res) => {
    try {
        let about = await About.findOne();
        if (about) {
            about.title = req.body.title;
            about.text = req.body.text;
            await about.save();
        } else {
            about = await About.create(req.body);
        }
        res.json(about);
    } catch (err) {
        res.status(500).json({ message: "Update error", error: err.message });
    }
});

// Admin: Update Skills
apiRouter.put('/skills', authenticate, async (req, res) => {
    try {
        // req.body is an array of strings
        await Skill.deleteMany({});
        const newSkills = await Skill.insertMany(req.body.map(name => ({ name })));
        console.log(`${new Date().toISOString()} - SKILLS UPDATED`);
        res.json(newSkills.map(s => s.name));
    } catch (err) {
        res.status(500).json({ message: "Skills update error", error: err.message });
    }
});

// Admin: Add Project
apiRouter.post('/projects', authenticate, upload.single('image'), async (req, res) => {
    try {
        const projectData = { ...req.body };
        if (req.file) {
            projectData.image = `/uploads/${req.file.filename}`;
        }
        const newProject = await Project.create(projectData);
        console.log(`${new Date().toISOString()} - PROJECT ADDED:`, newProject.title);
        res.json(newProject);
    } catch (err) {
        res.status(500).json({ message: "Project add error", error: err.message });
    }
});

// Admin: Update Project
apiRouter.put('/projects/:id', authenticate, upload.single('image'), async (req, res) => {
    try {
        const projectData = { ...req.body };
        if (req.file) {
            projectData.image = `/uploads/${req.file.filename}`;
        }
        const updatedProject = await Project.findByIdAndUpdate(req.params.id, projectData, { new: true });
        res.json(updatedProject);
    } catch (err) {
        res.status(500).json({ message: "Project update error", error: err.message });
    }
});

// Admin: Delete Project
apiRouter.delete('/projects/:id', authenticate, async (req, res) => {
    try {
        await Project.findByIdAndDelete(req.params.id);
        res.json({ message: "Deleted" });
    } catch (err) {
        res.status(500).json({ message: "Delete error", error: err.message });
    }
});

// Admin: Add Experience
apiRouter.post('/experience', authenticate, async (req, res) => {
    try {
        const newExp = await Experience.create(req.body);
        res.json(newExp);
    } catch (err) {
        res.status(500).json({ message: "Experience add error", error: err.message });
    }
});

// Admin: Update Experience
apiRouter.put('/experience/:id', authenticate, async (req, res) => {
    try {
        const updatedExp = await Experience.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedExp);
    } catch (err) {
        res.status(500).json({ message: "Experience update error", error: err.message });
    }
});

// Admin: Delete Experience
apiRouter.delete('/experience/:id', authenticate, async (req, res) => {
    try {
        await Experience.findByIdAndDelete(req.params.id);
        res.json({ message: "Deleted" });
    } catch (err) {
        res.status(500).json({ message: "Delete error", error: err.message });
    }
});

// Public: Contact Submit
apiRouter.post('/contact/submit', async (req, res) => {
    try {
        const submission = await Submission.create(req.body);
        console.log(`${new Date().toISOString()} - NEW MESSAGE FROM:`, submission.name);
        res.json({ message: "Message sent successfully" });
    } catch (err) {
        res.status(500).json({ message: "Submission error", error: err.message });
    }
});

// Admin: Get Submissions
apiRouter.get('/contact/submissions', authenticate, async (req, res) => {
    try {
        const submissions = await Submission.find().sort({ date: -1 });
        res.json(submissions);
    } catch (err) {
        res.status(500).json({ message: "Fetch error", error: err.message });
    }
});

// --- Initial Seed & Migration ---
const seedAdmin = async () => {
    const count = await Admin.countDocuments();
    if (count === 0) {
        const email = process.env.ADMIN_EMAIL || "admin@gmail.com";
        const password = bcrypt.hashSync(process.env.ADMIN_PASSWORD || "admin123", 10);
        await Admin.create({ email, password });
        console.log("👤 Default Admin Created");
    }
};
seedAdmin();

app.use('/api', apiRouter);

// Export for Vercel
module.exports = app;

app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});
