require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME || "afterschool";

// Native MongoDB driver (no Mongoose)
const client = new MongoClient(process.env.MONGODB_URI);
let db;

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());

// 1) LOGGER middleware: prints every request to the console
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(
      new Date().toISOString() + " | " +
      req.method + " " + req.originalUrl + " | " +
      "status " + res.statusCode + " | " +
      (Date.now() - start) + "ms | " +
      "IP " + req.ip
    );
  });
  next();
});

// 2) STATIC FILE middleware: serves lesson images from /images
app.use("/images", express.static(path.join(__dirname, "images")));
// If the file was not found above, send an error message
app.use("/images", (req, res) => {
  res.status(404).send("Error: image file not found");
});

// ---------- REST API routes ----------

// Home (quick check that the server is running)
app.get("/", (req, res) => {
  res.send("After School Classes API is running. Try /lessons");
});

// GET /lessons  -> all lessons as JSON
app.get("/lessons", async (req, res) => {
  try {
    const lessons = await db.collection("lesson").find({}).toArray();
    res.json(lessons);
  } catch (err) {
    res.status(500).json({ error: "Could not get lessons" });
  }
});

// GET /search?q=text  -> search topic, location, price and space (back-end search)
app.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (q === "") {
      const all = await db.collection("lesson").find({}).toArray();
      return res.json(all);
    }

    // make special characters safe inside a regular expression
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const results = await db.collection("lesson").find({
      $or: [
        { topic:    { $regex: safe, $options: "i" } },
        { location: { $regex: safe, $options: "i" } },
        { $expr: { $regexMatch: { input: { $toString: "$price" }, regex: safe } } },
        { $expr: { $regexMatch: { input: { $toString: "$space" }, regex: safe } } }
      ]
    }).toArray();

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Search failed" });
  }
});

// GET /teachers  -> all teachers (with the lessons they teach)
app.get("/teachers", async (req, res) => {
  try {
    const teachers = await db.collection("teacher").find({}).toArray();
    res.json(teachers);
  } catch (err) {
    res.status(500).json({ error: "Could not get teachers" });
  }
});

// ---------- Connect to MongoDB Atlas, then start the server ----------
client.connect()
  .then(() => {
    db = client.db(DB_NAME);
    console.log("Connected to MongoDB Atlas, database: " + DB_NAME);
    app.listen(PORT, () => console.log("Server listening on port " + PORT));
  })
  .catch(err => {
    console.error("Could not connect to MongoDB:", err.message);
  });