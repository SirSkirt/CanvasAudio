# 🎹 Canvas Audio

**A lightweight, browser-based DAW built with HTML5, Tone.js, and Electron.**

CanvasAudio is an experimental Digital Audio Workstation that runs right in your browser (or on your desktop). It combines a classic Step Sequencer workflow with a linear Timeline arrangement view, making it easy to sketch out beats and ideas quickly.

> ⚠️ **Status:** Alpha. Expect bugs, breaking changes, and rapid updates!

---

## 🚀 The Shift to Standalone

While CanvasAudio started as a purely web-based experiment, we are shifting focus to the **Standalone Desktop App**. Once the DAW is stable, the web option won't exist anymore. Will still update this repo, but wont be able to access CanvasAudio through the web browser

**Why the switch?**
* **Offline Saving:** The web version relies on local storage (cache), which is fragile. The desktop app saves real `.json` project files to your hard drive.
* **Performance:** The standalone app runs in a dedicated environment without browser tab throttling.
* **Shortcuts & Workflow:** Better keyboard support without the browser getting in the way

You can still try the [Web Demo here](https://sirskirt.github.io/CanvasAudio), but for the real experience, grab the latest release.

---

## ✨ Features (v0.5.0)

* **Step Sequencer:** 4-track drum machine (Kick, Snare, HiHat, Clap).
* **Playlist Arrangement:** Drag-and-drop pattern blocks and audio clips.
* **Audio Recording:** Record microphone input directly to the timeline.
* **Mixer:** 8-Track mixer with Volume, Pan, Mute, and Solo.
* **FX Rack:** Per-track effects chain (currently a work in progress).
* **Custom Autotune:** Real-time pitch correction with "Retune Speed" and "Humanize" controls. (Currently Work in progress, may break at any moment)
 
---

## 📝 Changelog

### **v0.5.0 - The "Toolbox" Update**
*This release focuses on workflow speed and the transition to a desktop-first experience.*

#### **🆕 New Features**
* **Edit Tools Grid:** Added a dedicated toolbar for timeline editing. No more finicky right-clicking!
    * **Select:** Standard click selection.
    * **Split:** Cut clips perfectly at the playhead.
    * **Mute:** Silence individual clips non-destructively.
    * **Delete:** Remove clips quickly.
    * **Copy/Paste:** duplicate clips across the timeline.
    * **Trim In/Out:** Adjust start and end points relative to the playhead.
* **Smart Environment Detection:** The app now knows if it's running in a Browser or Electron.
    * **Browser:** Shows a "Download Standalone" banner (Once Standalone is stable).
    * **Desktop:** Hides the banner and enables the custom title bar.
* **Custom Title Bar:** A sleek, dark-themed window frame for the desktop app (replaces the default Windows bar).

#### **🛠️ Fixes & Improvements**
* Fixed an issue where `setupAudioStatusPanel` would fail on initialization.
* Fixed Fiddle/Electron detection logic to prevent UI glitches.
* Optimized the "Audio Ready" engine start sequence.
* Removed the "Content-Security-Policy" meta tag that was blocking Tone.js and FontAwesome CDN loads.

---

## 📦 Installation (Desktop)

1.  Go to the **[Releases](../../releases)** (Not yet Released) page.
2.  Download the latest installer (`.exe` for Windows).
3.  Run the installer.
4.  **Auto-Updates:** The app will now automatically check for updates and prompt you to restart when a new version is available! (Again, once implemented)

---
**Why Make a DAW in Javascript?**
-Because we are curious how far we can push a webapp and make easily portable cross platform apps/games

**Built with ❤️ by QTech Studios**
