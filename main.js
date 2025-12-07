/*
 * NEURODARK 23 - NATIVE CORE v30 (Modular Bootstrapper)
 * Entry point: Initializes AppState, AudioEngine, and UIController.
 */

// --- 1. GLOBAL STATE ---
// Shared source of truth for both Audio and UI modules.
window.AppState = {
    // Transport State
    isPlaying: false,
    bpm: 174,
    currentPlayStep: 0,
    currentPlayBlock: 0,
    
    // Editor State
    editingBlock: 0,
    selectedStep: 0,
    activeView: 'bass-1',
    currentOctave: 3,
    
    // UI/Visual State
    uiMode: 'analog',
    panelCollapsed: false,
    viewKeys: true,
    viewFx: true,
    followPlayback: false,
    
    // Export Settings
    exportReps: 1
};

// --- 2. SHARED QUEUES ---
// Communication bridge: AudioEngine writes here, UIController reads here.
window.visualQueue = []; 

// --- 3. MODULE INSTANCES ---
window.audioEngine = null;
window.uiController = null;

// --- 4. GLOBAL BRIDGES (Legacy HTML Support) ---
// These functions map HTML 'onclick' attributes to the new class methods.

window.toggleMenu = function() {
    if(window.uiController) window.uiController.toggleMenu();
};

window.toggleExportModal = function() {
    if(window.uiController) window.uiController.toggleExportModal();
};

window.removeBassSynth = function(id) {
    // Removing a synth involves both Audio (stop sound/delete) and UI (update tabs)
    if(window.audioEngine && window.uiController) {
        const success = window.audioEngine.removeSynth(id);
        if(success) {
            window.uiController.renderSynthMenu();
            window.uiController.renderInstrumentTabs();
            // Switch view if we removed the active one
            if(window.AppState.activeView === id) {
                window.uiController.setTab(window.audioEngine.bassSynths[0].id);
            }
        }
    }
};

// --- 5. BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    window.logToScreen("Initializing Core v30...");

    // Validate that sub-modules are loaded
    if (typeof window.AudioEngine === 'undefined' || typeof window.UIController === 'undefined') {
        window.logToScreen("CRITICAL: AudioEngine or UIController missing.", 'error');
        return;
    }

    try {
        // A. Initialize Modules
        window.audioEngine = new window.AudioEngine();
        window.uiController = new window.UIController();

        // B. Check External Dependencies
        if(!window.timeMatrix) throw "TimeMatrix Missing";
        if(typeof window.BassSynth === 'undefined') throw "BassSynth Missing";

        // C. Start Engine (Sets up AudioContext, Workers, defaults)
        window.audioEngine.init();

        // D. Start UI (Binds DOM listeners, renders initial grid)
        window.uiController.init();

        // E. Initial Sync
        // Ensure UI sliders match the default synth parameters
        window.uiController.syncControls(window.AppState.activeView);

        window.logToScreen("System Ready [OK]");

    } catch(e) {
        window.logToScreen("BOOT ERR: " + e, 'error');
        console.error("Bootstrap Error:", e);
    }
});