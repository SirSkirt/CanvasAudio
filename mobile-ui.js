/**
 * CanvasAudio Mobile Adapter - Glassmorphism Edition
 * Uses Tailwind CSS for styling
 */

window.addEventListener('DOMContentLoaded', () => {
    // 1. Detection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) 
                     || window.innerWidth < 800;

    if (!isMobile) return;

    console.log("📱 Mobile Glass Mode Activated");
    document.body.classList.add('mobile-mode');

    // 2. Inject Glass Navigation Bar
    function createMobileNav() {
        const nav = document.createElement('div');
        nav.id = 'mobile-nav';
        
        // TAILWIND GLASS CLASSES:
        // fixed bottom-0: Sticks to bottom
        // bg-black/60: 60% opacity black
        // backdrop-blur-xl: The "Frosted Glass" effect
        // border-t border-white/10: Subtle 1px light border on top
        nav.className = `
            fixed bottom-0 left-0 right-0 z-50
            h-20 pb-safe
            bg-black/80 backdrop-blur-xl
            border-t border-white/10
            flex justify-around items-center
            shadow-2xl shadow-black
        `;

        // Button Template
        const btnClass = "flex flex-col items-center justify-center w-full h-full text-gray-500 hover:text-white transition-all duration-300 active:scale-95";
        const iconClass = "text-xl mb-1";
        const textClass = "text-[10px] font-medium tracking-wide uppercase";

        nav.innerHTML = `
            <button class="${btnClass} active-tab" data-target="playlist">
                <i class="fas fa-th-list ${iconClass}"></i>
                <span class="${textClass}">Arrange</span>
            </button>
            <button class="${btnClass}" data-target="sequencer">
                <i class="fas fa-drum ${iconClass}"></i>
                <span class="${textClass}">Drums</span>
            </button>
            <button class="${btnClass}" data-target="mixer">
                <i class="fas fa-sliders-h ${iconClass}"></i>
                <span class="${textClass}">Mixer</span>
            </button>
            <button class="${btnClass}" data-target="browser">
                <i class="fas fa-folder ${iconClass}"></i>
                <span class="${textClass}">Files</span>
            </button>
        `;
        document.body.appendChild(nav);

        // Add Click Listeners
        nav.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Remove Orange Highlight from all
                nav.querySelectorAll('button').forEach(b => {
                    b.classList.remove('text-accent', 'active-tab');
                    b.classList.add('text-gray-500');
                });
                
                // Add Orange Highlight to clicked
                const targetBtn = e.target.closest('button');
                if(targetBtn) {
                    targetBtn.classList.remove('text-gray-500');
                    targetBtn.classList.add('text-accent', 'active-tab'); // text-accent defined in index.html config
                    switchView(targetBtn.dataset.target);
                }
            });
        });
        
        // Set initial active state
        nav.querySelector('.active-tab').classList.remove('text-gray-500');
        nav.querySelector('.active-tab').classList.add('text-accent');
    }

    // 3. View Switcher Logic (Kept mostly same, added animation classes)
    function switchView(viewName) {
        const sidebar = document.querySelector('.sidebar');
        const playlist = document.querySelector('.playlist-container');
        const rack = document.querySelector('.channel-rack');
        const mixer = document.getElementById('mixerOverlay');

        // Hide all with a fade out effect if desired, for now direct switch
        if(sidebar) sidebar.style.display = 'none';
        if(playlist) playlist.style.display = 'none';
        if(rack) rack.style.display = 'none';
        if(mixer) mixer.style.display = 'none'; 

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
                        mixer.classList.add('glass-panel'); // Add glass effect to mixer
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

    createMobileNav();
    switchView('playlist'); 
    
    // Cleanup heights
    const rack = document.querySelector('.channel-rack');
    if(rack) rack.style.minHeight = '0'; 
});
