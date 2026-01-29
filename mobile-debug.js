/**
 * CanvasAudio Mobile Debugger
 * Intercepts console logs and errors to display them on-screen for mobile devices.
 */

window.addEventListener('DOMContentLoaded', () => {
    // 1. Detection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
                     || window.innerWidth < 800;

    // Only run if mobile
    if (!isMobile) return;

    console.log("🐛 Mobile Debugger Active");

    // 2. Create the UI
    const debugBtn = document.createElement('button');
    debugBtn.innerHTML = '🐛';
    debugBtn.style.cssText = `
        position: fixed; top: 10px; right: 10px; z-index: 99999;
        background: rgba(255, 0, 0, 0.7); border: 1px solid #fff;
        border-radius: 50%; width: 40px; height: 40px; font-size: 20px;
        color: white; box-shadow: 0 4px 10px rgba(0,0,0,0.5);
    `;
    
    const consoleContainer = document.createElement('div');
    consoleContainer.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; height: 50vh;
        background: rgba(0, 0, 0, 0.95); color: #0f0; font-family: monospace;
        font-size: 12px; padding: 10px; overflow-y: auto; z-index: 99998;
        display: none; border-bottom: 2px solid #fff;
    `;
    
    // Clear Button inside console
    const clearBtn = document.createElement('button');
    clearBtn.innerText = "Clear";
    clearBtn.style.cssText = "position:absolute; top:5px; right:5px; padding:5px; background:#333; color:#fff; border:1px solid #555;";
    
    const logContent = document.createElement('div');
    logContent.style.marginTop = "25px";
    
    clearBtn.onclick = () => { logContent.innerHTML = ''; };

    consoleContainer.appendChild(clearBtn);
    consoleContainer.appendChild(logContent);
    document.body.appendChild(debugBtn);
    document.body.appendChild(consoleContainer);

    // Toggle Visibility
    debugBtn.addEventListener('click', () => {
        const isHidden = consoleContainer.style.display === 'none';
        consoleContainer.style.display = isHidden ? 'block' : 'none';
        debugBtn.style.background = isHidden ? 'rgba(0,0,0,0.5)' : 'rgba(255,0,0,0.7)';
    });

    // 3. Intercept Console Methods
    function printToScreen(type, args) {
        const line = document.createElement('div');
        line.style.borderBottom = "1px solid #333";
        line.style.padding = "4px 0";
        
        // Color coding
        if (type === 'error') line.style.color = '#ff5555';
        if (type === 'warn') line.style.color = '#ffb86c';

        // Convert args to string
        const msg = args.map(arg => {
            if (typeof arg === 'object') {
                try { return JSON.stringify(arg); } catch(e) { return '[obj]'; }
            }
            return String(arg);
        }).join(' ');

        line.innerText = `[${type.toUpperCase()}] ${msg}`;
        logContent.prepend(line); // Newest on top
    }

    // Capture Log
    const originalLog = console.log;
    console.log = function(...args) {
        originalLog.apply(console, args);
        printToScreen('log', args);
    };

    // Capture Error
    const originalError = console.error;
    console.error = function(...args) {
        originalError.apply(console, args);
        printToScreen('error', args);
        // Auto-open console on error
        consoleContainer.style.display = 'block';
    };

    // Capture Warn
    const originalWarn = console.warn;
    console.warn = function(...args) {
        originalWarn.apply(console, args);
        printToScreen('warn', args);
    };

    // 4. Capture Global Errors (Crashes)
    window.onerror = function(message, source, lineno, colno, error) {
        console.error(`CRASH: ${message} (${source}:${lineno})`);
        return false;
    };
});
