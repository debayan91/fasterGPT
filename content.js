/**
 * content.js
 * Core Virtualization Logic for ChatGPT
 */

// Key: Message DOM Element (visible content)
// Value: Boolean (true if virtualized/hidden, false if rendered)
const virtualizedStates = new Map();

const OBSERVER_ROOT_MARGIN = '500px'; 
const MUTATION_DEBOUNCE_DELAY = 500;
let wasGenerating = false;

/**
 * 1. "Streaming-Aware" Throttling (The Gatekeeper)
 * Checks if ChatGPT is actively generating text to prevent optimization interference.
 */
function isGenerating() {
    const stopButton = document.querySelector('button[aria-label*="Stop generating"]');
    const streamingMessage = document.querySelector('.result-streaming');
    return !!stopButton || !!streamingMessage;
}

/**
 * 3. Intersection Observer (Auto-Reveal)
 * Watches the viewport. 
 * - If a Message leaves the viewport, it is hidden and replaced by its Ghost Div.
 * - If a Ghost Div enters the viewport, it is hidden and the actual Message is restored.
 */
const visibilityObserver = new IntersectionObserver((entries) => {
    // DO NOT optimize or modify the DOM while a generation is in progress.
    if (isGenerating()) return;

    entries.forEach(entry => {
        const el = entry.target;
        const isGhost = el.classList.contains('chatgpt-ghost-div');
        
        if (isGhost) {
            // A Ghost Div intersected the margin -> Auto-Reveal the original message
            if (entry.isIntersecting) {
                const msg = el.__originalMessage;
                if (!msg) return;
                
                // Collapse ghost, restore actual message explicitly
                el.style.display = 'none';
                msg.style.setProperty('display', '', 'important');
                
                // Track state and swap observer back to the message
                visibilityObserver.unobserve(el);
                visibilityObserver.observe(msg);
                virtualizedStates.set(msg, false);
            }
        } else {
            // A Message left the viewport margin -> Virtualize it
            if (!entry.isIntersecting) {
                let ghost = el.__ghostDiv;
                if (!ghost) return;

                // Re-insert ghost if React happened to wipe it during a re-render
                if (!ghost.parentNode) {
                    el.parentNode.insertBefore(ghost, el);
                }

                // Measure exact height before hiding to prevent scroll jumps
                const rect = el.getBoundingClientRect();
                if (rect.height === 0) return; // Ignore if already hidden/removed
                
                // 2. Scroll Position Preservation (The Ghost Div Strategy)
                ghost.style.minHeight = `${rect.height}px`;
                ghost.style.height = `${rect.height}px`;
                ghost.style.display = 'block';
                
                el.style.setProperty('display', 'none', 'important');
                
                // Track state and swap observer to the ghost div
                visibilityObserver.unobserve(el);
                visibilityObserver.observe(ghost);
                virtualizedStates.set(el, true);
            }
        }
    });
}, {
    root: null, // Viewport
    rootMargin: OBSERVER_ROOT_MARGIN,
    threshold: 0
});

/**
 * Sweeps the DOM checking for new messages to register them to the Observer.
 */
function runVirtualizationPass() {
    const generating = isGenerating();
    
    // Resync if generation just stopped. (Handles messages that scrolled out 
    // of view while generating but were skipped due to the Gatekeeper).
    if (wasGenerating && !generating) {
        virtualizedStates.forEach((isVirtual, msg) => {
            if (!document.contains(msg)) {
                virtualizedStates.delete(msg);
                return;
            }
            if (!isVirtual) {
                // Re-trigger the intersection event
                visibilityObserver.unobserve(msg);
                visibilityObserver.observe(msg);
            }
        });
    }
    wasGenerating = generating;

    // Pause all new setups during generation
    if (generating) return;

    // Target message containers
    const messages = document.querySelectorAll('[data-message-author-role]');
    
    messages.forEach(msg => {
        if (!virtualizedStates.has(msg)) {
            // Create the Ghost Div sibling 
            const ghost = document.createElement('div');
            ghost.className = 'chatgpt-ghost-div';
            ghost.style.width = '100%';
            ghost.style.display = 'none';
            
            ghost.__originalMessage = msg;
            msg.__ghostDiv = ghost;
            
            // Insert directly before to natively mirror positional flow
            msg.parentNode.insertBefore(ghost, msg);
            
            virtualizedStates.set(msg, false);
            visibilityObserver.observe(msg);
        }
    });

    // Cleanup memory for deleted messages
    if (messages.length < virtualizedStates.size) {
       virtualizedStates.forEach((isVirtual, msg) => {
           if (!document.contains(msg)) {
               virtualizedStates.delete(msg);
           }
       });
    }
}

// Performance State Management - Debouncer
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

const debouncedPass = debounce(runVirtualizationPass, MUTATION_DEBOUNCE_DELAY);

/**
 * Mutation observer checking for new chunks of the conversation history.
 */
const domObserver = new MutationObserver((mutations) => {
    debouncedPass();
});

// Watch global body for React/Next.js hydration insertions and class changes (.result-streaming)
domObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true, 
    attributeFilter: ['class'] 
});

// Initialize on load
setTimeout(runVirtualizationPass, 500);
console.log('ChatGPT DOM Virtualizer Initialized.');
