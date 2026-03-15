<div align="center">

# 🗡 NIGHTFALL

### *No One Breathes Tonight*

**A real-time multiplayer murder mystery game with skill-based kills and organic clue deduction.**

[![License: Custom](https://img.shields.io/badge/License-Personal%20Use%20Only-red.svg)](#license)
![Players](https://img.shields.io/badge/Players-4%20to%2016-gold)
![Platform](https://img.shields.io/badge/Platform-Any%20Browser%20%2B%20Mobile-blue)
![Tech](https://img.shields.io/badge/Stack-Node.js%20%2B%20WebSocket-green)

---

*When night falls, trust is a luxury the dead can't afford.*

</div>

## 🎮 What is NightFall?

**NightFall** is a browser-based social deduction game for **4–16 players** on **any device**. Players are assigned secret roles and unique **game personas** (like "The Rose" or "The Raven"). Each night, killers attempt to strike through **QTE mini-games** — sloppy kills leave behind physical evidence pointing to the killer's persona. Meanwhile, **every other player** investigates suspects through their own QTE. Detectives are trained investigators with easier challenges; civilians can try too, but it's harder.

### What makes NightFall different?

| Feature | How it Works |
|---|---|
| **🎮 QTE Kill System** | Killers play a timed key-sequence mini-game to attack. Perfect execution = no evidence. Failed QTE = clues left at the crime scene. **Difficulty escalates with each kill.** |
| **🔍 Universal Investigation** | Every alive player can investigate at night via QTE — not just detectives. Better accuracy = stronger clues. Detectives get an easier QTE. |
| **🎭 Persona System** | Each game assigns random themed identities ("The Clock­maker", "The Serpent"). Clues reference personas, making deduction an actual puzzle. |
| **💀 Organic Clues** | Evidence isn't arbitrary — it's generated from the killer's QTE performance. "A torn petal was found" → someone with a rose identity... |

---

## ✨ Full Feature List

| Feature | Details |
|---|---|
| **True Cross-Device Multiplayer** | WebSocket-based — play on any PC or phone on the same network |
| **QTE Kill System** | Skill-based kills with escalating difficulty and organic clue generation |
| **Universal Investigation** | All players investigate at night; detectives have easier QTEs |
| **Game Personas** | 16 unique themed identities per match for deduction gameplay |
| **5 Roles** | Killer 🗡, Detective 🔍, Civilian 🧑, Doctor 🩺 (optional), Jester 🤡 (optional) |
| **In-Game Chat** | Real-time discussion during the day phase |
| **Last Words** | Murdered players get 10 seconds for dramatic final words |
| **Host Settings** | Configurable timers, optional roles, vote visibility |
| **Mobile Optimized** | Touch-friendly UI with 44px targets, mobile QTE buttons, PWA support |
| **Anti-Cheat** | Each player only receives their own role from the server |
| **Sound Design** | Procedural Web Audio API SFX — no audio files needed |
| **Animated Background** | Canvas starfield with moon and night pulse effects |
| **Host Migration** | If the host disconnects, a new host is automatically assigned |
| **Reconnection** | Players can rejoin after brief disconnects |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 16+ installed

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/NightFall.git
cd NightFall

# Install dependencies
cd server
npm install

# Start the server
npm start
```

The server will start on `http://localhost:3000`. Open this URL in your browser.

### Playing Across Devices

1. Find your local IP address (e.g., `192.168.1.X`)
2. Share `http://192.168.1.X:3000` with all players on the same network
3. Players on phones, tablets, or other PCs can join via browser

> **Remote Play:** Use [ngrok](https://ngrok.com/), [localhost.run](https://localhost.run), or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to play over the internet.

---

## 🎭 How to Play

### Roles

| Role | Night Action | Win Condition |
|---|---|---|
| 🗡 **Killer** | Select victim → QTE to kill (harder per kill) | Outnumber or equal the living |
| 🔍 **Detective** | Investigate via QTE (easier — trained) | Eliminate all killers |
| 🧑 **Civilian** | Investigate via QTE (harder — amateur) | Eliminate all killers |
| 🩺 **Doctor** *(optional)* | Protect a player, then investigate | Eliminate all killers |
| 🤡 **Jester** *(optional)* | No night action | Get voted out |

### Game Flow

```
┌──────────┐     ┌───────────────┐     ┌──────────────┐     ┌──────────┐
│  LOBBY   │────▶│    NIGHT      │────▶│     DAY      │────▶│ VERDICT  │
│          │     │               │     │              │     │          │
│ 4-16     │     │ Killers: QTE  │     │ Evidence +   │     │ Votes    │
│ players  │     │ Everyone:     │     │ Clues shown  │     │ tallied  │
│ join     │     │ Investigate   │     │ Discuss+Vote │     │ & reveal │
└──────────┘     └───────────────┘     └──────────────┘     └────┬─────┘
                       ▲                                         │
                       └─────────────────────────────────────────┘
                              (until win condition met)
```

### QTE System

**Killer's Kill QTE:**
| Kill # | Keys | Time per Key | On Failure |
|---|---|---|---|
| 1st | 2 keys | 1.8s | Vague hint |
| 2nd | 3 keys | 1.4s | Persona trait clue |
| 3rd | 4 keys | 1.1s | Physical evidence (item) |
| 4th+ | 5 keys | 0.85s | Strong identification |

**Investigation QTE:**
| Investigator | Keys | Time per Key |
|---|---|---|
| Detective | 2 keys | 2.2s (easy) |
| Civilian / Doctor | 3 keys | 1.5s (harder) |

---

## 📁 Project Structure

```
NightFall/
├── server/
│   ├── server.js          # WebSocket relay server
│   └── package.json       # Dependencies
├── public/
│   ├── index.html         # Game UI
│   ├── manifest.json      # PWA manifest
│   ├── css/
│   │   ├── variables.css  # Design tokens
│   │   ├── components.css # UI components + QTE styles
│   │   ├── screens.css    # Screen layouts
│   │   └── animations.css # Keyframes & transitions
│   └── js/
│       ├── main.js        # Entry point
│       ├── network.js     # WebSocket client
│       ├── game.js        # Game state machine
│       ├── qte.js         # QTE engine + personas
│       ├── roles.js       # Role definitions
│       ├── ui.js          # DOM rendering
│       ├── chat.js        # In-game chat
│       ├── audio.js       # Sound effects
│       └── canvas.js      # Background animation
├── README.md
└── LICENSE
```

---

## 🛠 Technical Details

| Aspect | Implementation |
|---|---|
| **Transport** | WebSocket (via `ws` library) — real-time cross-device communication |
| **Server** | Node.js + Express — serves frontend + manages rooms |
| **Audio** | Web Audio API — procedural sound effects |
| **Graphics** | HTML5 Canvas — animated starfield with night pulse |
| **QTE Engine** | Custom mini-game with keyboard + mobile touch support |
| **State** | Host-authoritative — lobby creator manages game logic |
| **PWA** | Installable on mobile with manifest.json |

---

## 📜 License

This project is licensed under a **custom personal-use license**.

- ✅ **Personal entertainment** — Use, copy, and share freely for non-commercial enjoyment
- ❌ **Commercial use strictly prohibited** — No selling, sublicensing, monetizing, or commercial exploitation

See [LICENSE](./LICENSE) for full terms.

**© 2025–2026 Zain Waqar. All rights reserved.**

---

## 🤝 Contributing

Contributions welcome for personal/community improvement!

1. Fork → Feature branch → Commit → PR

> All contributions fall under the same license. Commercial use of derivative works is prohibited.

---

<div align="center">

*Built with Node.js, WebSockets, and a love for murder mysteries.*

**NIGHTFALL** — *No One Breathes Tonight*

</div>
