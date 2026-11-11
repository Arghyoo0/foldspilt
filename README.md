# FoldSplit 🚀
**A Modern, Full-Stack Group Expense & Event Finance App**

FoldSplit is a real-time web application designed to eliminate the friction of group expenses, outings, and trip settlements. Built with a mobile-first, "swipe-to-approve" interface, FoldSplit allows users to create events, split bills transparently, and settle debts instantly using native UPI deep links. 

> **Live Demo:** [https://foldspilt.onrender.com](https://foldspilt.onrender.com)

---

## 💡 The Problem It Solves

When friends, roommates, or colleagues travel or dine out, tracking who paid for what—and who owes whom—is notoriously messy. Existing apps are often bloated, require mandatory app store downloads, lack regional payment integration, or force users to mentally calculate multi-party debts.

**FoldSplit solves this by offering:**
1. **Zero-Download Onboarding:** A Progressive Web App (PWA) architecture means friends can join an event instantly via a short URL (`/e/code`) directly in their browser.
2. **Algorithmic Debt Simplification:** Automatically calculates the minimum number of transactions required to settle all debts within a group.
3. **Frictionless Settlements:** Deep integration with the Indian UPI ecosystem. Instead of switching apps to type phone numbers and amounts, users click "Pay Direct" to instantly launch Google Pay, PhonePe, or Paytm with the recipient's verified UPI ID and exact amount pre-filled.

---

## ✨ Key Features

* **Real-Time Cloud Sync:** Built on MongoDB Atlas with aggressive local cache-busting, ensuring that when one friend adds an expense, it reflects on all other devices within 2.5 seconds.
* **Smart PIN Authentication:** Replaces complex password management with a fast, 4-digit PIN system bound to the user's hardware device fingerprint (extracted via Client Hints).
* **Interactive Event Covers & Themes:** Users can upload custom cover images or select emojis for events. The "Add Expense" UI features a subconscious color-tinting engine that dynamically adapts the app's ambient color based on the selected expense category.
* **Comprehensive Financial Dashboard:**
  * Interactive proportional bar charts showing individual spending weights.
  * Dedicated Ledger tab for precise "What I Owe" and "What I Get Back" metrics.
  * Transaction Details overlay with participant breakdowns, timestamps, and editable notes.
* **Frictionless Invites:** Swipe-to-approve join screens for new members joining via short invite links.
* **White & Dark Mode:** Fully responsive UI with a seamless Light/Dark theme toggle.

---

## 🛠️ Technical Stack

This project was developed using a modern, lightweight "Vibecoding" architecture, keeping the frontend fast and the backend secure.

**Frontend:**
* Vanilla JavaScript (ES6+)
* HTML5 & Tailwind CSS (for rapid, responsive utility-class styling)
* FontAwesome (Icons) & QRious (On-the-fly QR code canvas generation)
* Progressive Web App (PWA) configured with `manifest.json` and `sw.js` for offline shell caching and home-screen installation.

**Backend (Node.js/Express):**
* **Express.js:** REST API handling routing and JSON payloads.
* **Mongoose:** Object Data Modeling (ODM) for robust MongoDB schemas.
* **Security Middleware:** 
  * `helmet` for HTTP header protection.
  * `express-rate-limit` to prevent DDoS and brute-force PIN attacks.
  * Strict ASCII sanitization on custom headers to prevent cross-site request forgery (CSRF) and HTTP smuggling.
* **Database:** MongoDB Atlas (Cloud NoSQL DB) for persistent, scalable document storage.

---

## 📱 Screenshots



| Dashboard & Charts | Transactions & Clearing | Direct UPI Settlement |
| :---: | :---: | :---: |
| <img src="images\homepage.jpg" width="250"/> | <img src="images\whom to pay.jpg" width="250"/> | <img src="images\all transactions.jpg" width="250"/> |

---

## 🚀 How to Run Locally

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/YourUsername/foldspilt.git](https://github.com/YourUsername/foldspilt.git)
   cd foldspilt