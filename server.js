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

// GET /enrolment/:lessonid  -> number of spaces already bought for that lesson
app.get("/enrolment/:lessonid", async (req, res) => {
  try {
    const lessonID = Number(req.params.lessonid);

    const lesson = await db.collection("lesson").findOne({ id: lessonID });
    if (!lesson) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const result = await db.collection("order").aggregate([
      { $unwind: "$items" },
      { $match: { "items.lessonID": lessonID } },
      { $group: { _id: null, total: { $sum: "$items.spaces" } } }
    ]).toArray();

    res.json({
      lessonID: lessonID,
      topic: lesson.topic,
      enrolment: result.length > 0 ? result[0].total : 0
    });
  } catch (err) {
    res.status(500).json({ error: "Could not get enrolment" });
  }
});

// POST /orders  -> saves a new order in the "order" collection
app.post("/orders", async (req, res) => {
  try {
    const { name, phone, lessonIDs, spaces, items } = req.body;

    if (!name || !/^[A-Za-z ]+$/.test(name) ||
        !phone || !/^[0-9]+$/.test(phone) ||
        !Array.isArray(lessonIDs) || lessonIDs.length === 0 ||
        !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Invalid order data" });
    }

    const order = {
      name: name,
      phone: phone,
      lessonIDs: lessonIDs,
      spaces: Number(spaces),
      items: items,
      createdAt: new Date()
    };

    const result = await db.collection("order").insertOne(order);
    res.status(201).json({ message: "Order saved", orderId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: "Could not save order" });
  }
});

// PUT /lessons/:id  -> updates ANY attribute(s) of a lesson
// Example body: { "space": 3 }  or  { "price": 90, "location": "Hendon" }
app.put("/lessons/:id", async (req, res) => {
  try {
    const lessonID = Number(req.params.id);
    const changes = { ...req.body };
    delete changes._id;   // never change the ids
    delete changes.id;

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    // keep numbers as numbers
    for (const field of ["space", "price"]) {
      if (field in changes) {
        changes[field] = Number(changes[field]);
        if (isNaN(changes[field])) {
          return res.status(400).json({ error: field + " must be a number" });
        }
      }
    }

    const result = await db.collection("lesson").updateOne(
      { id: lessonID },
      { $set: changes }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }
    res.json({ message: "Lesson updated", modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: "Could not update lesson" });
  }
});

// Any other route
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
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
