/*
 * CLOCK WORKER
 * Runs in a separate thread to prevent browser throttling
 * when the tab is inactive or in background.
 */

let timerID = null;
let interval = 25.0; // ms

self.onmessage = function(e) {
    if (e.data === "start") {
        // Start the engine
        if (!timerID) {
            timerID = setInterval(function() {
                postMessage("tick");
            }, interval);
        }
    } 
    else if (e.data === "stop") {
        // Stop the engine
        clearInterval(timerID);
        timerID = null;
    } 
    else if (e.data.interval) {
        // Update interval if needed
        interval = e.data.interval;
        if (timerID) {
            clearInterval(timerID);
            timerID = setInterval(function() {
                postMessage("tick");
            }, interval);
        }
    }
};