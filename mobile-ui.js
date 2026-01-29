/**
 * CanvasAudio Mobile Adapter
 * transforming the Desktop layout into a Mobile Tabbed App
 */

window.addEventListener('DOMContentLoaded', () => {
    // 1. Detection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
                     || window.innerWidth < 800;

    if (!isMobile) return; // Do nothing on desktop

    console.log("📱 Mobile Mode Activated");
    document.body.classList.add('mobile-mode');

    // 2. Inject Mobile Navigation Bar
    function createMobileNav() {
        const nav = document.createElement('div');
        nav.id = 'mobile-nav';
        nav.innerHTML = `
            <button class="mob-nav-btn active" data-target="playlist"><i class="fas fa-th-list"></i><br>Arrangement</button>
            <button class="mob-nav-btn" data-target="sequencer"><i class="fas fa-drum"></i><br>Sequencer</button>
            <button class="mob-nav-btn" data-target="mixer"><i class="fas fa-sliders-h"></i><br>Mixer</button>
            <button class="mob-nav-btn" data-target="browser"><i class="fas fa-folder"></i><br>Files</button>
        `;
        document.body.appendChild(nav);

        // Add Click Listeners
        nav.querySelectorAll('.mob-nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // UI Toggle
                document.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'));
                // Use closest to handle icon clicks
                const targetBtn = e.target.closest('.mob-nav-btn');
                if(targetBtn) {
                    targetBtn.classList.add('active');
                    switchView(targetBtn.dataset.target);
                }
            });
        });
    }

    // 3. View Switcher Logic
    function switchView(viewName) {
        // HIDE EVERYTHING
        const sidebar = document.querySelector('.sidebar');
        const playlist = document.querySelector('.playlist-container');
        const rack = document.querySelector('.channel-rack');
        const mixer = document.getElementById('mixerOverlay');

        if(sidebar) sidebar.style.display = 'none';
        if(playlist) playlist.style.display = 'none';
        if(rack) rack.style.display = 'none';
        if(mixer) mixer.style.display = 'none'; 

        // SHOW TARGET
        switch(viewName) {
            case 'playlist':
                if(playlist) playlist.style.display = 'flex';
                break;
            case 'sequencer':
                if(rack) {
                    rack.style.display = 'flex';
                    rack.style.height = '100%'; 
                }
                break;
            case 'mixer':
                if(typeof window.openMixerWindow === 'function') {
                    window.openMixerWindow();
                    if(mixer) {
                        mixer.style.display = 'flex';
                        mixer.classList.add('mobile-tab-view');
                    }
                }
                break;
            case 'browser':
                if(sidebar) {
                    sidebar.style.display = 'flex';
                    sidebar.style.width = '100%'; 
                }
                break;
        }
    }

    // 4. Run
    createMobileNav();
    switchView('playlist'); // Default view
            
    // Fixes: Remove explicit heights that break mobile flex
    const rack = document.querySelector('.channel-rack');
    if(rack) rack.style.minHeight = '0'; 
});
