<div align="center">

# 🗡 NIGHTFALL: Season 2

### *No One Breathes Tonight*

**A real-time multiplayer murder mystery game with skill-based kills and organic clue deduction.**

[![Version](https://img.shields.io/badge/Version-2.0.0-purple.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-gold.svg)](./LICENSE)
[![Players](https://img.shields.io/badge/Players-4%20to%2030-red.svg)]()
[![Platform](https://img.shields.io/badge/Platform-Browser%20%2B%20PWA-blue.svg)]()
[![Tech](https://img.shields.io/badge/Stack-Node.js%20%7C%20Express%20%7C%20WebSocket-green.svg)]()

---

*When night falls, trust is a luxury the dead can't afford.*

</div>

## 🎮 What is NightFall?

**NightFall** is a browser-based social deduction game for **4–30 players**. Players are assigned secret roles and unique **game personas** (like "The Rose" or "The Raven"). Each night, killers attempt to strike through **QTE (Quick Time Event) mini-games** — sloppy kills leave behind physical evidence pointing to the killer's persona. Meanwhile, **every other player** investigates suspects through their own QTE. 

For a comprehensive breakdown of exactly how to play, read the **[📖 Official Gameplay Guide](./GAMEPLAY_GUIDE.md)**!

---

## ✨ Features (Season 2 Update)

Season 2 brings a massive overhaul to the engine, UI, and game mechanics. 

| Feature | Details |
|---|---|
| **True Cross-Device Multiplayer** | Zero installation. Connect via WebSocket on any PC, tablet, or phone. |
| **QTE Kill System** | Kills require skill. Difficulty scales permanently with every victim. Sloppy QTEs generate physical evidence (e.g. *A torn velvet glove*). |
| **Universal Investigation** | All players investigate at night. Detectives get easy QTEs; Civilians get hard QTEs. |
| **16 Game Personas** | Randomly assigned themed identities for deep deduction gameplay. |
| **Heatmap & Suspicion Tracking** | A visual map in the UI tracking historical voting patterns to see who is framing who. |
| **Interactive Manor Tooltips** | Hover over rooms (e.g. `[Kitchen]`) in the chat to see descriptions and floor plans. |
| **Cinematic Phase Transitions** | Full-screen overlays and localized screen shake when timers hit critical. |
| **Death Recap Cards** | When you die, a dramatic overlay summarizes your survival time and location. |
| **Dynamic Audio Engine** | 100% Procedural Web Audio API SFX (drones, heartbeats, phase chimes). Zero `.mp3` files needed. |
| **Progressive Web App (PWA)** | Install NightFall directly to your phone's home screen for a native app experience. |
| **Host Migration & Recovery** | If a player drops, they have 15 seconds to rejoin. If the host leaves, another player inherits the host powers automatically. |

---

## 🚀 Upcoming Features (Season 3 Hype!)

NightFall is constantly evolving. Here is a sneak peek at what's brewing in the shadows for the massive **Season 3 Update**:

🔥 **New Roles & Factions:** Introducing neutral serial killers, the vigilant 'Sniper', and the chaotic 'Arsonist' who can burn down entire Chat Rooms.  
🏰 **The Manor Map Expansion:** A visual map of the manor where players physically move between the Library, Conservatory, and Cellar. Where you are when the lights go out matters!  
🗣️ **Proximity Voice Chat:** Hear the screams of the dying if they are in the room next to you.  
🏆 **Global Leaderboards & Match History:** Track your win rates, favorite personas, and most deceitful moments on a global ranking ladder.  
🌙 **The Blood Moon Event:** A rare weather event where Killers gain immense power, but all their identities are temporarily flashed to the Detectives.  

---

## 📁 Project Structure

```text
Nightfall-No-one-breaths-tonight-/
├── server/
│   ├── server.js          # Node.js + Express + WebSocket relay server (Port 3000)
│   └── package.json       # Backend Dependencies (express, ws)
├── public/
│   ├── index.html         # Main Game UI & Settings Modal
│   ├── manifest.json      # PWA App Manifest
│   ├── css/
│   │   ├── variables.css  # Core tokens (Colors, Fonts, Spacing)
│   │   ├── components.css # Standard UI (Buttons, Modals, Avatars, Settings, Heatmap)
│   │   ├── screens.css    # Layouts for Lobby, Night, Day, Verdict phases
│   │   └── animations.css # Splatter effects, screen shake, pulsating timers
│   └── js/
│       ├── main.js        # Entry point, PWA registration, App settings
│       ├── network.js     # WebSocket client & reconnection logic
│       ├── game.js        # The Core State Machine (controls phases, hosts, roles)
│       ├── qte.js         # Quick Time Event engine & Persona manager
│       ├── roles.js       # Core role configurations (Killer, Det, Civ, etc)
│       ├── ui.js          # DOM rendering and Event listeners
│       ├── chat.js        # Fast, sanitized in-game chat engine
│       ├── audio.js       # Procedural audio synthesizers 
│       ├── canvas.js      # The moving starfield background
│       └── systems/
│           ├── UIManager.js    # Complex UI (Heatmaps, Tooltips)
│           └── UXEffects.js    # Micro-interactions (Shakes, Death cards)
├── GAMEPLAY_GUIDE.md      # Detailed instructions on how to play
└── railway.json           # Railway PaaS deployment configuration
```

---

## ⚙️ Getting Started / Self-Hosting

### Local Development (Play on your Wi-Fi)

1. **Install [Node.js](https://nodejs.org/) (v18+)**
2. **Clone the repository:**
   ```bash
   git clone https://github.com/mianzaindev-wq/Nightfall-No-one-breaths-tonight-.git
   cd Nightfall-No-one-breaths-tonight-
   ```
3. **Install dependencies:**
   ```bash
   cd server
   npm ci
   ```
4. **Start the server:**
   ```bash
   node server.js
   ```
5. **Play!** 
   Open `http://localhost:3000` on your PC. To let friends on the same Wi-Fi join, they just need to navigate to your computer's local IP address (e.g., `http://192.168.1.5:3000`).

---

### ☁️ One-Click Cloud Deployment (Railway)

NightFall is completely production-ready and dockerized, meaning it can be hosted permanently online for free.

1. Create a free account on [Railway.app](https://railway.app).
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Select your `Nightfall-No-one-breaths-tonight-` repository.
4. **Important:** Railway will automatically use the `railway.json` and `Dockerfile` to build and deploy the game perfectly in seconds. 
5. Under your Railway project settings, click **Generate Domain** to get a public link to share with players worldwide!

*(Note: The server uses aggressive memory management and graceful socket cleanup, making it extremely lightweight for free cloud tiers).*

---

## 📜 Authors & Licensing

Developed and designed by **Muhammad Zain**.  
This project is open-source and available under the terms of the **[MIT License](./LICENSE)**.

<div align="center">

*Stay quiet. Stay alive.*

</div>
