# 🏁 מרוץ חשבון — Math Race

A real-time multiplayer math racing game for classrooms.

## Setup

### Requirements
- [Node.js](https://nodejs.org/) — download and install the LTS version

### Installation

1. Open a terminal / command prompt in this folder
2. Run:
```
npm install
```

### Running the app

```
npm start
```

Then open your browser at: **http://localhost:3000**

---

## How to use

### Teacher
1. Go to `http://localhost:3000/teacher`
2. Click **"צור מרוץ חדש"** (Create new race)
3. Share the 5-letter code with students
4. Open the dashboard in a new tab (click the link shown) — project this on the classroom screen
5. When students have joined, click **"התחל מרוץ"** (Start race)

### Students
1. Go to `http://localhost:3000/student` (each student on their own device)
2. Enter their name and the room code
3. Wait for the teacher to start
4. Answer math questions — faster + correct = more progress!

---

## Game Features

- **Real-time race** — cars move on the dashboard as students answer correctly
- **Decision events** — students choose between:
  - 🛣️ **Highway** — one hard question, big reward or penalty
  - 🌿 **Dirt road** — 4 easy questions, safe steady progress
- **Luck events** — random turbos (boost) and breakdowns (slowdown)
- **Catch-up mechanic** — students who fall behind get higher luck chances
- **Dynamic questions** — questions get harder as you progress
- **Timer** — 15 seconds per question

## Project Structure

```
math-race/
├── server/
│   └── index.js        ← Main server (Express + SSE + game logic)
├── public/
│   ├── index.html      ← Landing page
│   ├── teacher.html    ← Teacher interface
│   ├── student.html    ← Student game interface
│   └── dashboard.html  ← Classroom race dashboard
└── package.json
```

## Technology

- **Backend**: Node.js + Express
- **Real-time**: SSE (Server-Sent Events)
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks needed)
- **Database**: In-memory (no setup required)
- **Language**: Hebrew UI, RTL layout
