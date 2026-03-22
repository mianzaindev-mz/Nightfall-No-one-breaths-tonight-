# 📖 NIGHTFALL — The Official Gameplay Guide

Welcome to NightFall, a real-time multiplayer murder mystery where your survival depends on your deduction skills and your reflexes. This guide details the core mechanics, phase loops, and role responsibilities.

---

## 🎭 The Role Assignment

When the game begins, players are secretly assigned one of several roles. The number of roles scales automatically based on the lobby size (4 to 30 players).

1. **🗡 The Killer:** Your goal is to eliminate the innocent until the killers equal or outnumber the living. You act during the Night Phase.
2. **🔍 The Detective:** A trained investigator. You act during the Night Phase to gather clues on suspects. Your goal is to identify and execute the killers.
3. **🧑 The Civilian:** Standard townsfolk. Your goal is the same as the Detective, but your investigative abilities are limited and harder to execute.
4. **🩺 The Doctor (Optional):** Can protect one player each night from being killed.
5. **🤡 The Jester (Optional):** A chaotic neutral role whose only goal is to trick the town into executing them during the Day Phase.

*Note: Along with a role, every player is assigned a **Persona** (e.g., The Clockmaker, The Serpent, The Rose) and a randomly generated **Character Name**. Physical evidence left behind will always link back to the killer's Persona trait.*

---

## 🔄 The Gameplay Loop

A match of NightFall cycles through a continuous loop of phases until a win condition is met.

### 1. 🌑 The Night Phase (45 Seconds)

The town sleeps, but the shadows are active. This is the action phase of the game where all QTE (Quick Time Event) mini-games occur.

**If you are the Killer:**
- You will see a list of all living players.
- Select your target for the night.
- Wait for the phase to end. Your success and stealth depend entirely on your upcoming Kill QTE performance.

**If you are a Detective or Civilian:**
- You will see a list of all living players (except yourself).
- Select a suspect to investigate.
- Wait for the phase to end. You must complete the Investigation QTE to gain any clues.

**The Night Event System:**
- Randomly, a weather or story event may occur (e.g., *Dense Fog*, *Thunderstorm*, *Full Moon*).
- These events dynamically alter gameplay variables, making evidence harder to read, QTEs shorter, or granting bonus clues.

### 2. ☀️ The Day Phase (60 Seconds)

Dawn breaks. The results of the night are revealed to the entire town.

**The Reveal:**
- If the killer successfully murdered someone, their death is announced.
- Any physical evidence (clues) left behind by the killer due to a sloppy QTE is broadcast to everyone. (e.g., *"A torn velvet glove was left at the scene"*, pointing to a specific Persona).

**Discussion & Investigation:**
- Players use the in-game chat to discuss their findings.
- Detectives and Civilians who successfully completed their Night QTE will receive private clues about the suspect they investigated.
- Players can view the **Heatmap** (in the Suspicion tab) to see historical voting patterns and track who is accusing whom.

**Voting:**
- During the day, players must select a suspect to execute.
- Voting is mandatory to eliminate a killer.
- The player with the most votes will be put on trial at the end of the phase.

### 3. ⚖️ The Verdict Phase (6 Seconds)

The votes are tallied and the town's decision is final.

- The breakdown of all votes is displayed.
- The player with the highest number of votes is executed.
- The executed player's true role (Killer or Innocent) is immediately revealed to the town.
- If it's a tie, no one is executed.

After the Verdict, the game immediately plunges back into the **Night Phase**.

---

## ⚡ The QTE Mechanics

NightFall is not just about talking; it requires physical skill. All actions at night require players to complete a Quick Time Event (QTE) — a sequence of keys (`W, A, S, D` or arrows) pressed before a timer runs out.

### The Kill QTE (Killers)
To successfully murder a target, the Killer must complete a QTE. The difficulty of this QTE **escalates permanently** with every successful kill the Killer makes.

- **1st Kill:** 2 keys (1.8s per key) _[Failure: Leaves a vague hint]_
- **2nd Kill:** 3 keys (1.4s per key) _[Failure: Leaves a Persona trait clue]_
- **3rd Kill:** 4 keys (1.1s per key) _[Failure: Leaves physical evidence]_
- **4th+ Kill:** 5 keys (0.85s per key) _[Failure: Strong identification]_

If a killer fails the QTE entirely, the target **survives**, and the killer drops massive evidence.

### The Investigate QTE (Innocents)
To successfully gather a clue on a suspect, you must complete an investigation QTE. 

- **Detectives:** Are trained professionals. Their QTE is shorter (2 keys) and gives more time (2.2s).
- **Civilians:** Are terrified amateurs. Their QTE is longer (3 keys) and gives less time (1.5s).

If you fail the QTE, you panic in the dark and gain zero information for that night.

---

## 🏆 Win Conditions

- **The Town (Innocents) Wins** if ALL Killers are successfully executed during the Day Phase.
- **The Killers Win** if the number of living Killers is equal to or greater than the number of living Innocents.
- **The Jester Wins** if they trick the town into executing them during the Day Phase.
